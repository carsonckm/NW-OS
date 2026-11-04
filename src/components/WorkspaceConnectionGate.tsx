import React, { type ReactNode } from 'react';
import { useNW } from '../context/NWContext';

/** Authenticated workflows wait for an authoritative snapshot, including after an offline start. */
export function WorkspaceConnectionGate({ children }: { children: ReactNode }) {
  const { coreDataSync } = useNW();
  if (coreDataSync.mode !== 'database' || coreDataSync.lastSyncedAt) return <>{children}</>;
  const failed = coreDataSync.status === 'error';
  return (
    <section role="status" className="mx-auto my-10 max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h2 className="text-lg font-semibold">{failed ? 'Connect to your workspace' : 'Loading your workspace…'}</h2>
      <p className="mt-2 text-sm text-slate-600">{failed ? 'Reconnect to load current records before making changes.' : 'Waiting for your saved records.'}</p>
      {failed && <button type="button" onClick={() => { void coreDataSync.reloadFromDatabase(); }} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Retry connection</button>}
    </section>
  );
}
