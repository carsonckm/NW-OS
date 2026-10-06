/**
 * NW production standards (knowledge articles). Proposers (Production Manager, Owner) write
 * drafts and send them for review; a knowledge editor publishes or archives them. The server
 * records the author and approver and refuses self-approval and edits to published articles.
 */
import React, { useState } from 'react';
import { BookMarked, Plus } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { KnowledgeCategory, NWProductionKnowledge } from '../../types';
import { actionErrorOf, useRecords } from '../../services/records';
import { api } from '../../services/coreApi';
import { hasPermission } from '../../utils/permissions';
import { FormError } from '../../components/ui/FormError';
import { Button, Field, Input, Modal, Pill, Select, TextArea, newId } from '../../components/ui/forms';

const CATEGORIES: KnowledgeCategory[] = ['Production', 'Installation', 'Materials', 'Hardware', 'Drawings', 'QC', 'Site Problems', 'Suppliers', 'Contractors', 'Commercial', 'Lessons Learned'];
const TONE = { Draft: 'warn', Review: 'info', Approved: 'good', Archived: 'neutral' } as const;
type Article = NWProductionKnowledge & { created_by_id?: string; approved_at?: string };

const ArticleForm: React.FC<{ onClose: () => void; revising?: Article }> = ({ onClose, revising }) => {
  const records = useRecords();
  const [f, setF] = useState({
    title: revising?.title ?? '',
    category: (revising && CATEGORIES.includes(revising.category) ? revising.category : 'Production') as KnowledgeCategory,
    problem: revising?.problem ?? revising?.description ?? '',
    solution: revising?.solution ?? '',
    procedure: revising?.procedure ?? '',
    project_type: revising?.project_type ?? '',
    tags: (revising?.tags ?? []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (status: 'Draft' | 'Review') => {
    if (!f.title.trim() || !f.problem.trim()) return setError('Give the article a title and describe the problem.');
    setBusy(true);
    setError(null);
    try {
      const tags = f.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await records.create<NWProductionKnowledge>('knowledge', {
        id: newId('kb'),
        ...f,
        tags,
        description: '',
        reason: '',
        example: '',
        photos: [],
        ...(revising ? { supersedes_id: revising.id } : {}),
        created_by: '',
        status,
        created_at: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={revising ? `New revision of “${revising.title}”` : 'Propose a knowledge article'}
      subtitle={revising ? `Revision ${(revising.revision ?? 1) + 1}. The current revision stays official until this one is approved.` : 'It is official only after a knowledge editor approves it.'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button busy={busy} onClick={() => save('Draft')}>
            Save draft
          </Button>
          <Button tone="primary" busy={busy} onClick={() => save('Review')}>
            Send for review
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Standard title" />
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as KnowledgeCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Problem">
        <TextArea rows={2} value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} aria-label="Problem" />
      </Field>
      <Field label="Solution">
        <TextArea rows={2} value={f.solution} onChange={(e) => setF({ ...f, solution: e.target.value })} aria-label="Solution" />
      </Field>
      <Field label="Procedure">
        <TextArea rows={3} value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })} aria-label="Procedure" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project type">
          <Input value={f.project_type} onChange={(e) => setF({ ...f, project_type: e.target.value })} placeholder="e.g. Retail, Office, Residential" />
        </Field>
        <Field label="Tags (comma separated)">
          <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} aria-label="Tags" />
        </Field>
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};

export const KnowledgeArticles: React.FC = () => {
  const { knowledge, currentUser } = useNW();
  const records = useRecords();
  const canPropose = hasPermission(currentUser, 'knowledge.edit') || hasPermission(currentUser, 'production.propose_methods');
  const canPublish = hasPermission(currentUser, 'knowledge.edit');
  const [filter, setFilter] = useState<'all' | 'Approved' | 'pending' | 'Archived'>('all');
  const [adding, setAdding] = useState(false);
  const [revising, setRevising] = useState<Article | null>(null);
  const { coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';
  const markUsed = async (k: Article) => {
    setBusy(k.id);
    setError(null);
    try {
      await api.post(`/knowledge/${encodeURIComponent(k.id)}/usage`, { note: 'Applied' });
      await coreDataSync.reloadFromDatabase();
    } catch (err) {
      setError(`${k.title}: ${actionErrorOf(err).message}`);
    } finally {
      setBusy(null);
    }
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const articles = (knowledge as Article[]).filter((k) =>
    filter === 'all' ? k.status !== 'Archived' : filter === 'pending' ? k.status === 'Draft' || k.status === 'Review' : k.status === filter
  );
  const move = async (k: Article, status: NWProductionKnowledge['status']) => {
    setBusy(k.id);
    setError(null);
    try {
      await records.update<NWProductionKnowledge>('knowledge', k.id, { status }, k);
    } catch (err) {
      setError(`${k.title}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-sm" data-testid="knowledge-articles">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-black text-slate-900">NW knowledge base</h3>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto" aria-label="Filter standards">
            <option value="all">Published & pending</option>
            <option value="Approved">Published</option>
            <option value="pending">Awaiting approval</option>
            <option value="Archived">Archived</option>
          </Select>
          {canPropose && (
            <Button tone="primary" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Propose article
            </Button>
          )}
        </div>
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
      {articles.length === 0 && <p className="text-xs text-slate-500">No standards in this view.</p>}
      <ul className="divide-y divide-slate-100">
        {articles.map((k) => (
          <li key={k.id} className="py-2.5" data-testid={`kb-${k.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={TONE[k.status]}>{k.status === 'Approved' ? 'Published' : k.status}</Pill>
                  <span className="text-xs font-bold text-slate-900">{k.title}</span>
                  <span className="text-[10px] text-slate-500">{k.category}</span>
                  <span className="text-[10px] text-slate-500">rev {k.revision ?? 1}</span>
                  {(k.tags ?? []).map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </div>
                {k.problem ? (
                  <div className="mt-0.5 space-y-0.5 text-[11px] text-slate-600">
                    <p><strong>Problem:</strong> {k.problem}</p>
                    {k.solution && <p><strong>Solution:</strong> {k.solution}</p>}
                    {k.procedure && <p className="whitespace-pre-line"><strong>Procedure:</strong> {k.procedure}</p>}
                  </div>
                ) : (
                  <p className="mt-0.5 text-[11px] text-slate-600">{k.description}</p>
                )}
                <p className="mt-0.5 text-[10px] text-slate-400">
                  By {k.created_by || 'unknown'}
                  {k.approved_by ? ` · approved by ${k.approved_by}${k.approved_at ? ` on ${k.approved_at.slice(0, 10)}` : ''}` : ''}
                  {k.project_type ? ` · ${k.project_type}` : ''}
                  {live && k.status === 'Approved' ? ` · used ${k.usage_count ?? 0}×` : ''}
                  {k.supersedes_id ? ` · revises ${k.supersedes_id}` : ''}
                  {k.superseded_by ? ` · superseded by ${k.superseded_by}` : ''}
                </p>
              </div>
              <div className="flex gap-1.5">
                {k.status === 'Draft' && canPropose && (
                  <Button busy={busy === k.id} onClick={() => move(k, 'Review')}>
                    Send for review
                  </Button>
                )}
                {(k.status === 'Review' || k.status === 'Draft') && canPublish && (
                  <Button tone="success" busy={busy === k.id} onClick={() => move(k, 'Approved')}>
                    Approve & publish
                  </Button>
                )}
                {k.status === 'Approved' && live && (
                  <Button busy={busy === k.id} onClick={() => markUsed(k)}>
                    Mark as used
                  </Button>
                )}
                {k.status === 'Approved' && canPropose && (
                  <Button onClick={() => setRevising(k)}>Revise</Button>
                )}
                {k.status === 'Approved' && canPublish && (
                  <Button tone="danger" busy={busy === k.id} onClick={() => move(k, 'Archived')}>
                    Archive
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {adding && <ArticleForm onClose={() => setAdding(false)} />}
      {revising && <ArticleForm revising={revising} onClose={() => setRevising(null)} />}
    </div>
  );
};
