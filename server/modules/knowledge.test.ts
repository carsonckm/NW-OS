import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { runAutomation } from './automation';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 knowledge base and recurring problems', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const prod = () => as['Production Manager'];
  const article = (over: Row = {}) => ({ id: 'kb-hinge', title: 'Soft-close hinge adjustment on tall doors', category: 'Hardware', status: 'Draft', problem: 'Tall doors drop after a week and rub the plinth.', solution: 'Use three hinges above 1800mm and pre-tension the cup.', procedure: '1. Add a third hinge. 2. Set the cam. 3. Re-check after 24h.', project_type: 'Retail', tags: ['Hinges', 'hinges', ' Doors '], photos: [], created_at: '', ...over });

  describe('knowledge base', () => {
    it('uses the Phase 5 categories and structured fields', async () => {
      expect((await prod().post('/api/knowledge').send(article({ id: 'kb-bad', category: 'Joinery' }))).status).toBe(400);
      const a = (await prod().post('/api/knowledge').send(article()).expect(201)).body;
      expect(a).toMatchObject({ revision: 1, tags: ['hinges', 'doors'], project_type: 'Retail', created_by_id: 'user-prod-mgr' });
      expect((await prod().post('/api/knowledge').send(article({ id: 'kb-empty', problem: '', description: '', status: 'Review' }))).status).toBe(400);
    });

    it('is official only once approved; usage is recorded only for approved knowledge', async () => {
      expect((await prod().post('/api/knowledge/kb-hinge/usage').send({ project_id: 'proj-1' })).status).toBe(400);
      await prod().patch('/api/knowledge/kb-hinge').send({ status: 'Review' }).expect(200);
      await owner().patch('/api/knowledge/kb-hinge').send({ status: 'Approved' }).expect(200);
      await prod().post('/api/knowledge/kb-hinge/usage').send({ project_id: 'proj-1', entity_type: 'issue', entity_id: 'i-1', note: 'Applied on CAR-003' }).expect(201);
      await owner().post('/api/knowledge/kb-hinge/usage').send({ project_id: 'proj-x' }).expect(201);
      // Can't log use on a project you can't see; usage there is hidden from you.
      expect((await as['Project Manager'].post('/api/knowledge/kb-hinge/usage').send({ project_id: 'proj-x' })).status).toBe(403);
      const kb = (await prod().get('/api/knowledge/kb-hinge').expect(200)).body;
      expect(kb.usage_count).toBe(2);
      const usage = (await as['Project Manager'].get('/api/knowledge/kb-hinge/usage').expect(200)).body as Row[];
      expect(usage.find((u) => u.project_id === 'proj-1')).toMatchObject({ user_id: 'user-prod-mgr', entity_type: 'issue' });
      expect(usage.filter((u) => u.hidden).length).toBe(usage.length - 1);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'knowledge.used' AND entity_id = 'kb-hinge'`)).rows[0].n).toBe(2);
      // Archiving an approved article with a usage count isn't blocked by the computed field.
      expect((await prod().patch('/api/knowledge/kb-hinge').send({ ...kb, solution: 'rewritten' })).status).toBe(403);
    });

    it('revises a published article: new numbered revision, approval supersedes the old one', async () => {
      expect((await prod().post('/api/knowledge').send(article({ id: 'kb-rev-bad', supersedes_id: 'kb-nope' }))).status).toBe(400);
      const r2 = (await prod().post('/api/knowledge').send(article({ id: 'kb-hinge-2', supersedes_id: 'kb-hinge', revision: 9, solution: 'Three hinges above 1700mm.' })).expect(201)).body;
      expect(r2).toMatchObject({ revision: 2, supersedes_id: 'kb-hinge', status: 'Draft' });
      expect((await prod().post('/api/knowledge').send(article({ id: 'kb-hinge-2b', supersedes_id: 'kb-hinge' }))).status).toBe(400);
      // The draft revision isn't official: the original stays published until approval.
      expect((await db.pool.query(`SELECT status FROM knowledge_articles WHERE id = 'kb-hinge'`)).rows[0].status).toBe('Approved');
      await prod().patch('/api/knowledge/kb-hinge-2').send({ status: 'Review' }).expect(200);
      await owner().patch('/api/knowledge/kb-hinge-2').send({ status: 'Approved' }).expect(200);
      const old = (await db.pool.query(`SELECT status, data FROM knowledge_articles WHERE id = 'kb-hinge'`)).rows[0];
      expect(old.status).toBe('Archived');
      expect(old.data.superseded_by).toBe('kb-hinge-2');
      expect((await db.pool.query(`SELECT 1 FROM audit_logs WHERE action = 'knowledge.superseded' AND entity_id = 'kb-hinge'`)).rowCount).toBe(1);
    });

    it('the assistant quotes approved knowledge only', async () => {
      await prod().post('/api/knowledge').send(article({ id: 'kb-draft-only', title: 'Zebrawood veneer sealing', problem: 'zebrawood blotches', solution: 'secret draft method', tags: ['zebrawood'] })).expect(201);
      const draft = (await prod().post('/api/assistant/ask').send({ question: 'What is the procedure for zebrawood veneer?' }).expect(200)).body;
      expect(draft.intent).toBe('knowledge');
      expect(JSON.stringify(draft)).not.toContain('secret draft method');
      expect(draft.facts[0].confidence).toBe('Unknown');
      const hinge = (await prod().post('/api/assistant/ask').send({ question: 'How should we fix tall doors with hinges dropping?' }).expect(200)).body;
      expect(hinge.facts[0]).toMatchObject({ confidence: 'Confirmed', source: { type: 'knowledge', id: 'kb-hinge-2' } });
      expect(hinge.facts.map((f: Row) => f.source?.id)).not.toContain('kb-hinge'); // archived revision
    });
  });

  describe('recurring problems', () => {
    const issue = (id: string, project: string) => ({ id, project_id: project, title: `Drawing clash ${id}`, category: 'Drawing / Design', priority: 'Medium', status: 'Reported', reported_by: 'x', reported_by_role: 'x', assigned_to: 'x', escalation_level: 'PM', action_required: 'x', description: 'x', created_at: '', updated_at: '' });
    const pattern = async (role = 'Owner / CEO') => ((await as[role].get('/api/recurring-problems').expect(200)).body as Row[]).find((p) => p.key === 'issue:Drawing / Design');

    it('detects the same problem recurring, with evidence and a suggestion', async () => {
      expect(await pattern()).toBeUndefined();
      await owner().post('/api/issues').send(issue('rp-1', 'proj-1')).expect(201);
      await owner().post('/api/issues').send(issue('rp-2', 'proj-x')).expect(201);
      const p = await pattern();
      expect(p).toMatchObject({ kind: 'issue_category', occurrences: 2, open: true, knowledge_category: 'Drawings', review: null });
      expect(p.projects.sort()).toEqual(['proj-1', 'proj-x']);
      expect(p.examples.map((e: Row) => e.id).sort()).toEqual(['rp-1', 'rp-2']);
      expect(p.suggestion).toMatch(/approved Drawings article/);
    });

    it('only uses records the user may see; clients and contractors get none', async () => {
      const ctx = await db.pool.query(`SELECT 1 FROM project_assignments WHERE user_id = 'user-pm' AND project_id = 'proj-x'`);
      const pm = await pattern('Project Manager');
      if (!ctx.rowCount) expect(pm?.projects ?? []).not.toContain('proj-x');
      expect((await as['Contractor'].get('/api/recurring-problems')).status).toBe(403);
      expect((await as['Client'].get('/api/recurring-problems')).status).toBe(403);
    });

    it('notifies knowledge editors once per growth step, never acting on its own', async () => {
      await runAutomation(db.pool);
      await runAutomation(db.pool);
      const notes = (await db.pool.query(`SELECT user_id FROM notifications WHERE rule_key = 'recurring:issue:Drawing / Design:2'`)).rows.map((r) => r.user_id);
      expect(notes).toEqual(['user-owner']);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM knowledge_articles WHERE data->>'source_pattern_key' = 'issue:Drawing / Design'`)).rows[0].n).toBe(0);
    });

    it('a person decides: draft a lessons-learned article, or dismiss with a reason', async () => {
      expect((await as['Site Supervisor'].post('/api/recurring-problems/review').send({ pattern_key: 'issue:Drawing / Design', decision: 'Dismissed', note: 'x' })).status).toBe(403);
      expect((await owner().post('/api/recurring-problems/review').send({ pattern_key: 'issue:Drawing / Design', decision: 'Dismissed' })).status).toBe(400);
      expect((await owner().post('/api/recurring-problems/review').send({ pattern_key: 'issue:Nope', decision: 'Action taken' })).status).toBe(400);
      const draft = (await prod().post('/api/recurring-problems/draft-knowledge').send({ pattern_key: 'issue:Drawing / Design' }).expect(201)).body;
      expect(draft).toMatchObject({ status: 'Draft', category: 'Drawings', created_by_id: 'user-prod-mgr', solution: '' });
      expect(draft.problem).toMatch(/rp-1/);
      const p = await pattern();
      expect(p).toMatchObject({ open: false, review: { decision: 'Knowledge drafted', article_id: draft.id } });
      // It comes back only if it keeps happening.
      await owner().post('/api/issues').send(issue('rp-3', 'proj-1')).expect(201);
      expect(await pattern()).toMatchObject({ occurrences: 3, open: true });
      await owner().post('/api/recurring-problems/review').send({ pattern_key: 'issue:Drawing / Design', decision: 'Action taken', note: 'Drawing checklist added to kick-off' }).expect(200);
      expect(await pattern()).toMatchObject({ open: false, review: { decision: 'Action taken', occurrences: 3 } });
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'recurring.review'`)).rows[0].n).toBe(2);
    });
  });
});
