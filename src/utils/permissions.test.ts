import { describe, expect, it } from 'vitest';
import {
  ROLE_DEFINITIONS,
  canAccessProject,
  canAccessWorkItem,
  canViewFinancialMargins,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from './permissions';
import type { Project, UserProfile, UserRole, WorkItem, WorkPackage } from '../types';

const user = (role: UserRole, extra: Partial<UserProfile> = {}): UserProfile => ({
  id: `u-${role}`,
  name: role,
  role,
  email: `${role}@example.com`,
  ...extra,
});

const project = (extra: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  project_number: 'NW-2026-001',
  project_name: 'Test Project',
  client_id: 'client-1',
  site_address: 'Kuala Lumpur',
  contract_value: 100000,
  project_status: 'Active',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  signed_date: '2025-12-01',
  project_manager_id: 'u-pm',
  site_supervisor_id: 'u-ss',
  progress_percent: 0,
  description: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...extra,
});

describe('hasPermission', () => {
  it('denies everything when there is no user', () => {
    expect(hasPermission(undefined, 'projects.view')).toBe(false);
  });

  it('grants Owner / CEO every permission', () => {
    const owner = user('Owner / CEO');
    expect(hasPermission(owner, 'users.view')).toBe(true);
    expect(hasPermission(owner, 'audit.view')).toBe(true);
    expect(hasPermission(owner, 'finance.view')).toBe(true);
  });

  it('follows each role definition for non-owner roles', () => {
    for (const [role, def] of Object.entries(ROLE_DEFINITIONS)) {
      if (role === 'Owner / CEO') continue;
      const u = user(role as UserRole);
      for (const perm of def.defaultPermissions) {
        expect(hasPermission(u, perm), `${role} should have ${perm}`).toBe(true);
      }
    }
  });

  it('does not give Contractors or Clients user administration', () => {
    expect(hasPermission(user('Contractor'), 'users.view')).toBe(false);
    expect(hasPermission(user('Client'), 'users.view')).toBe(false);
  });

  it('honours custom supplemental permissions', () => {
    const contractor = user('Contractor', { custom_permissions: ['users.view'] });
    expect(hasPermission(contractor, 'users.view')).toBe(true);
  });

  it('combines permissions with any/all helpers', () => {
    const client = user('Client');
    expect(hasAnyPermission(client, ['users.view', 'audit.view'])).toBe(false);
    expect(hasAllPermissions(user('Owner / CEO'), ['users.view', 'audit.view'])).toBe(true);
  });
});

describe('canAccessProject', () => {
  it('gives Owner and Admin universal access', () => {
    expect(canAccessProject(user('Owner / CEO'), project())).toBe(true);
    expect(canAccessProject(user('Admin'), project())).toBe(true);
  });

  it('limits Project Managers to projects they manage or are assigned', () => {
    const pm = user('Project Manager', { id: 'u-pm' });
    expect(canAccessProject(pm, project())).toBe(true);
    expect(canAccessProject(pm, project({ project_manager_id: 'someone-else' }))).toBe(false);
    const assigned = user('Project Manager', { id: 'u-x', assigned_project_ids: ['proj-1'] });
    expect(canAccessProject(assigned, project({ project_manager_id: 'someone-else' }))).toBe(true);
  });

  it('limits Clients to their own projects', () => {
    expect(canAccessProject(user('Client', { client_id: 'client-1' }), project())).toBe(true);
    expect(canAccessProject(user('Client', { client_id: 'client-2' }), project())).toBe(false);
  });

  it('limits Contractors to projects with their work packages', () => {
    const contractor = user('Contractor', { contractor_id: 'con-1' });
    const wp = { project_id: 'proj-1', contractor_id: 'con-1' } as WorkPackage;
    expect(canAccessProject(contractor, project(), [wp])).toBe(true);
    expect(canAccessProject(contractor, project(), [])).toBe(false);
  });
});

describe('canAccessWorkItem', () => {
  const item = { id: 'wi-1', project_id: 'proj-1', contractor_id: 'con-1' } as WorkItem;

  it('lets a Contractor see only their own items', () => {
    expect(canAccessWorkItem(user('Contractor', { contractor_id: 'con-1' }), item)).toBe(true);
    expect(canAccessWorkItem(user('Contractor', { contractor_id: 'con-2' }), item)).toBe(false);
  });
});

describe('canViewFinancialMargins', () => {
  it('is restricted to Owner and Accountant', () => {
    expect(canViewFinancialMargins(user('Owner / CEO'))).toBe(true);
    expect(canViewFinancialMargins(user('Accountant'))).toBe(true);
    expect(canViewFinancialMargins(user('Project Manager'))).toBe(false);
    expect(canViewFinancialMargins(user('Contractor'))).toBe(false);
  });
});
