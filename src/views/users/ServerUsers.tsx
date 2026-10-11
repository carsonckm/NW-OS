/**
 * User administration against the server (/api/users). Accounts, roles, activation and
 * project assignments live in PostgreSQL; the server checks users.view / users.manage, stops
 * anyone but an Owner from creating or changing Owner accounts, stops self-demotion, and
 * audits every change. There is no role switching: a role is a property of the account.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, UserCog } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { UserRole } from '../../types';
import { api } from '../../services/coreApi';
import { actionErrorOf } from '../../services/records';
import { ROLE_DEFINITIONS, hasPermission } from '../../utils/permissions';
import { FormError } from '../../components/ui/FormError';
import { Button, Field, Input, Modal, Pill, Select } from '../../components/ui/forms';

export interface ServerUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  is_dev_seed: boolean;
  client_id: string | null;
  contractor_id: string | null;
  phone: string | null;
  department: string | null;
  title: string | null;
  last_login: string | null;
  assigned_project_ids: string[];
  credential?: { has_credential: boolean; credential_set_at: string | null; code_purpose: string | null; code_expires_at: string | null };
}

/** A single-use code, shown once to whoever issued it (Batch 12B). */
interface IssuedCode {
  name: string;
  email: string;
  code: string;
  expires_at: string;
  purpose: 'activation' | 'reset';
}

const ROLES = Object.keys(ROLE_DEFINITIONS) as UserRole[];
// These roles see only the projects assigned here (server: AccessContext). A Production Manager
// with no assignment sees no project (Batch 12B).
const PROJECT_SCOPED: UserRole[] = ['Project Manager', 'Production Manager', 'Site Supervisor', 'Production Staff', 'Contractor', 'Client'];

const UserForm: React.FC<{ user?: ServerUser; onClose: () => void; onSaved: (issued?: IssuedCode) => void }> = ({ user, onClose, onSaved }) => {
  const { projects, clients, contractors } = useNW();
  const [f, setF] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: (user?.role ?? 'Site Supervisor') as UserRole,
    title: user?.title ?? '',
    department: user?.department ?? '',
    phone: user?.phone ?? '',
    client_id: user?.client_id ?? '',
    contractor_id: user?.contractor_id ?? '',
  });
  const [assigned, setAssigned] = useState<string[]>(user?.assigned_project_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        email: f.email.trim(),
        role: f.role,
        title: f.title || null,
        department: f.department || null,
        phone: f.phone || null,
        client_id: f.role === 'Client' ? f.client_id || null : null,
        contractor_id: f.role === 'Contractor' ? f.contractor_id || null : null,
      };
      if (user && user.role === f.role) delete body.role;
      const saved = user
        ? await api.patch<ServerUser>(`/users/${encodeURIComponent(user.id)}`, body)
        : await api.post<ServerUser & { activation?: { code: string; expires_at: string } }>('/users', body);
      const before = [...(user?.assigned_project_ids ?? [])].sort().join();
      if ([...assigned].sort().join() !== before) await api.put(`/users/${encodeURIComponent(saved.id)}/projects`, { project_ids: assigned });
      const activation = (saved as { activation?: { code: string; expires_at: string } }).activation;
      onSaved(activation ? { name: saved.name, email: saved.email, code: activation.code, expires_at: activation.expires_at, purpose: 'activation' } : undefined);
      onClose();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'New user account'}
      subtitle="Saved on the server. Role changes take effect on the user's next request."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={save}>
            {user ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email address" />
        </Field>
        <Field label="Role">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as UserRole })} aria-label="Role">
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Department">
          <Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        {f.role === 'Client' && (
          <Field label="Client company">
            <Select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} aria-label="Client company">
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {f.role === 'Contractor' && (
          <Field label="Contractor company">
            <Select value={f.contractor_id} onChange={(e) => setF({ ...f, contractor_id: e.target.value })} aria-label="Contractor company">
              <option value="">Choose…</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {!user && (
        <p className="text-[11px] text-slate-500">
          The account starts without a password. After you create it you get a single-use activation code to hand to its holder, who chooses their own password with it.
        </p>
      )}
      {PROJECT_SCOPED.includes(f.role) && (
        <Field label="Assigned projects" hint="This role only sees the projects assigned here (none ticked: no projects).">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={assigned.includes(p.id)} onChange={(e) => setAssigned(e.target.checked ? [...assigned, p.id] : assigned.filter((x) => x !== p.id))} />
                {p.project_number} — {p.project_name}
              </label>
            ))}
          </div>
        </Field>
      )}
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};

export const ServerUserManagement: React.FC = () => {
  const { currentUser, projects } = useNW();
  const canManage = hasPermission(currentUser, 'users.manage');
  const [users, setUsers] = useState<ServerUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServerUser | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<ServerUser[]>('/users'));
      setError(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (u: ServerUser) => {
    setBusy(u.id);
    setError(null);
    try {
      await api.patch(`/users/${encodeURIComponent(u.id)}`, { is_active: !u.is_active });
      await load();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };

  // A reset ends the account's password and sessions now; its holder sets a new one with the code.
  const resetPassword = async (u: ServerUser) => {
    if (!window.confirm(`Reset ${u.name}'s password? Their current password and sessions stop working now, and they need the code to set a new one.`)) return;
    setBusy(u.id);
    setError(null);
    try {
      const r = await api.post<{ code: string; expires_at: string }>(`/users/${encodeURIComponent(u.id)}/reset-code`, {});
      setIssued({ name: u.name, email: u.email, code: r.code, expires_at: r.expires_at, purpose: 'reset' });
      await load();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };
  // Only the Owner resets Owner and Admin accounts; nobody resets their own (server-enforced too).
  const mayReset = (u: ServerUser) => u.id !== currentUser.id && u.is_active && (currentUser.role === 'Owner / CEO' || !['Owner / CEO', 'Admin'].includes(u.role));
  const credentialLabel = (u: ServerUser) => {
    if (!u.credential || u.credential.has_credential) return null;
    return u.credential.code_expires_at ? `Needs password · code valid until ${new Date(u.credential.code_expires_at).toLocaleString()}` : 'Needs password · no valid code';
  };

  const projectName = (id: string) => projects.find((p) => p.id === id)?.project_number ?? id;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="server-users">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserCog className="h-5 w-5 text-slate-600" />
          <div>
            <h2 className="text-sm font-black text-slate-900">User accounts ({users?.length ?? '…'})</h2>
            <p className="text-xs text-slate-500">Accounts and roles are stored on the server. Each person signs in as themselves; there is no role switching.</p>
          </div>
        </div>
        {canManage && (
          <Button tone="primary" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> New user
          </Button>
        )}
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
      {issued && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950" data-testid="issued-code" role="status">
          <div className="flex items-center gap-2 font-black">
            <KeyRound className="h-4 w-4" /> {issued.purpose === 'activation' ? 'Activation code' : 'Reset code'} for {issued.name} ({issued.email})
          </div>
          <div className="select-all break-all rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-900" data-testid="issued-code-value">
            {issued.code}
          </div>
          <p>
            Single use, valid until {new Date(issued.expires_at).toLocaleString()}. Hand it to {issued.name} over a trusted channel; on the sign-in screen they choose
            “Set a new password with a code”. It is shown only now and is not stored.
          </p>
          <Button onClick={() => setIssued(null)}>Done</Button>
        </div>
      )}
      {users && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Name</th>
                <th className="pr-3">Role</th>
                <th className="pr-3">Projects</th>
                <th className="pr-3">Last sign-in</th>
                <th className="pr-3">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100" data-testid={`user-row-${u.email}`}>
                  <td className="py-2 pr-3">
                    <div className="font-bold text-slate-900">{u.name}</div>
                    <div className="text-[11px] text-slate-500">{u.email}{u.is_dev_seed ? ' · dev seed' : ''}</div>
                  </td>
                  <td className="pr-3">{u.role}</td>
                  <td className="pr-3 text-[11px]">{PROJECT_SCOPED.includes(u.role) ? u.assigned_project_ids.map(projectName).join(', ') || 'none' : 'all (company-wide)'}</td>
                  <td className="pr-3 text-[11px]">{u.last_login ? new Date(u.last_login).toLocaleString() : 'never'}</td>
                  <td className="pr-3">
                    <Pill tone={u.is_active ? 'good' : 'neutral'}>{u.is_active ? 'Active' : 'Deactivated'}</Pill>
                    {credentialLabel(u) && <div className="mt-1 text-[10px] font-bold text-amber-700">{credentialLabel(u)}</div>}
                  </td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {canManage && (
                      <>
                        <Button onClick={() => setEditing(u)}>Edit</Button>
                        {mayReset(u) && (
                          <Button busy={busy === u.id} onClick={() => resetPassword(u)}>
                            Reset password
                          </Button>
                        )}
                        {u.id !== currentUser.id && (
                          <Button tone={u.is_active ? 'danger' : 'success'} busy={busy === u.id} onClick={() => toggleActive(u)}>
                            {u.is_active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <UserForm
          user={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(code) => {
            if (code) setIssued(code);
            void load();
          }}
        />
      )}
    </div>
  );
};
