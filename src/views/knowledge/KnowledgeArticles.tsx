/**
 * NW production standards (knowledge articles). Proposers (Production Manager, Owner) write
 * drafts and send them for review; a knowledge editor publishes or archives them. The server
 * records the author and approver and refuses self-approval and edits to published articles.
 */
import React, { useState } from 'react';
import { BookMarked, Plus } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { KnowledgeCategory, NWProductionKnowledge } from '../../types';
import { useRecords } from '../../services/records';
import { hasPermission } from '../../utils/permissions';
import { FormError } from '../../components/ui/FormError';
import { Button, Field, Input, Modal, Pill, Select, TextArea, newId } from '../../components/ui/forms';

const CATEGORIES: KnowledgeCategory[] = ['Carpentry', 'Joinery', 'Materials', 'Joining Methods', 'Transport', 'Installation', 'Common Mistakes', 'Hardware Preferences', 'Production Limitations', 'Standard Dimensions', 'Practical Solutions'];
const TONE = { Draft: 'warn', Review: 'info', Approved: 'good', Archived: 'neutral' } as const;
type Article = NWProductionKnowledge & { created_by_id?: string; approved_at?: string };

const ArticleForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const records = useRecords();
  const [f, setF] = useState({ title: '', category: 'Joinery' as KnowledgeCategory, description: '', reason: '', example: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (status: 'Draft' | 'Review') => {
    if (!f.title.trim() || !f.description.trim()) return setError('Give the standard a title and describe it.');
    setBusy(true);
    setError(null);
    try {
      await records.create<NWProductionKnowledge>('knowledge', { id: newId('kb'), ...f, created_by: '', status, created_at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Propose a production standard"
      subtitle="It is published only after a knowledge editor approves it."
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
      <Field label="Standard">
        <TextArea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Standard description" />
      </Field>
      <Field label="Why">
        <TextArea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <Field label="Example">
        <TextArea rows={2} value={f.example} onChange={(e) => setF({ ...f, example: e.target.value })} />
      </Field>
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
          <h3 className="text-sm font-black text-slate-900">NW production standards</h3>
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
              <Plus className="h-3.5 w-3.5" /> Propose standard
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
                </div>
                <p className="mt-0.5 text-[11px] text-slate-600">{k.description}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  By {k.created_by || 'unknown'}
                  {k.approved_by ? ` · approved by ${k.approved_by}${k.approved_at ? ` on ${k.approved_at.slice(0, 10)}` : ''}` : ''}
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
    </div>
  );
};
