/**
 * What the AI assistant may propose, and how an approved proposal is executed.
 *
 *   AI proposes → a human approves (an "AI Proposal" approval) → the system executes.
 *
 * Only the actions listed here can ever be proposed; everything else (approving drawings,
 * variations or purchases, changing dimensions or materials, promising client dates,
 * compensation, safety decisions, permissions) is refused. Execution runs in the approval's
 * transaction as the approver, through the normal module write path, so the approver's own
 * permissions, project scope and record rules apply — the AI never gains access a person
 * does not have. A proposal executes once: approval decisions are final.
 */
import { ForbiddenError, type AccessContext } from '../auth/access';
import { writeAudit } from '../audit';
import { ValidationError } from '../core/repository';
import type { Pool, PoolClient } from '../db/pool';
import { insertNotifications } from '../automation/notify';
import { findRecord } from './store';
import { MODULES } from './registry';
import type { HookContext, Row } from './types';

type Db = Pool | PoolClient;

export const AI_PROPOSAL_TYPE = 'AI Proposal';
export type ProposalAction = 'create_task' | 'reassign_task' | 'remind_task_assignee';
export const PROPOSAL_ACTIONS: Record<ProposalAction, string> = {
  create_task: 'Create a follow-up task',
  reassign_task: 'Reassign a task',
  remind_task_assignee: 'Send a reminder to a task assignee',
};
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const tasksDef = () => MODULES.find((m) => m.key === 'tasks')!;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function activeUser(db: Db, id: string) {
  const u = (await db.query('SELECT id, name, role FROM users WHERE id = $1 AND is_active', [id])).rows[0];
  if (!u) throw new ValidationError(`User ${id} is not an active user`);
  return u as { id: string; name: string; role: string };
}

async function visibleTask(db: Db, ctx: AccessContext, id: string) {
  const task = await findRecord(db, tasksDef(), id);
  if (!task || !ctx.canSeeProject(task.project_id)) throw new ForbiddenError(`Task ${id} not found or not accessible`);
  return task;
}

/**
 * Checks a proposal before it is put to a person (the action is allowed, its records exist
 * and are visible to the asker). Returns what the approval shows.
 */
export async function validateProposal(db: Db, ctx: AccessContext, action: unknown, raw: unknown) {
  if (typeof action !== 'string' || !(action in PROPOSAL_ACTIONS)) {
    throw new ForbiddenError(`The assistant cannot propose "${String(action)}". It may only propose: ${Object.values(PROPOSAL_ACTIONS).join(', ')}.`);
  }
  const p = (raw && typeof raw === 'object' ? raw : {}) as Row;
  if (action === 'create_task') {
    const projectId = str(p.project_id);
    if (!projectId || !ctx.canSeeProject(projectId)) throw new ForbiddenError('Project not found or not accessible');
    const title = str(p.title);
    if (!title) throw new ValidationError('A task needs a title');
    const assignee = await activeUser(db, str(p.assigned_user_id));
    if (p.due_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.due_date))) throw new ValidationError('due_date must be YYYY-MM-DD');
    const priority = PRIORITIES.includes(String(p.priority)) ? String(p.priority) : 'Normal';
    const params: Row = { project_id: projectId, title: title.slice(0, 200), description: str(p.description).slice(0, 2000), assigned_user_id: assignee.id, due_date: p.due_date, priority };
    for (const link of ['production_order_id', 'issue_id', 'delivery_id', 'installation_job_id']) if (str(p[link])) params[link] = str(p[link]);
    return { action, params, project_id: projectId, summary: `Create task "${params.title}" for ${assignee.name}${p.due_date ? `, due ${String(p.due_date)}` : ''}` };
  }
  const task = await visibleTask(db, ctx, str(p.task_id));
  if (action === 'reassign_task') {
    const to = await activeUser(db, str(p.assigned_user_id));
    if (to.id === task.assigned_user_id) throw new ValidationError('The task is already assigned to that person');
    return { action, params: { task_id: task.id, assigned_user_id: to.id }, project_id: task.project_id as string, summary: `Reassign "${String(task.title)}" from ${String(task.assigned_user_name ?? task.assigned_user_id)} to ${to.name}` };
  }
  return { action, params: { task_id: task.id }, project_id: task.project_id as string, summary: `Remind ${String(task.assigned_user_name ?? task.assigned_user_id)} about "${String(task.title)}"` };
}

/** Executes an approved proposal as the approver (h.ctx), in the approval's transaction. */
export async function executeProposal(h: HookContext, approval: Row) {
  const proposal = approval.proposal as Row | undefined;
  if (!proposal || !h.writeModule) throw new ValidationError('This approval carries no executable proposal');
  // Re-validated as the approver: they must be able to see what it touches.
  const { action, params } = await validateProposal(h.db, h.ctx, proposal.action, proposal.params);
  let result: Row;
  if (action === 'create_task') {
    const assignee = await activeUser(h.db, String(params.assigned_user_id));
    const project = (await h.db.query('SELECT project_name FROM projects WHERE id = $1', [params.project_id])).rows[0];
    const id = `tsk-ai-${String(approval.id)}`;
    const task = await h.writeModule('tasks', undefined, {
      ...params,
      id,
      task_number: id.toUpperCase().replace(/^TSK-AI-APR-AI-/, 'AI-').slice(0, 40),
      project_name: project?.project_name ?? '',
      source_event: `ai_proposal:${String(approval.id)}`,
      source_module: 'AI Assistant (approved)',
      assigned_user_name: assignee.name,
      assigned_role: assignee.role,
      status: 'Open',
      escalation_level: 'None',
      comments: [],
      attachments: [],
      created_date: new Date().toISOString(),
    });
    await insertNotifications(h.db, [assignee.id], { title: `New task: ${String(params.title)}`, message: `Approved by ${h.ctx.user.name} from an assistant proposal.`, type: 'action', priority: params.priority === 'Urgent' ? 'urgent' : 'high', project_id: String(params.project_id), link_tab: 'automation', entity_type: 'task', entity_id: id }, `ai:${String(approval.id)}`, 'ai_assistant');
    result = { task_id: task.id };
  } else if (action === 'reassign_task') {
    const task = await visibleTask(h.db, h.ctx, String(params.task_id));
    const to = await activeUser(h.db, String(params.assigned_user_id));
    await h.writeModule('tasks', task, { ...task, assigned_user_id: to.id, assigned_user_name: to.name, assigned_role: to.role });
    result = { task_id: task.id, assigned_user_id: to.id };
  } else {
    const task = await visibleTask(h.db, h.ctx, String(params.task_id));
    if (!h.ctx.can('automation.manage_tasks') && !h.ctx.can('automation.execute_action')) throw new ForbiddenError('Missing permission to send task reminders');
    const sent = await insertNotifications(h.db, [String(task.assigned_user_id)], { title: `Reminder: ${String(task.title)}`, message: `${h.ctx.user.name} asks for an update${task.due_date ? ` (due ${String(task.due_date)})` : ''}.`, type: 'action', priority: 'high', project_id: String(task.project_id), link_tab: 'automation', entity_type: 'task', entity_id: String(task.id) }, `ai:${String(approval.id)}`, 'ai_assistant');
    result = { task_id: task.id, notified: sent };
  }
  await h.db.query(`UPDATE approvals SET data = jsonb_set(data, '{execution}', $2::jsonb) WHERE id = $1`, [approval.id, JSON.stringify({ executed_at: new Date().toISOString(), executed_as: h.ctx.user.id, result })]);
  await writeAudit(h.db, h.actor, { action: 'ai.proposal.execute', entityType: 'approval', entityId: String(approval.id), projectId: String(approval.project_id), after: { action, params, result } });
  return result;
}
