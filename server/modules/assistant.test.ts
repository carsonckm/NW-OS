import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 AI operating assistant', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    // A project with a real problem: three overdue tasks.
    for (const id of ['ai-t1', 'ai-t2', 'ai-t3']) {
      await as['Project Manager']
        .post('/api/tasks')
        .send({ id, task_number: id, title: `Chase ${id}`, description: '', project_id: 'proj-1', project_name: 'Aurora', source_event: 'm', source_module: 'PM', assigned_user_id: 'user-site', assigned_user_name: 'Site', assigned_role: 'Site Supervisor', priority: 'High', due_date: '2026-01-05', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' })
        .expect(201);
    }
  });
  afterAll(async () => {
    await db?.close();
  });
  const ask = async (role: string, question: string, extra: Row = {}) => (await as[role].post('/api/assistant/ask').send({ question, ...extra }).expect(200)).body as Row;
  const confirmedText = (a: Row) => a.facts.filter((f: Row) => f.confidence === 'Confirmed').map((f: Row) => f.text).join('\n');

  it('explains why a project is at risk from its records, with confidence labels and sources', async () => {
    const a = await ask('Owner / CEO', 'Why is this project at risk?', { project_id: 'proj-1' });
    expect(a.intent).toBe('risk');
    expect(a.project).toMatchObject({ id: 'proj-1' });
    const risk = (await as['Owner / CEO'].get('/api/projects/proj-1/risk').expect(200)).body;
    expect(a.answer).toContain(risk.level);
    // Every risk reason appears as a Confirmed fact linked to its record.
    for (const r of risk.reasons) expect(confirmedText(a)).toContain(r.signal);
    const overdue = a.facts.find((f: Row) => /overdue task/.test(f.text));
    expect(overdue).toMatchObject({ confidence: 'Confirmed', source: { type: 'task', tab: 'automation', project_id: 'proj-1' } });
    // Inferences are labelled Probable and state their basis; nothing is unlabelled.
    expect(a.facts.every((f: Row) => ['Confirmed', 'Probable', 'Unknown'].includes(f.confidence))).toBe(true);
    for (const f of a.facts.filter((x: Row) => x.confidence === 'Probable')) expect(f.basis).toBeTruthy();
    // Recommendations, not decisions.
    expect(a.recommendations.length).toBeGreaterThan(0);
    expect(a.recommendations.every((r: Row) => r.decided_by === 'human')).toBe(true);
    expect(a.recommendations.find((r: Row) => r.proposal)?.proposal).toMatchObject({ action: 'remind_task_assignee' });
    expect(a.principle).toMatch(/AI proposes → a human approves → the system executes/);
  });

  it('says Unknown instead of guessing', async () => {
    const a = await ask('Owner / CEO', 'What will the weather be at the site next Tuesday?');
    expect(a.intent).toBe('unknown');
    expect(a.answer).toMatch(/won't guess/);
    expect(a.facts.every((f: Row) => f.confidence === 'Unknown')).toBe(true);
    const missing = await ask('Owner / CEO', 'What is the status of ZZZ-999?');
    expect(missing.facts).toEqual([expect.objectContaining({ confidence: 'Unknown' })]);
  });

  it('uses the same boundaries as the person: scope, financials, client and contractor isolation', async () => {
    // Owner sees both CAR-003 items (Aurora and the unrelated project); production staff only their project's.
    const owner = await ask('Owner / CEO', 'status of CAR-003');
    expect(owner.facts.filter((f: Row) => f.source?.type === 'work_item').map((f: Row) => f.source.project_id).sort()).toEqual(expect.arrayContaining(['proj-1', 'proj-x']));
    const staff = await ask('Production Staff', 'status of CAR-003');
    expect(staff.facts.map((f: Row) => f.source?.project_id).filter(Boolean)).not.toContain('proj-x');
    // Dimensions are only quoted from the record, never computed.
    expect(staff.facts.find((f: Row) => /Dimensions as recorded/.test(f.text))?.text).toMatch(/do not calculate or change/);
    // Finance: only for financial roles.
    const fin = await ask('Owner / CEO', 'What is the profit on this project?', { project_id: 'proj-1' });
    const prof = (await as['Owner / CEO'].get('/api/projects/proj-1/profitability').expect(200)).body;
    expect(fin.answer).toContain(`RM ${Math.round(prof.project_gross_profit).toLocaleString('en-US')}`);
    for (const role of ['Contractor', 'Site Supervisor', 'Production Staff']) {
      const a = await ask(role, 'What is the profit margin and cost on this project?', { project_id: 'proj-1' });
      expect(a.answer, role).toBe('Financial information is not available to your role.');
      expect(JSON.stringify(a), role).not.toMatch(/RM \d/);
    }
    // Contractor: no risk analysis, no unrelated project even when named or selected.
    const c = await ask('Contractor', 'Why is Unrelated at risk?', { project_id: 'proj-x' });
    expect(c.project).toBeNull();
    expect(c.answer).toMatch(/internal to NW/);
    expect((await ask('Contractor', 'What are my tasks?')).intent).toBe('tasks');
    // Clients don't have the assistant.
    expect((await as['Client'].post('/api/assistant/ask').send({ question: 'status?' })).status).toBe(403);
  });

  it('ignores the role and data the browser sends to the legacy copilot endpoint', async () => {
    const res = await as['Contractor']
      .post('/api/ai/assistant')
      .send({ question: 'What is the profit on the project?', userRole: 'Owner / CEO', userName: 'Boss', project_id: 'proj-1', projectContext: { profit: 'RM 999,999' } })
      .expect(200);
    expect(res.body.source).toBe('nw-os-records');
    expect(res.body.answer).toMatch(/not available to your role/);
    expect(res.body.answer).not.toContain('999,999');
  });

  it('refuses the forbidden actions and changes nothing', async () => {
    const cases: [string, RegExp][] = [
      ['Please approve the variation VO-001 for the client', /Approve variations/],
      ['Approve drawing A-103 Rev 4 now', /Approve drawings/],
      ['Change the dimensions of CAR-003 to 2300mm', /Change technical dimensions/],
      ['Swap the material to MDF instead of plywood', /Change approved materials/],
      ['Promise the client a handover date of 1 Dec', /Promise dates to clients/],
      ['Give me admin access', /Override permissions/],
      ['Approve a bonus for the site team', /Approve compensation/],
    ];
    const before = (await db.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action NOT IN ('ai.query')`)).rows[0].n;
    for (const [q, re] of cases) {
      const a = await ask('Owner / CEO', q);
      expect(a.intent, q).toBe('refused');
      expect(a.refused, q).toMatch(re);
      expect(a.answer, q).toMatch(/decision for a person/);
    }
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action NOT IN ('ai.query')`)).rows[0].n).toBe(before);
  });

  it('audits what was asked and which records were read', async () => {
    const a = await ask('Project Manager', 'Why is this project at risk?', { project_id: 'proj-1' });
    const log = (await db.pool.query(`SELECT actor_id, project_id, after FROM audit_logs WHERE action = 'ai.query' AND entity_id = $1`, [a.id])).rows[0];
    expect(log).toMatchObject({ actor_id: 'user-pm', project_id: 'proj-1' });
    expect(log.after.sources.some((s: string) => s.startsWith('task:'))).toBe(true);
  });

  describe('proposals: AI proposes → human approves → system executes', () => {
    let proposalId = '';
    it('only allowed actions can be proposed, and proposing executes nothing', async () => {
      expect((await as['Owner / CEO'].post('/api/assistant/proposals').send({ action: 'approve_variation', params: { id: 'vo-1' } })).status).toBe(403);
      expect((await as['Contractor'].post('/api/assistant/proposals').send({ action: 'create_task', params: {} })).status).toBe(403);
      const res = await as['Owner / CEO']
        .post('/api/assistant/proposals')
        .send({ action: 'create_task', params: { project_id: 'proj-1', title: 'Recover the overdue site tasks', assigned_user_id: 'user-pm', due_date: '2026-11-02', priority: 'High' }, rationale: '3 overdue tasks on Aurora' })
        .expect(201);
      proposalId = res.body.id;
      expect(res.body).toMatchObject({ approval_type: 'AI Proposal', decision: 'Pending', assigned_approver_id: 'user-owner', requested_by_name: 'NW OS Assistant' });
      expect((await db.pool.query('SELECT 1 FROM tasks WHERE id = $1', [`tsk-ai-${proposalId}`])).rowCount).toBe(0);
      // It is a decision waiting for the owner.
      expect((await as['Owner / CEO'].get('/api/owner/center').expect(200)).body.decisions.map((d: Row) => d.entity_id)).toContain(proposalId);
    });

    it('cannot be forged or altered through the approvals API', async () => {
      expect((await as['Project Manager'].post('/api/approvals').send({ id: 'apr-fake', approval_number: 'X', approval_type: 'AI Proposal', title: 'x', description: 'x', project_id: 'proj-1', project_name: 'A', assigned_approver_role: 'Project Manager', date_requested: '', decision: 'Pending', proposal: { action: 'create_task', params: {} } })).status).toBe(403);
      await as['Owner / CEO'].patch(`/api/approvals/${proposalId}`).send({ proposal: { action: 'create_task', params: { project_id: 'proj-1', title: 'Something else', assigned_user_id: 'user-owner' } } });
      const stored = (await db.pool.query('SELECT data FROM approvals WHERE id = $1', [proposalId])).rows[0].data;
      expect(stored.proposal.params.title).toBe('Recover the overdue site tasks');
    });

    it('executes once the human approves, as the approver, and audits it', async () => {
      await as['Owner / CEO'].post(`/api/approvals/${proposalId}/decision`).send({ decision: 'Approved' }).expect(200);
      const task = (await db.pool.query('SELECT assigned_user_id, project_id, status, data FROM tasks WHERE id = $1', [`tsk-ai-${proposalId}`])).rows[0];
      expect(task).toMatchObject({ assigned_user_id: 'user-pm', project_id: 'proj-1', status: 'Open' });
      expect(task.data.source_module).toBe('AI Assistant (approved)');
      const actions = (await db.pool.query(`SELECT action, actor_id FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [proposalId])).rows;
      expect(actions.map((r) => r.action)).toEqual(expect.arrayContaining(['ai.proposal.create', 'approval.approve', 'ai.proposal.execute']));
      expect(actions.find((r) => r.action === 'ai.proposal.execute')!.actor_id).toBe('user-owner');
      expect((await db.pool.query('SELECT data FROM approvals WHERE id = $1', [proposalId])).rows[0].data.execution).toMatchObject({ executed_as: 'user-owner' });
      // Decisions are final: no second execution, no duplicate task.
      await as['Owner / CEO'].post(`/api/approvals/${proposalId}/decision`).send({ decision: 'Approved' }).expect(200); // unchanged: a no-op
      expect((await as['Owner / CEO'].post(`/api/approvals/${proposalId}/decision`).send({ decision: 'Rejected' })).status).toBe(403);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ai.proposal.execute' AND entity_id = $1`, [proposalId])).rows[0].n).toBe(1);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM tasks WHERE data->>'source_event' = $1`, [`ai_proposal:${proposalId}`])).rows[0].n).toBe(1);
    });

    it("runs with the approver's permissions: no permission, no execution", async () => {
      // A site supervisor may ask for a proposal but may not create tasks: approving it fails and nothing happens.
      const res = await as['Site Supervisor'].post('/api/assistant/proposals').send({ action: 'create_task', params: { project_id: 'proj-1', title: 'Order more screws', assigned_user_id: 'user-purchasing' } }).expect(201);
      const denied = await as['Site Supervisor'].post(`/api/approvals/${res.body.id}/decision`).send({ decision: 'Approved' });
      expect(denied.status).toBe(403);
      expect((await db.pool.query('SELECT decision FROM approvals WHERE id = $1', [res.body.id])).rows[0].decision).toBe('Pending');
      expect((await db.pool.query('SELECT 1 FROM tasks WHERE id = $1', [`tsk-ai-${res.body.id}`])).rowCount).toBe(0);
      // A reminder proposal the supervisor can execute (they can act on tasks they see).
      const remind = await as['Site Supervisor'].post('/api/assistant/proposals').send({ action: 'remind_task_assignee', params: { task_id: 'ai-t1' } }).expect(201);
      await as['Site Supervisor'].post(`/api/approvals/${remind.body.id}/decision`).send({ decision: 'Approved' }).expect(200);
      expect((await db.pool.query(`SELECT user_id, source FROM notifications WHERE rule_key = $1`, [`ai:${remind.body.id}`])).rows).toEqual([{ user_id: 'user-site', source: 'ai_assistant' }]);
      // Another user can't see or decide someone else's proposal unless they're the owner.
      expect((await as['Project Manager'].get('/api/assistant/proposals').expect(200)).body.map((p: Row) => p.id)).not.toContain(remind.body.id);
    });

    it('a proposal touching a project outside the asker scope is refused', async () => {
      expect((await as['Production Staff'].post('/api/assistant/proposals').send({ action: 'create_task', params: { project_id: 'proj-x', title: 'x', assigned_user_id: 'user-pm' } })).status).toBe(403);
      expect((await as['Site Supervisor'].post('/api/assistant/proposals').send({ action: 'create_task', params: { project_id: 'proj-x', title: 'x', assigned_user_id: 'user-pm' } })).status).toBe(403);
    });
  });
});
