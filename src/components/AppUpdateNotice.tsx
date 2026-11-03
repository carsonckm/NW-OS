import React, { useEffect, useState } from 'react';

/** New workers must not silently leave a signed-in user running the previous UI. */
export function AppUpdateNotice({ busy, onReload = () => window.location.reload() }: { busy: boolean; onReload?: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const workers = navigator.serviceWorker;
    if (!workers) return;
    let controlled = Boolean(workers.controller);
    const changed = () => {
      if (controlled) setReady(true);
      controlled = true;
    };
    workers.addEventListener('controllerchange', changed);
    return () => workers.removeEventListener('controllerchange', changed);
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <span>A new version is ready. Reload after your changes have saved.</span>
      <button type="button" disabled={busy} onClick={onReload} className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white disabled:opacity-50">Reload updated app</button>
    </div>
  );
}
