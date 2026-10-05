import { describe, expect, it } from 'vitest';
import { SYNCED_COLLECTIONS } from '../../src/services/syncedCollections';
import { MODULES } from '../modules/registry';
import { explainRefusal, rolesWith } from './explain';

describe('refusal messages', () => {
  it('names the permission and who holds it', () => {
    expect(explainRefusal('Missing permission: drawings.approve')).toBe('This needs the “Approve Drawings” permission, which Owner / CEO has');
    expect(explainRefusal('Missing permission: production.create_orders (put on hold / resume)')).toMatch(
      /^To put on hold \/ resume, you need the “.+” permission, which Owner \/ CEO, Production Manager have$/
    );
  });

  it('leaves other messages alone and never adds internals', () => {
    expect(explainRefusal('Revision rev-3 is superseded and cannot change status')).toBe('Revision rev-3 is superseded and cannot change status');
  });

  it('derives roles from the shared role table', () => {
    expect(rolesWith('drawings.approve')).toEqual(['Owner / CEO']);
  });
});

describe('browser collection paths', () => {
  it('match the server registry', () => {
    const server = new Map(MODULES.map((m) => [m.key, m.path]));
    for (const c of SYNCED_COLLECTIONS) {
      if (['clients', 'projects', 'workPackages', 'workItems'].includes(c.key)) continue;
      expect(server.get(c.key), c.key).toBe(c.path);
    }
  });
});
