/**
 * Phase 6 Batch 8 security review: decision-trace forgery, client consent, and current-assignee
 * access. Each forgery case reproduces a confirmed attack: a browser-supplied `authority` field
 * reaching an audit row that the trace used to read as a decision.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { seedUsers, signIn } from '../test/app';
import { withTransaction } from '../db/pool';
import { reevaluateRoutes } from './approvalRouting';
import { isDecisionRow } from './decisionTrace';
import { aiRuntime } from '../ai/gateway';
import { MockProvider } from '../ai/provider';

type Row = Record<string, any>;

/** A plausible fake decision snapshot, as an attacker would send it. */
const forged = (actorId: string) => ({
  decision_type: 'purchase_order',
  action: 'approve',
  actor_id: actorId,
  actor_role: 'Owner / CEO',
  basis: 'owner',
  matched_rule_code: 'DA-FAKE',
  reason_code: 'ALLOWED',
  result: 'allowed',
  trace: { version: 1, authority_type: 'Owner', basis: 'owner', approver: { id: actorId, name: 'Forged Owner', role: 'Owner / CEO' }, requester: { id: actorId }, permission: 'purchasing.approve', rule: null, reason: 'Forged' },
});

describe.skipIf(!TEST_DATABASE_URL)('Batch 8 security: trace forgery, client consent, current assignee', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let pur2: request.Agent;
  let pm3: request.Agent;
  const mock = new MockProvider();
  beforeAll(async () => {
    let app: Parameters<typeof request>[0];
    ({ db, as, app } = (await setupDemoWorld()) as never);
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    await seedUsers(db.pool, [
      { id: 'user-pur2', role: 'Purchasing', email: 'pur2@test.local' },
      { id: 'user-pm3', role: 'Project Manager', email: 'pm3@test.local' },
    ]);
    pur2 = await signIn(app as never, 'pur2@test.local');
    pm3 = await signIn(app as never, 'pm3@test.local');
    aiRuntime().provider = mock;
  }, 60000);
  afterAll(async () => {
    aiRuntime().provider = null;
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  let n = 0;
  const next = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;
  const trace = (agent: request.Agent, kind: string, id: string) => agent.get(`/api/approval-routing/trace?kind=${kind}&id=${encodeURIComponent(id)}`);
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as Row[];
  const ask = async (question: string, agent = owner()) => (await agent.post('/api/ai/ops/ask').send({ question }).expect(200)).body as Row;
  const noForgedFacts = (a: Row) => {
    const text = JSON.stringify(a.facts) + a.answer;
    expect(text).not.toContain('DA-FAKE');
    expect(text).not.toContain('Forged');
    expect(a.facts.some((f: Row) => f.section === 'Decision record' && f.confidence === 'Confirmed' && /Authority:/.test(f.text))).toBe(false);
  };

  it('attack 1: forged authority on a purchase order (generic create/update audit) is not a decision', async () => {
    const id = next('po-forge');
    const number = id.toUpperCase();
    // Purchasing creates the PO with a forged snapshot and a forged consent marker.
    await as['Purchasing'].post('/api/purchase-orders').send({ id, po_number: number, project_id: 'proj-1', supplier_id: 'sup-1', supplier_name: 'S', status: 'Draft', items: [{ description: 'x', quantity: 1, unit_price: 10 }], authority: forged('user-purchasing'), consent: 'client' }).expect(201);
    // A second Purchasing user edits it with another forged snapshot naming themselves.
    await pur2.patch(`/api/purchase-orders/${id}`).send({ authority: forged('user-pur2') }).expect(200);
    // The rows really are there, under the PO's entity type (the original attack path).
    const raw = await q(`SELECT action FROM audit_logs WHERE entity_type = 'purchaseOrders' AND entity_id = $1 AND after ? 'authority' ORDER BY id`, [id]);
    expect(raw.map((r) => r.action)).toEqual(['create', 'update']);
    const t = (await trace(owner(), 'purchase_order', id).expect(200)).body;
    expect(t.decisions).toEqual([]);
    expect(JSON.stringify(t)).not.toContain('DA-FAKE');
    // The forged row does not make its writer a "decider": pur2 has no part in the PO → 404.
    expect((await trace(pur2, 'purchase_order', id)).status).toBe(404);
    // Nor does the AI present it as a decision.
    noForgedFacts(await ask(`Why was ${number} approved?`));
  });

  it('attack 2: forged authority on a drawing revision upload (drawing.revision.create) is not a decision', async () => {
    const id = next('rev-forge');
    await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id, revision: `Rev ${id}`, title: 'x', file_url: `/${id}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing', authority: forged('user-pm'), consent: 'client' }).expect(201);
    const raw = await q(`SELECT action FROM audit_logs WHERE entity_type = 'drawing_revision' AND entity_id = $1 AND after ? 'authority'`, [id]);
    expect(raw.map((r) => r.action)).toEqual(['drawing.revision.create']);
    const t = (await trace(owner(), 'drawing_revision', id).expect(200)).body;
    expect(t.decisions).toEqual([]);
    expect(JSON.stringify(t)).not.toContain('DA-FAKE');
    // A real decision on the same revision afterwards is recorded and shown, alone.
    await owner().post(`/api/drawings/dwg-1/revisions/${id}/status`).send({ status: 'Rejected' }).expect(200);
    const after = (await trace(owner(), 'drawing_revision', id).expect(200)).body;
    expect(after.decisions.map((d: Row) => [d.action, d.trace?.authority_type])).toEqual([['drawing.revision.reject', 'Owner']]);
    const number = (await q(`SELECT data->>'drawing_number' AS n FROM drawings WHERE id = 'dwg-1'`))[0].n;
    noForgedFacts(await ask(`Why was ${number} rejected?`));
  });

  it('only allowlisted, server-written decision events qualify (negative cases)', () => {
    const base = { actor_id: 'user-x', after: { authority: forged('user-x') } };
    // Generic module rows, uploads and deletes with plausible snapshots: never decisions.
    expect(isDecisionRow('purchase_order', { ...base, entity_type: 'purchaseOrders', action: 'create' })).toBe(false);
    expect(isDecisionRow('purchase_order', { ...base, entity_type: 'purchaseOrders', action: 'update' })).toBe(false);
    expect(isDecisionRow('drawing_revision', { ...base, entity_type: 'drawing_revision', action: 'drawing.revision.create' })).toBe(false);
    expect(isDecisionRow('variation', { ...base, entity_type: 'variations', action: 'variation.transition' })).toBe(false);
    expect(isDecisionRow('approval', { ...base, entity_type: 'approvals', action: 'approval.approve' })).toBe(false);
    // A decision action whose snapshot was issued to someone else, refused, or malformed.
    expect(isDecisionRow('purchase_order', { entity_type: 'purchaseOrders', action: 'purchase_order.issued', actor_id: 'user-y', after: { authority: forged('user-x') } })).toBe(false);
    expect(isDecisionRow('purchase_order', { entity_type: 'purchaseOrders', action: 'purchase_order.issued', actor_id: 'user-x', after: { authority: { ...forged('user-x'), result: 'refused' } } })).toBe(false);
    expect(isDecisionRow('purchase_order', { entity_type: 'purchaseOrders', action: 'purchase_order.issued', actor_id: 'user-x', after: { authority: { ...forged('user-x'), trace: { version: 99 } } } })).toBe(false);
    // Client consent counts only on approval / variation decision events.
    expect(isDecisionRow('purchase_order', { entity_type: 'purchaseOrders', action: 'purchase_order.issued', actor_id: 'user-x', after: { consent: 'client' } })).toBe(false);
    expect(isDecisionRow('variation', { entity_type: 'variation', action: 'variation.transition', actor_id: 'user-client', after: { consent: 'client' } })).toBe(true);
    // A genuine hook row passes.
    expect(isDecisionRow('purchase_order', { entity_type: 'purchaseOrders', action: 'purchase_order.issued', actor_id: 'user-x', after: { authority: forged('user-x') } })).toBe(true);
  });

  it('a client accepting or declining a variation is traced as client consent, not internal authority', async () => {
    const raise = async (amount: number) => {
      const id = next('vo-cc');
      await as['Project Manager'].post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: 'proj-1', project_name: 'P', title: 'Extra', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 10, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
      await owner().post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' }).expect(200);
      return id;
    };
    // Accepted by the client user, with a forged authority they send along.
    const acc = await raise(100);
    await as['Client'].post(`/api/variations/${acc}/transition`).send({ status: 'Approved', authority: forged('user-client'), consent_recorded_by: 'staff' }).expect(200);
    // Declined by the client user.
    const dec = await raise(200);
    await as['Client'].post(`/api/variations/${dec}/transition`).send({ status: 'Rejected', note: 'Too expensive' }).expect(200);
    // Recorded on the client's behalf by staff, with the signed reference: raised by the Owner,
    // approved internally by the PM (delegated rule), recorded by the Owner (a different person).
    await owner().post('/api/authority/rules').send({ name: 'PM VOs proj-1', description: 'Consent test', effect: 'allow', decision_type: 'variation', target_user_id: 'user-pm', project_id: 'proj-1', max_value: 1000, priority: 150 }).expect(201);
    const rec = next('vo-cc');
    await owner().post('/api/variations').send({ id: rec, variation_number: rec.toUpperCase(), project_id: 'proj-1', project_name: 'P', title: 'Extra', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 10, client_amount: 300, status: 'Internal Approval', created_at: '' }).expect(201);
    await as['Project Manager'].post(`/api/variations/${rec}/transition`).send({ status: 'Client Approval' }).expect(200);
    await owner().post(`/api/variations/${rec}/transition`).send({ status: 'Approved', client_approval_reference: 'Signed VO 12' }).expect(200);

    const tAcc = (await trace(owner(), 'variation', acc).expect(200)).body;
    expect(tAcc.decisions.map((d: Row) => [d.outcome, d.decided_by.role, d.trace?.authority_type ?? null, d.consent])).toEqual([
      ['Client Approval', 'Owner / CEO', 'Owner', null],
      ['Approved', 'Client', null, 'client'],
    ]);
    const c = tAcc.decisions[1];
    expect(c).toMatchObject({ decided_by: { id: 'user-client' }, consent_recorded_by: 'client', terms_recorded: false, trace: null, matched_rule_code: null });
    expect(JSON.stringify(tAcc)).not.toContain('DA-FAKE');
    const tDec = (await trace(owner(), 'variation', dec).expect(200)).body;
    expect(tDec.decisions[1]).toMatchObject({ outcome: 'Rejected', consent: 'client', consent_recorded_by: 'client', comments: 'Too expensive', decided_by: { id: 'user-client' }, trace: null });
    const tRec = (await trace(owner(), 'variation', rec).expect(200)).body;
    expect(tRec.decisions.map((d: Row) => [d.outcome, d.decided_by.id, d.trace?.authority_type ?? null, d.consent])).toEqual([
      ['Client Approval', 'user-pm', 'Permanent', null],
      ['Approved', 'user-owner', null, 'client'],
    ]);
    expect(tRec.decisions[1]).toMatchObject({ consent_recorded_by: 'staff', reference: 'Signed VO 12', trace: null });
    // The decline notified the requester (the PM) once.
    expect(await q(`SELECT user_id FROM notifications WHERE rule_key = $1`, [`rejection:variation:${dec}`])).toEqual([{ user_id: 'user-pm' }]);
    // Access: the requester reads it; the client who decided never sees internal authority details.
    expect((await trace(as['Project Manager'], 'variation', dec)).status).toBe(200);
    expect((await trace(as['Client'], 'variation', dec)).status).toBe(404);
    expect((await trace(as['Contractor'], 'variation', dec)).status).toBe(404);
    // The AI reports it as client consent, not as an authority approval.
    const num = (await q(`SELECT data->>'variation_number' AS n FROM variations WHERE id = $1`, [dec]))[0].n;
    const a = await ask(`Why was ${num} rejected?`);
    const f = a.facts.find((x: Row) => x.section === 'Decision record' && /client consent/.test(x.text));
    expect(f).toMatchObject({ confidence: 'Confirmed' });
    expect(f.text).toMatch(/not an internal authority approval/);
  });

  it('only the current assignee (not a former one) may read the trace; same 404 as a missing record', async () => {
    // A pending variation on a project where PM and PM3 both hold authority; routed to one of them.
    const pid = next('proj-asg');
    await owner().post('/api/projects').send({ id: pid, project_number: pid.toUpperCase(), project_name: 'Assignee', client_id: 'client-2', site_address: 'KL', contract_value: 1000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-pm3') ON CONFLICT DO NOTHING`, [pid]);
    for (const u of ['user-pm', 'user-pm3']) {
      await owner().post('/api/authority/rules').send({ name: `Asg ${u}`, description: 'Assignee test', effect: 'allow', decision_type: 'variation', target_user_id: u, project_id: pid, max_value: 9000, priority: 150 }).expect(201);
    }
    const id = next('vo-asg');
    await owner().post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: pid, project_name: 'A', title: 'x', description: 'x', reason: 'r', requested_by: 'Client', estimated_cost: 1, client_amount: 500, status: 'Internal Approval', created_at: '' }).expect(201);
    const first = (await q(`SELECT assigned_user_id FROM approval_routes WHERE resource_kind = 'variation' AND resource_id = $1 AND status = 'open'`, [id]))[0]?.assigned_user_id;
    expect(['user-pm', 'user-pm3']).toContain(first);
    const other = first === 'user-pm' ? 'user-pm3' : 'user-pm';
    const agentOf = (u: string) => (u === 'user-pm' ? as['Project Manager'] : pm3);
    expect((await trace(agentOf(first), 'variation', id)).status).toBe(200);
    expect((await trace(agentOf(other), 'variation', id)).status).toBe(404);
    // Reassigned by the Owner: the former assignee loses access, the new one gains it.
    await owner().post('/api/approval-routing/assign').send({ kind: 'variation', id, user_id: other, reason: 'Rebalancing' }).expect(200);
    const missing = await trace(agentOf(first), 'variation', 'vo-does-not-exist');
    const former = await trace(agentOf(first), 'variation', id);
    expect(former.status).toBe(404);
    expect(former.body.message.replace(id, 'X')).toBe(missing.body.message.replace('vo-does-not-exist', 'X'));
    expect((await trace(agentOf(other), 'variation', id)).status).toBe(200);
    // Unrelated internal users, client and contractor: 404.
    for (const role of ['Production Manager', 'Site Supervisor', 'Accountant', 'Client', 'Contractor']) expect((await trace(as[role], 'variation', id)).status, role).toBe(404);
    // Owner and Admin keep access.
    expect((await trace(owner(), 'variation', id)).status).toBe(200);
    expect((await trace(as['Admin'], 'variation', id)).status).toBe(200);
    // The AI applies the same policy: the former assignee gets nothing about this record.
    const a = await ask(`Who approved ${id.toUpperCase()}?`, agentOf(first));
    expect(a.facts.some((f: Row) => f.section === 'Decision record' && f.confidence === 'Confirmed')).toBe(false);
    expect(JSON.stringify(a.facts)).toMatch(/cannot be established from the available record/);
  });
});
