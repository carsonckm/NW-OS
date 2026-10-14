/**
 * The files attached to one record (an issue, a variation, …), kept privately on the server.
 * Database mode only: lists what this user may open and, with `canUpload`, adds attachments.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { FILE_ACCEPT, filesAvailable, formatBytes, listRecordFiles, uploadFile, type StoredFile } from '../services/files';

export const RecordFiles: React.FC<{ collection: string; recordId: string; canUpload: boolean }> = ({ collection, recordId, canUpload }) => {
  const [available, setAvailable] = useState(false);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setFiles(await listRecordFiles(collection, recordId)), [collection, recordId]);
  useEffect(() => {
    void filesAvailable().then((ok) => {
      setAvailable(ok);
      if (ok) void load();
    });
  }, [load]);

  if (!available) return null;

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(list)) await uploadFile(f, { purpose: 'attachment', recordCollection: collection, recordId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be uploaded');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid={`record-files-${recordId}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <Paperclip className="h-3.5 w-3.5" /> Files ({files.length})
      </div>
      {files.length > 0 && (
        <ul className="space-y-1 text-xs">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="truncate font-semibold text-slate-800 underline hover:text-amber-700">
                {f.file_name}
              </a>
              <span className="shrink-0 text-[11px] text-slate-500">
                {formatBytes(f.size_bytes)} · {f.uploaded_by_name ?? ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <label className="inline-block cursor-pointer text-xs font-semibold text-slate-700 underline">
          {busy ? 'Uploading…' : 'Attach a file'}
          <input type="file" multiple className="hidden" accept={FILE_ACCEPT.attachment} aria-label="Attach a file" disabled={busy} onChange={(e) => void add(e.target.files)} />
        </label>
      )}
      {error && <div role="alert" className="text-xs text-rose-700">{error}</div>}
    </div>
  );
};
