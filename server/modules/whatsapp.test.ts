import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { interpretMessage } from './whatsapp';

type Row = Record<string, any>;

describe('WhatsApp message interpretation', () => {
  it.each([
    ['CAR-003 installed 60%', 'progress_update', 'Confirmed', 'CAR-003', 60],
    ['car003 siap pasang', 'progress_update', 'Probable', 'CAR-003', 100],
    ['CAR-003 安装完成', 'progress_update', 'Probable', 'CAR-003', 100],
    ['CAR-003 door panel pecah, kena tukar', 'problem_report', 'Confirmed', 'CAR-003', null],
    ['CAR-003 尺寸不对', 'problem_report', 'Confirmed', 'CAR-003', null],
    ['panel cracked', 'problem_report', 'Unknown', null, null],
    ['bila delivery?', 'question', 'Confirmed', null, null],
    ['ok boss', 'unknown', 'Unknown', null, null],
  ])('%s', (text, intent, confidence, code, pct) => {
    expect(interpretMessage(text)).toMatchObject({ intent, confidence, work_item_code: code, progress_percent: pct });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('WhatsApp field reports become proposals for the PM', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let job: Row;
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    await as['Admin'].post('/api/whatsapp/contacts').send({ phone: '+60170000001', user_id: 'user-contractor' }).expect(201);
    await as['Admin'].post('/api/whatsapp/contacts').send({ phone: '+60170000002', user_id: 'user-client' }).expect(201);
    // An open installation job of this contractor's, and the project's PM.
    job = (await db.pool.query(`SELECT j.id, j.project_id, j.data->>'progress_percent' AS pct, w.item_code FROM installation_jobs j JOIN work_items w ON w.id = j.work_item_id WHERE j.contractor_id = 'con-1' AND j.status NOT IN ('Completed', 'Cancelled') AND j.project_id = 'proj-1' ORDER BY j.id LIMIT 1`)).rows[0];
    await db.pool.query(`UPDATE projects SET project_manager_id = 'user-pm' WHERE id = 'proj-1'`);
  });
  afterAll(async () => {
    await db?.close();
  });
  const send = async (from: string, text: string) => (await as['Admin'].post('/api/whatsapp/simulate-inbound').send({ from, text }).expect(200)).body as Row;
  const approval = async (id: string) => (await db.pool.query('SELECT decision, data FROM approvals WHERE id = $1', [id])).rows[0];

  it('a progress message is proposed to the PM and changes nothing until approved', async () => {
    expect(job).toBeTruthy();
    const r = await send('+60170000001', `${job.item_code} installed 60%`);
    expect(r).toMatchObject({ recognized: true, interpretation: { intent: 'progress_update', confidence: 'Confirmed', progress_percent: 60 } });
    expect(r.reply).toMatch(/nothing is changed until they approve/);
    const a = await approval(r.proposal_id);
    expect(a.decision).toBe('Pending');
    expect(a.data).toMatchObject({ assigned_approver_id: 'user-pm', asked_by_id: 'user-contractor', source: 'WhatsApp', proposal: { action: 'record_progress', params: { installation_job_id: job.id, progress_percent: 60 } } });
    expect((await db.pool.query(`SELECT data->>'progress_percent' AS pct FROM installation_jobs WHERE id = $1`, [job.id])).rows[0].pct).toBe(job.pct);
    // The PM is told there is something to confirm.
    expect((await db.pool.query(`SELECT 1 FROM notifications WHERE user_id = 'user-pm' AND entity_id = $1`, [r.proposal_id])).rowCount).toBe(1);
    // The same message again (e.g. a provider retry) raises no second proposal.
    const again = await send('+60170000001', `${job.item_code} installed 60%`);
    expect(again.proposal_id).toBeUndefined();
    expect(again.reply).toMatch(/Already received/);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM approvals WHERE data->>'asked_by_id' = 'user-contractor' AND data->'proposal'->>'action' = 'record_progress'`)).rows[0].n).toBe(1);
    // The contractor can't approve it; the PM does, and it is executed as the PM.
    expect((await as['Contractor'].post(`/api/approvals/${r.proposal_id}/decision`).send({ decision: 'Approved' })).status).toBe(403);
    await as['Project Manager'].post(`/api/approvals/${r.proposal_id}/decision`).send({ decision: 'Approved' }).expect(200);
    const after = (await db.pool.query(`SELECT data FROM installation_jobs WHERE id = $1`, [job.id])).rows[0].data;
    expect(after.progress_percent).toBe(60);
    expect(after.progress_updates.at(-1)).toMatchObject({ percent: 60, confirmed_by: expect.any(String) });
    expect((await db.pool.query(`SELECT actor_id FROM audit_logs WHERE action = 'ai.proposal.execute' AND entity_id = $1`, [r.proposal_id])).rows[0].actor_id).toBe('user-pm');
  });

  it('a problem message becomes an issue only after the PM confirms it', async () => {
    const r = await send('+60170000001', `${job.item_code} side panel pecah masa angkat`);
    expect(r.interpretation).toMatchObject({ intent: 'problem_report', confidence: 'Confirmed' });
    const issueId = `issue-ai-${r.proposal_id}`;
    expect((await db.pool.query('SELECT 1 FROM issues WHERE id = $1', [issueId])).rowCount).toBe(0);
    await as['Project Manager'].post(`/api/approvals/${r.proposal_id}/decision`).send({ decision: 'Approved' }).expect(200);
    const issue = (await db.pool.query('SELECT project_id, status, data FROM issues WHERE id = $1', [issueId])).rows[0];
    expect(issue).toMatchObject({ project_id: job.project_id, status: 'Reported' });
    expect(issue.data.description).toMatch(/via WhatsApp/);
    expect(issue.data.reported_by_role).toBe('Contractor');
  });

  it('asks for clarification instead of guessing, and never reaches outside the sender scope', async () => {
    const vague = await send('+60170000001', 'panel cracked');
    expect(vague.proposal_id).toBeUndefined();
    expect(vague.reply).toMatch(/include the item code/);
    // An item that exists only on another contractor's project gets the same answer as a missing one.
    await db.pool.query(`UPDATE work_items SET item_code = 'OTH-777' WHERE id = 'item-x'`);
    for (const code of ['OTH-777', 'ZZZ-999']) {
      const r = await send('+60170000001', `${code} installed 50%`);
      expect(r.proposal_id, code).toBeUndefined();
      expect(r.reply, code).toMatch(new RegExp(`can't find ${code} among your work items\\. Please`));
    }
  });

  it('unknown numbers get nothing interpreted and no project information; clients get no proposals', async () => {
    const unknown = await send('+60179999999', `${job.item_code} installed 90%`);
    expect(unknown).toMatchObject({ recognized: false });
    expect(unknown.interpretation).toBeUndefined();
    expect(unknown.reply).toMatch(/not registered/);
    const client = await send('+60170000002', `${job.item_code} door broken`);
    expect(client.proposal_id).toBeUndefined();
    expect(client.reply).toMatch(/Approvals and decisions are made in NW OS|For details please contact/);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM approvals WHERE data->>'asked_by_id' IN ('user-client') `)).rows[0].n).toBe(0);
  });
});
