import { describe, expect, it } from 'vitest';
import { checkOrderRevisions } from './hooks/production';
import type { PoolClient } from '../db/pool';

describe('production drawing project ownership', () => {
  const check = (clientProject: string, nwProject: string) => {
    const revisions = [
      { id: 'client', drawing_id: 'client-drawing', kind: 'client', approval_status: 'Approved', is_current: true },
      { id: 'nw', drawing_id: 'nw-drawing', kind: 'nw_production', approval_status: 'Approved', linked_client_revision_id: 'client' },
    ];
    const db = { query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM drawing_revisions')) return { rows: revisions.filter((r) => r.id === params[0]) };
      if (sql.includes('FROM drawings')) return { rows: [{ id: 'client-drawing', project_id: clientProject }, { id: 'nw-drawing', project_id: nwProject }] };
      throw new Error(`Unexpected query: ${sql}`);
    } } as unknown as PoolClient;
    return checkOrderRevisions(db, { project_id: 'expected', client_drawing_revision_id: 'client', nw_drawing_revision_id: 'nw' });
  };
  it.each([['other', 'other'], ['expected', 'other'], ['other', 'expected']])('refuses approved revisions from %s / %s', async (client, nw) => {
    expect(await check(client, nw)).toMatchObject({ valid: false, reason: expect.stringContaining('production order project') });
  });
  it('retains a valid same-project pair', async () => {
    expect(await check('expected', 'expected')).toMatchObject({ valid: true });
  });
});
