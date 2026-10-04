// @vitest-environment jsdom
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NWProvider, useNW } from './NWContext';
import type { AutomationRule, Project } from '../types';

const wrapper = ({ children }: { children: React.ReactNode }) => <NWProvider>{children}</NWProvider>;

// Entity ids come from Date.now(), so each test moves the clock forward between creations.
let now = new Date('2026-10-04T08:00:00Z').getTime();
const tick = () => {
  now += 1000;
  vi.setSystemTime(now);
};

const renderNW = () => renderHook(() => useNW(), { wrapper });

const newProjectData = (): Omit<Project, 'id' | 'created_at' | 'updated_at'> => ({
  project_number: 'NW-2026-900',
  project_name: 'Vitest Fit-out',
  client_id: 'client-test',
  site_address: 'Jalan Ujian, Kuala Lumpur',
  contract_value: 250000,
  project_status: 'Active',
  start_date: '2026-10-01',
  end_date: '2026-12-31',
  signed_date: '2026-09-15',
  project_manager_id: 'u-3',
  site_supervisor_id: 'u-4',
  progress_percent: 0,
  description: 'Created by the test suite',
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  tick();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NWProvider core data', () => {
  it('loads seed data on first run', () => {
    const { result } = renderNW();
    expect(result.current.projects.length).toBeGreaterThan(0);
    expect(result.current.workItems.length).toBeGreaterThan(0);
    expect(result.current.currentUser.role).toBe('Owner / CEO');
  });

  it('persists changes to localStorage and reloads them', () => {
    const first = renderNW();
    act(() => {
      first.result.current.addProject(newProjectData());
    });
    first.unmount();

    const second = renderNW();
    expect(second.result.current.projects.some((p) => p.project_name === 'Vitest Fit-out')).toBe(true);
  });

  it('adds and deletes a client', () => {
    const { result } = renderNW();
    const before = result.current.clients.length;
    let id = '';
    act(() => {
      id = result.current.addClient({ ...result.current.clients[0], company_name: 'Vitest Sdn Bhd' }).id;
    });
    expect(result.current.clients).toHaveLength(before + 1);
    tick();
    act(() => {
      result.current.deleteClient(id);
    });
    expect(result.current.clients).toHaveLength(before);
  });
});

describe('project creation', () => {
  it('adds the project, selects it and writes an audit log', () => {
    const { result } = renderNW();
    const projectsBefore = result.current.projects.length;
    const logsBefore = result.current.auditLogs.length;

    let created: Project | undefined;
    act(() => {
      created = result.current.addProject(newProjectData());
    });

    expect(created?.id).toMatch(/^proj-/);
    expect(created?.progress_percent).toBe(0);
    expect(result.current.projects).toHaveLength(projectsBefore + 1);
    expect(result.current.projects[0].id).toBe(created?.id);
    expect(result.current.selectedProjectId).toBe(created?.id);
    expect(result.current.auditLogs.length).toBe(logsBefore + 1);
  });

  it('updates an existing project', () => {
    const { result } = renderNW();
    let id = '';
    act(() => {
      id = result.current.addProject(newProjectData()).id;
    });
    tick();
    act(() => {
      result.current.updateProject(id, { progress_percent: 40 });
    });
    expect(result.current.projects.find((p) => p.id === id)?.progress_percent).toBe(40);
  });
});

describe('work item status changes', () => {
  it('updates status and logs the transition', () => {
    const { result } = renderNW();
    const item = result.current.workItems.find((w) => w.status !== 'Completed')!;
    const logsBefore = result.current.auditLogs.length;

    act(() => {
      result.current.updateWorkItemStatus(item.id, 'In Progress');
    });

    const updated = result.current.workItems.find((w) => w.id === item.id)!;
    expect(updated.status).toBe('In Progress');
    expect(result.current.auditLogs.length).toBeGreaterThan(logsBefore);
  });

  it('moves production to QC and notifies the PM when marked Ready for QC', () => {
    const { result } = renderNW();
    const item = result.current.workItems[0];

    act(() => {
      result.current.updateWorkItemStatus(item.id, 'Ready for QC');
    });

    const updated = result.current.workItems.find((w) => w.id === item.id)!;
    expect(updated.status).toBe('Ready for QC');
    expect(updated.production_status).toBe('QC');
    expect(
      result.current.notifications.some(
        (n) => n.type === 'qc' && n.link_id === item.id && n.target_role === 'Project Manager'
      )
    ).toBe(true);
  });
});

describe('automation rule evaluation', () => {
  // 'project.created' has no seed rules, so only the test rule can match.
  const makeRule = (
    result: { current: ReturnType<typeof useNW> },
    conditions: AutomationRule['conditions']
  ): AutomationRule => {
    let rule!: AutomationRule;
    act(() => {
      rule = result.current.createAutomationRule({
        name: 'Vitest rule',
        description: 'Follow up {project_name}',
        trigger_event: 'project.created',
        conditions,
        condition_logic: 'AND',
        actions: [{ action_type: 'create_task', template_title: 'Kick-off for {project_name}' }],
        assign_to_role: 'Project Manager',
        deadline_hours: 4,
        escalate_to_role: 'Owner / CEO',
        is_active: true,
        is_draft: false,
        priority: 'High',
        applies_to_projects: ['all'],
      });
    });
    tick();
    return rule;
  };

  it('runs the rule and creates a task when all conditions pass', () => {
    const { result } = renderNW();
    const project = result.current.projects[0];
    const rule = makeRule(result, [
      { field: 'value', operator: 'greater_than', value: 1000 },
      { field: 'trade', operator: 'contains', value: 'carp' },
    ]);
    const tasksBefore = result.current.tasks.length;

    act(() => {
      result.current.triggerAutomationEvent('project.created', 'Projects', project.id, project.id, {
        value: 5000,
        trade: 'Carpentry',
      });
    });

    expect(result.current.automationRuns.some((r) => r.rule_id === rule.id && r.status === 'Success')).toBe(true);
    expect(result.current.tasks.length).toBe(tasksBefore + 1);
    expect(result.current.tasks[0].title).toBe(`Kick-off for ${project.project_name}`);
  });

  it('does not run the rule when a condition fails', () => {
    const { result } = renderNW();
    const project = result.current.projects[0];
    const rule = makeRule(result, [{ field: 'value', operator: 'greater_than', value: 1000 }]);
    const tasksBefore = result.current.tasks.length;

    act(() => {
      result.current.triggerAutomationEvent('project.created', 'Projects', project.id, project.id, { value: 10 });
    });

    expect(result.current.automationRuns.some((r) => r.rule_id === rule.id)).toBe(false);
    expect(result.current.tasks.length).toBe(tasksBefore);
  });

  it('ignores inactive rules', () => {
    const { result } = renderNW();
    const project = result.current.projects[0];
    const rule = makeRule(result, []);
    act(() => {
      result.current.toggleAutomationRule(rule.id);
    });
    tick();

    act(() => {
      result.current.triggerAutomationEvent('project.created', 'Projects', project.id, project.id, {});
    });

    expect(result.current.automationRuns.some((r) => r.rule_id === rule.id)).toBe(false);
  });

  it('blocks a duplicate event for the same record within the same minute', () => {
    const { result } = renderNW();
    const project = result.current.projects[0];
    const rule = makeRule(result, []);

    act(() => {
      result.current.triggerAutomationEvent('project.created', 'Projects', project.id, project.id, {});
    });
    tick();
    act(() => {
      result.current.triggerAutomationEvent('project.created', 'Projects', project.id, project.id, {});
    });

    expect(result.current.automationRuns.filter((r) => r.rule_id === rule.id)).toHaveLength(1);
  });
});
