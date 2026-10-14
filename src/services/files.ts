/**
 * Private project files (server/files): drawings, revisions, site photographs, attachments.
 * Only in database mode; the server authorizes every upload and download.
 */
export type FilePurpose = 'drawing' | 'site_photo' | 'attachment';

export interface StoredFile {
  id: string;
  url: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  purpose?: FilePurpose;
  record_collection?: string | null;
  record_id?: string | null;
  revision_id?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at?: string;
}

/** Accepted file types per purpose (the server checks the bytes as well). */
export const FILE_ACCEPT: Record<FilePurpose, string> = {
  drawing: '.pdf,.png,.jpg,.jpeg,.dwg,.dxf',
  site_photo: 'image/jpeg,image/png,image/webp,.heic,.heif',
  attachment: '.pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.docx,.dwg,.dxf',
};

/** Whether this page talks to the server's file store (database mode, signed in). */
export async function filesAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session');
    const body = await res.json();
    return Boolean(body?.authEnabled && body?.user);
  } catch {
    return false;
  }
}

export async function uploadFile(
  file: File,
  where: { purpose: FilePurpose; projectId?: string; recordCollection?: string; recordId?: string }
): Promise<StoredFile> {
  const q = new URLSearchParams({ purpose: where.purpose });
  if (where.projectId) q.set('project_id', where.projectId);
  if (where.recordCollection) q.set('record_collection', where.recordCollection);
  if (where.recordId) q.set('record_id', where.recordId);
  const res = await fetch(`/api/files?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-NWOS-Upload': '1', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Upload failed (HTTP ${res.status})`);
  return body as StoredFile;
}

export async function listRecordFiles(recordCollection: string, recordId: string): Promise<StoredFile[]> {
  const res = await fetch(`/api/files?${new URLSearchParams({ record_collection: recordCollection, record_id: recordId })}`);
  if (!res.ok) return [];
  return res.json();
}

export const isStoredFileUrl = (url: unknown): url is string => typeof url === 'string' && url.startsWith('/api/files/');

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
