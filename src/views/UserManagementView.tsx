/**
 * NW OS — User Roles & Permissions Management (Sections 1-17)
 * Manage user directory, project assignments, custom permissions,
 * and explore the complete 10-role RBAC permission matrix.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { UserProfile, UserRole, PermissionKey } from '../types';
import {
  ROLE_DEFINITIONS,
  ALL_PERMISSIONS,
  hasPermission,
} from '../utils/permissions';
import {
  Users,
  ShieldCheck,
  Building2,
  CheckCircle2,
  XCircle,
  Plus,
  Edit2,
  UserCheck,
  UserX,
  Search,
  Key,
  Shield,
  Briefcase,
  Layers,
  Sparkles,
  ChevronRight,
  ExternalLink,
  Check,
  X,
  Lock,
  Unlock,
} from 'lucide-react';

export const UserManagementView: React.FC = () => {
  const {
    currentUser,
    switchUser,
    availableUsers,
    addUser,
    updateUser,
    toggleUserStatus,
    projects,
  } = useNW();

  const [activeTab, setActiveTab] = useState<'users' | 'matrix' | 'simulator'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('Project Manager');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editAssignedProjects, setEditAssignedProjects] = useState<string[]>([]);
  const [editCustomPerms, setEditCustomPerms] = useState<string[]>([]);

  // Create User Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Site Supervisor');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('+60 12-');
  const [newDepartment, setNewDepartment] = useState('Site Operations');
  const [newTitle, setNewTitle] = useState('Site Engineer');
  const [newAssignedProjects, setNewAssignedProjects] = useState<string[]>(['proj-1']);

  // Simulator State
  const [simulatedRole, setSimulatedRole] = useState<UserRole>(currentUser.role);
  const [simulatedPerm, setSimulatedPerm] = useState<PermissionKey>('drawings.approve');

  const filteredUsers = availableUsers.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesName = u.name.toLowerCase().includes(q);
      const matchesEmail = u.email.toLowerCase().includes(q);
      const matchesRole = u.role.toLowerCase().includes(q);
      const matchesDept = u.department?.toLowerCase().includes(q);
      if (!matchesName && !matchesEmail && !matchesRole && !matchesDept) return false;
    }
    return true;
  });

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditRole(user.role);
    setEditEmail(user.email);
    setEditPhone(user.phone || '');
    setEditDepartment(user.department || '');
    setEditTitle(user.title || '');
    setEditAssignedProjects(user.assigned_project_ids || []);
    setEditCustomPerms(user.custom_permissions || []);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    updateUser(editingUser.id, {
      name: editName,
      role: editRole,
      email: editEmail,
      phone: editPhone,
      department: editDepartment,
      title: editTitle,
      assigned_project_ids: editAssignedProjects,
      custom_permissions: editCustomPerms,
    });

    setEditingUser(null);
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;

    addUser({
      name: newName,
      role: newRole,
      email: newEmail,
      phone: newPhone,
      department: newDepartment,
      title: newTitle,
      assigned_project_ids: newAssignedProjects,
      status: 'active',
      avatar: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 500000)}?w=120&auto=format&fit=crop&q=80`,
    });

    setShowCreateModal(false);
    setNewName('');
    setNewEmail('');
  };

  const toggleProjectAssignment = (projectId: string, list: string[], setList: (val: string[]) => void) => {
    if (list.includes(projectId)) {
      setList(list.filter((id) => id !== projectId));
    } else {
      setList([...list, projectId]);
    }
  };

  // Group permissions for matrix
  const permissionGroups = Array.from(new Set(ALL_PERMISSIONS.map((p) => p.group)));

  const rolesList: UserRole[] = [
    'Owner / CEO',
    'Admin',
    'Project Manager',
    'Site Supervisor',
    'Purchasing',
    'Accountant',
    'Production Manager',
    'Production Staff',
    'Contractor',
    'Client',
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner & Title */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-700 border border-indigo-200">
              <Users className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
                <span>User Roles & Permissions (RBAC)</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                  10 Standardized Roles
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Multi-tenant project assignments, strict data segregation, anti-self-approval enforcement, and emergency audit override
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create User</span>
          </button>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex items-center space-x-1 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === 'users'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Accounts & Projects ({availableUsers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('matrix')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === 'matrix'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Role & Permission Matrix</span>
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === 'simulator'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Permission Simulator & Policy Checks</span>
        </button>
      </div>

      {/* TAB 1: USER DIRECTORY & PROJECT ASSIGNMENTS */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-500">Filter Role:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-white border border-slate-200 text-xs font-semibold text-slate-800 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="all">All 10 Roles</option>
                {rolesList.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, email, department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
          </div>

          {/* Users Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsers.map((user) => {
              const roleDef = ROLE_DEFINITIONS[user.role];
              const isCurrent = currentUser.id === user.id;

              return (
                <div
                  key={user.id}
                  className={`bg-white border rounded-2xl p-5 shadow-xs transition-all relative flex flex-col justify-between ${
                    isCurrent ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'
                  }`}
                >
                  <div className="space-y-3">
                    {/* User Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <img
                          src={user.avatar}
                          alt={user.name}
                          className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shadow-xs"
                        />
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <h3 className="text-sm font-extrabold text-slate-900 leading-tight">{user.name}</h3>
                            {isCurrent && (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-500 text-slate-950">
                                Active
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border mt-1 ${
                              roleDef?.color.bg || 'bg-slate-100'
                            } ${roleDef?.color.text || 'text-slate-800'} ${roleDef?.color.border || 'border-slate-300'}`}
                          >
                            {user.role}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => toggleUserStatus(user.id)}
                          title={user.status === 'inactive' ? 'Activate User' : 'Deactivate User'}
                          className={`p-1.5 rounded-lg border text-xs transition-colors ${
                            user.status === 'inactive'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          {user.status === 'inactive' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleOpenEdit(user)}
                          title="Edit User & Permissions"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Department & Contact */}
                    <div className="space-y-1 text-xs text-slate-600 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Department:</span>
                        <span className="font-semibold text-slate-700">{user.department || roleDef?.department}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Email:</span>
                        <span className="font-mono text-slate-600 truncate max-w-[170px]">{user.email}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Phone:</span>
                        <span className="text-slate-600">{user.phone || '—'}</span>
                      </div>
                    </div>

                    {/* Assigned Projects */}
                    <div className="pt-2 border-t border-slate-100">
                      <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center justify-between">
                        <span>Project-Level Access:</span>
                        {user.role === 'Owner / CEO' || user.role === 'Admin' || user.role === 'Purchasing' || user.role === 'Accountant' ? (
                          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                            Universal All Projects
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {user.role === 'Owner / CEO' || user.role === 'Admin' || user.role === 'Purchasing' || user.role === 'Accountant' ? (
                          <span className="text-[10px] text-slate-500 italic">Access to all current & future company projects</span>
                        ) : user.assigned_project_ids && user.assigned_project_ids.length > 0 ? (
                          user.assigned_project_ids.map((pId) => {
                            const p = projects.find((proj) => proj.id === pId);
                            return (
                              <span
                                key={pId}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200"
                              >
                                {p ? p.project_name.split('—')[0] : pId}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-amber-700 italic">No specific projects assigned</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Switch to this user button */}
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <button
                      onClick={() => switchUser(user.id)}
                      disabled={isCurrent}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
                        isCurrent
                          ? 'bg-amber-100 text-amber-900 border border-amber-300 cursor-default'
                          : 'bg-slate-100 hover:bg-amber-500 hover:text-slate-950 text-slate-800 border border-slate-200'
                      }`}
                    >
                      {isCurrent ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                          <span>Currently Logged In</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Simulate / Switch to this User</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: ROLE & PERMISSION MATRIX */}
      {activeTab === 'matrix' && (
        <div className="space-y-6">
          {/* Explanation Banner */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-xs space-y-2">
            <h3 className="text-sm font-extrabold flex items-center space-x-2 text-amber-400">
              <ShieldCheck className="w-4 h-4" />
              <span>NW OS RBAC Architecture — 10 Defined Stakeholder Roles</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Every action in NW OS is protected by granular permission keys. Operational roles (PM, Site Supervisor, Contractor, Production Staff) are strictly constrained to authorized actions and assigned projects, while Executive (Owner) retains comprehensive visibility and emergency override capabilities.
            </p>
          </div>

          {/* Matrix Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto scrollbar-none">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-900">
                    <th className="py-3.5 px-4 font-black uppercase text-[10px] tracking-wider w-64 sticky left-0 bg-slate-100 z-10">
                      Permission Module
                    </th>
                    {rolesList.map((role) => {
                      const def = ROLE_DEFINITIONS[role];
                      return (
                        <th
                          key={role}
                          className="py-3.5 px-2.5 font-extrabold text-[11px] whitespace-nowrap text-center min-w-[100px]"
                        >
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] ${def.color.bg} ${def.color.text} ${def.color.border}`}>
                            {role}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {permissionGroups.map((group) => {
                    const groupPerms = ALL_PERMISSIONS.filter((p) => p.group === group);
                    return (
                      <React.Fragment key={group}>
                        <tr className="bg-slate-50/80 font-black text-slate-700 text-[11px]">
                          <td colSpan={11} className="py-2 px-4 uppercase tracking-wider text-slate-500 bg-slate-50">
                            {group} Permissions
                          </td>
                        </tr>
                        {groupPerms.map((perm) => (
                          <tr key={perm.key} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-slate-800 sticky left-0 bg-white">
                              <div>{perm.label}</div>
                              <span className="font-mono text-[9px] text-slate-400 block">{perm.key}</span>
                            </td>
                            {rolesList.map((role) => {
                              const def = ROLE_DEFINITIONS[role];
                              const isAllowed = def.defaultPermissions.includes(perm.key);
                              return (
                                <td key={role} className="py-2.5 px-2.5 text-center">
                                  {isAllowed ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
                                      <Check className="w-3 h-3 stroke-[3]" />
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-300">
                                      <X className="w-3 h-3 stroke-[2]" />
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Role Restraints Documentation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rolesList.map((role) => {
              const def = ROLE_DEFINITIONS[role];
              return (
                <div key={role} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${def.color.bg} ${def.color.text} ${def.color.border}`}>
                      {def.title}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">{def.department}</span>
                  </div>
                  <p className="text-xs text-slate-600">{def.description}</p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <span className="font-bold text-slate-900 block text-[11px]">Strict Role Safeguards & Constraints:</span>
                    <ul className="space-y-1">
                      {def.restrictions.map((r, i) => (
                        <li key={i} className="flex items-start space-x-1.5 text-slate-600 text-[11px]">
                          <Lock className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: SIMULATOR & POLICY CHECKS */}
      {activeTab === 'simulator' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Live Permission & Governance Simulator</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verify how the RBAC engine responds to combinations of user roles, permissions, and project assignments
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Select User Role to Test</label>
              <select
                value={simulatedRole}
                onChange={(e) => setSimulatedRole(e.target.value as UserRole)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                {rolesList.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Select Action / Permission</label>
              <select
                value={simulatedPerm}
                onChange={(e) => setSimulatedPerm(e.target.value as PermissionKey)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                {ALL_PERMISSIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    [{p.group}] {p.label} ({p.key})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Test Evaluation Result */}
          {(() => {
            const roleDef = ROLE_DEFINITIONS[simulatedRole];
            const isAllowed = simulatedRole === 'Owner / CEO' || roleDef.defaultPermissions.includes(simulatedPerm);
            const permMeta = ALL_PERMISSIONS.find((p) => p.key === simulatedPerm);

            return (
              <div
                className={`p-5 rounded-2xl border ${
                  isAllowed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-rose-50 border-rose-200 text-rose-950'
                }`}
              >
                <div className="flex items-center space-x-3">
                  {isAllowed ? (
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center font-black">
                      <XCircle className="w-6 h-6" />
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-black">
                      {isAllowed ? 'AUTHORIZATION GRANTED' : 'ACCESS RESTRICTED & BLOCKED'}
                    </h3>
                    <p className="text-xs opacity-90 mt-0.5">
                      Role <strong className="font-bold">{simulatedRole}</strong>{' '}
                      {isAllowed ? 'is permitted to execute' : 'is denied permission to'}{' '}
                      <code className="px-1.5 py-0.5 rounded bg-black/10 font-bold">{permMeta?.label}</code> ({simulatedPerm}).
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-black/10 text-xs space-y-1">
                  <div className="font-bold">Governance Context:</div>
                  <p className="leading-relaxed">
                    {isAllowed
                      ? `This action is officially part of ${simulatedRole}'s core operational responsibilities in NW OS.`
                      : `Company policy explicitly restricts this action to prevent unauthorized modifications, financial exposure, or technical scope creep.`}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">User Access Control</span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">Edit User & Project Assignments</h3>
              </div>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">System Role *</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    {rolesList.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Project Assignment Section */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 mb-1.5">
                  Assigned Project Access (Multi-project RBAC):
                </label>
                <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {projects.map((proj) => {
                    const isAssigned = editAssignedProjects.includes(proj.id);
                    return (
                      <label
                        key={proj.id}
                        className="flex items-center space-x-2 text-xs text-slate-800 cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() =>
                            toggleProjectAssignment(proj.id, editAssignedProjects, setEditAssignedProjects)
                          }
                          className="rounded text-amber-500 focus:ring-amber-500"
                        />
                        <span className="font-semibold">{proj.project_name.split('—')[0]}</span>
                        <span className="text-[10px] text-slate-400">({proj.project_number})</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl shadow-xs"
                >
                  Save Access Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">Onboarding</span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">Create New Stakeholder Account</h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Jason Wong"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">System Role *</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    {rolesList.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="user@nwbuilders.com.my"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 mb-1.5">Initial Project Assignments:</label>
                <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {projects.map((proj) => {
                    const isAssigned = newAssignedProjects.includes(proj.id);
                    return (
                      <label
                        key={proj.id}
                        className="flex items-center space-x-2 text-xs text-slate-800 cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() =>
                            toggleProjectAssignment(proj.id, newAssignedProjects, setNewAssignedProjects)
                          }
                          className="rounded text-amber-500 focus:ring-amber-500"
                        />
                        <span className="font-semibold">{proj.project_name.split('—')[0]}</span>
                        <span className="text-[10px] text-slate-400">({proj.project_number})</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl shadow-xs"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
