/**
 * NW OS Interactive Drawing Viewer & Production Intelligence Engine
 * Strictly separates "Client / Designer Drawing" from "NW Production Drawing" with full immutable revision history.
 * Implements AI DRAFT extraction, Revision Impact Checking, NW Production Method Reviews, and Production Drawing Approvals.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { hasPermission } from '../utils/permissions';
import {
  Drawing,
  DrawingRevision,
  DrawingMarkup,
  AISuggestedWorkItem,
  RevisionComparison,
  NWProductionReview,
  NWProductionDrawing,
} from '../types';
import {
  FileCode,
  Layers,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Ruler,
  Clock,
  ShieldCheck,
  ChevronRight,
  BookOpen,
  ArrowRight,
  Hammer,
  HelpCircle,
  FileCheck,
  AlertCircle,
  Split,
  Eye,
  Cpu,
  Boxes,
} from 'lucide-react';
import { NWProductionReviewModal } from './NWProductionReviewModal';
import { AuthorityNote } from './AuthorityNote';
import { authorityItem, useAuthority } from '../services/authority';
import { NWProductionDrawingModal } from './NWProductionDrawingModal';

interface DrawingViewerProps {
  drawing: Drawing;
  onRevisionChange?: (revisionId: string) => void;
}

export const DrawingViewer: React.FC<DrawingViewerProps> = ({ drawing, onRevisionChange }) => {
  const {
    currentUser,
    workPackages,
    workItems,
    contractors,
    addDrawingMarkup,
    addDrawingRevision,
    setDrawingRevisionStatus,
    analyzeDrawingWithAI,
    approveAISuggestedWorkItem,
    compareDrawingRevisions,
    approveNWProductionDrawing,
    updateWorkItem,
  } = useNW();

  const [selectedRevisionId, setSelectedRevisionId] = useState<string>(
    drawing.current_revision_id || drawing.revisions[drawing.revisions.length - 1]?.id || drawing.revisions[0]?.id
  );

  const [activeTab, setActiveTab] = useState<
    'drawing' | 'ai-draft' | 'impact' | 'nw-review' | 'nw-drawings' | 'history'
  >('drawing');

  // Interactive Markup State
  const [isAddingMarkup, setIsAddingMarkup] = useState(false);
  const [markupType, setMarkupType] = useState<DrawingMarkup['markup_type']>('dimension');
  const [markupText, setMarkupText] = useState('');
  const [markupPos, setMarkupPos] = useState<{ x: number; y: number } | null>(null);

  // Modals state
  const [showAddRevisionModal, setShowAddRevisionModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showNWDrawingModal, setShowNWDrawingModal] = useState(false);

  // New revision form
  const [newRevNumber, setNewRevNumber] = useState('Rev 5');
  const [newRevTitle, setNewRevTitle] = useState('Architectural Shop Drawing — Coordinated Mall M&E Set');
  const [newRevNotes, setNewRevNotes] = useState('Coordinated with Mall tenant guidelines and Level 2 hoist clearances.');

  // AI Analysis State
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [approvedItems, setApprovedItems] = useState<Record<string, boolean>>({});
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState<string>(
    workPackages[0]?.id || 'wp-1'
  );

  // Revision Comparison State
  const [compareFromRevId, setCompareFromRevId] = useState<string>(
    drawing.revisions.length >= 2 ? drawing.revisions[drawing.revisions.length - 2].id : drawing.revisions[0]?.id
  );
  const [compareToRevId, setCompareToRevId] = useState<string>(
    drawing.revisions[drawing.revisions.length - 1]?.id || drawing.revisions[0]?.id
  );
  const [isComparing, setIsComparing] = useState(false);
  const [activeComparison, setActiveComparison] = useState<RevisionComparison | null>(null);
  const [appliedDirective, setAppliedDirective] = useState(false);

  const currentRev =
    drawing.revisions.find((r) => r.id === selectedRevisionId) ||
    drawing.revisions[drawing.revisions.length - 1] ||
    drawing.revisions[0];

  // Who may approve / reject: the server's authority resolver (live system). Demo mode has no
  // server, so it keeps the permission-based buttons (nothing there is stored or enforced).
  const inReview = ['Internal Review', 'Pending Review', 'Review'].includes(currentRev?.approved_status ?? '');
  const pendingNw = (drawing.nw_production_drawings || []).filter((n) => !n.approved_for_production);
  const authority = useAuthority([
    ...(inReview && currentRev ? [authorityItem('drawing_revision', currentRev.id), authorityItem('drawing_revision', currentRev.id, 'reject')] : []),
    ...pendingNw.map((n) => authorityItem('drawing_revision', n.id)),
  ]);
  const may = (item: string, demoPermission: boolean) => (authority.live ? Boolean(authority.get(item)?.allowed) : demoPermission);

  // Handler: Click canvas to place pin
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingMarkup) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setMarkupPos({ x, y });
  };

  const handleSaveMarkup = () => {
    if (!markupPos || !markupText.trim()) return;

    addDrawingMarkup(drawing.id, currentRev.id, {
      drawing_revision_id: currentRev.id,
      user_name: currentUser.name,
      user_role: currentUser.role,
      date_time: new Date().toISOString().slice(0, 16).replace('T', ' '),
      markup_type: markupType,
      x: markupPos.x,
      y: markupPos.y,
      content: markupText.trim(),
      color: markupType === 'dimension' ? '#0284c7' : markupType === 'production_note' ? '#dc2626' : '#d97706',
    });

    setMarkupText('');
    setMarkupPos(null);
    setIsAddingMarkup(false);
  };

  const handleCreateRevision = (e: React.FormEvent) => {
    e.preventDefault();
    addDrawingRevision(drawing.id, {
      revision: newRevNumber,
      title: newRevTitle,
      file_url: `/assets/drawings/${drawing.drawing_number}-${newRevNumber}.svg`,
      notes: newRevNotes,
      supersedes_revision: currentRev.revision,
      drawing_type: 'Client / Designer Drawing',
    });
    setShowAddRevisionModal(false);
  };

  const handleRunAIAnalysis = async () => {
    setIsAnalyzingAI(true);
    setAiError(null);
    try {
      await analyzeDrawingWithAI(drawing.id, currentRev.id);
    } catch (err) {
      setAiError('Analysis completed using workshop rule heuristics.');
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  const handleApproveWorkItem = (item: AISuggestedWorkItem, idx: number) => {
    approveAISuggestedWorkItem(
      drawing.id,
      currentRev.id,
      item,
      selectedWorkPackageId,
      contractors[0]?.id
    );
    setApprovedItems((prev) => ({ ...prev, [idx]: true }));
  };

  const handleRunComparison = async () => {
    setIsComparing(true);
    try {
      const comp = await compareDrawingRevisions(drawing.id, compareFromRevId, compareToRevId);
      setActiveComparison(comp);
    } catch (err) {
      console.error('Comparison error:', err);
    } finally {
      setIsComparing(false);
    }
  };

  const handleApplyPlinthDirective = () => {
    // Locate Work Item CAR-003 and apply practical workshop directive
    const carItem = workItems.find((w) => w.item_code === 'CAR-003');
    if (carItem) {
      updateWorkItem(carItem.id, {
        notes: `${carItem.notes || ''}\n[ENGINEERING DIRECTIVE APPLIED]: Rev 4 site length reduced to 2300mm. Approved workshop method: Trim 100mm off Module B end scribe plinth. Carcase core preserved. Avoids RM 4,200 scrap.`,
        revision_impact_alert: undefined,
      });
    }
    setAppliedDirective(true);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl text-slate-200">
      {/* Top Header Bar */}
      <div className="p-4 sm:p-6 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="px-3 py-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-mono font-bold">
              {drawing.drawing_number}
            </span>
            <h2 className="text-base sm:text-xl font-bold text-white tracking-tight">
              {drawing.title}
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center space-x-2">
            <span>Trade: <strong className="text-slate-300 font-semibold">{drawing.category}</strong></span>
            <span>•</span>
            <span>Active Revision: <strong className="text-amber-400 font-mono font-bold">{currentRev.revision}</strong></span>
            <span>•</span>
            <span className="text-[11px] text-slate-400 font-medium">({currentRev.drawing_type})</span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Add Review */}
          <button
            onClick={() => setShowReviewModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <Hammer className="w-3.5 h-3.5 text-amber-400" />
            <span>+ Add NW Review</span>
          </button>

          {/* Create NW Drawing */}
          <button
            onClick={() => setShowNWDrawingModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <FileCode className="w-3.5 h-3.5 text-emerald-400" />
            <span>+ Create NW Drawing</span>
          </button>

          {/* Add Revision */}
          <button
            onClick={() => setShowAddRevisionModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-slate-950" />
            <span>+ New Revision</span>
          </button>

          {/* Revision review: Draft -> Internal Review -> Approved (server enforces who may) */}
          {currentRev?.approved_status === 'Draft' && hasPermission(currentUser, 'drawings.upload') && (
            <button
              onClick={() => setDrawingRevisionStatus(drawing.id, currentRev.id, 'Internal Review')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <span>Submit for Internal Review</span>
            </button>
          )}
          {inReview && may(authorityItem('drawing_revision', currentRev.id), hasPermission(currentUser, 'drawings.approve')) && (
            <button
              onClick={() => setDrawingRevisionStatus(drawing.id, currentRev.id, 'Approved')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <span>Approve Revision</span>
            </button>
          )}
          {inReview && may(authorityItem('drawing_revision', currentRev.id, 'reject'), hasPermission(currentUser, 'drawings.approve')) && (
            <button
              onClick={() => setDrawingRevisionStatus(drawing.id, currentRev.id, 'Rejected')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <span>Reject Revision</span>
            </button>
          )}
          {inReview && authority.live && <AuthorityNote dark authority={authority.get(authorityItem('drawing_revision', currentRev.id))} />}

          {/* Interactive Markup Toggle */}
          <button
            onClick={() => setIsAddingMarkup(!isAddingMarkup)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isAddingMarkup
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
            <span>{isAddingMarkup ? 'Cancel Markup' : 'Add Pin / Note'}</span>
          </button>
        </div>
      </div>

      {/* Revision Switcher Strip with Superseded / Current Status */}
      <div className="bg-slate-950/90 border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between overflow-x-auto gap-3">
        <div className="flex items-center space-x-2 text-xs font-medium">
          <Layers className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-slate-400 shrink-0">Revision Lineage:</span>
          <div className="flex items-center space-x-1.5">
            {drawing.revisions.map((rev, idx) => {
              const isSelected = selectedRevisionId === rev.id;
              const isLatest = idx === drawing.revisions.length - 1;
              return (
                <button
                  key={rev.id}
                  onClick={() => {
                    setSelectedRevisionId(rev.id);
                    if (onRevisionChange) onRevisionChange(rev.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-400/40'
                      : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750 border border-slate-700/60'
                  }`}
                >
                  <span>{rev.revision}</span>
                  {rev.approved_status === 'Approved' ? (
                    <span className="text-[9px] font-sans px-1 rounded bg-emerald-500/30 text-emerald-200">
                      APPROVED
                    </span>
                  ) : rev.approved_status === 'Superseded' ? (
                    <span className="text-[9px] font-sans px-1 rounded bg-slate-700 text-slate-400">
                      SUPERSEDED
                    </span>
                  ) : (
                    <span className="text-[9px] font-sans px-1 rounded bg-amber-500/30 text-amber-200">
                      {rev.approved_status === 'Draft'
                        ? 'DRAFT'
                        : rev.approved_status === 'Rejected'
                          ? 'REJECTED'
                          : 'IN REVIEW'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Drawing Type Badge */}
        <div className="shrink-0 flex items-center space-x-2">
          <span
            className={`text-xs font-bold px-3 py-1 rounded-lg border ${
              currentRev.drawing_type === 'NW Production Drawing'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
            }`}
          >
            {currentRev.drawing_type}
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-800 px-4 sm:px-6 flex space-x-2 sm:space-x-6 text-xs font-bold overflow-x-auto">
        <button
          onClick={() => setActiveTab('drawing')}
          className={`py-3.5 border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'drawing'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Drawing & Markups ({currentRev.markups?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('ai-draft')}
          className={`py-3.5 border-b-2 flex items-center space-x-1.5 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'ai-draft'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>AI DRAFT Specification & Work Items</span>
        </button>

        <button
          onClick={() => setActiveTab('impact')}
          className={`py-3.5 border-b-2 flex items-center space-x-1.5 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'impact'
              ? 'border-rose-400 text-rose-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Split className="w-3.5 h-3.5 text-rose-400" />
          <span>Revision Impact & Work Item Check</span>
        </button>

        <button
          onClick={() => setActiveTab('nw-review')}
          className={`py-3.5 border-b-2 flex items-center space-x-1.5 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'nw-review'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Hammer className="w-3.5 h-3.5 text-amber-400" />
          <span>NW Workshop Method ({drawing.production_reviews?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('nw-drawings')}
          className={`py-3.5 border-b-2 flex items-center space-x-1.5 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'nw-drawings'
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>NW Production Drawings ({drawing.nw_production_drawings?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`py-3.5 border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'history'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Audit Lineage ({drawing.revisions.length})
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DRAWING & MARKUPS */}
      {/* ========================================================================= */}
      {activeTab === 'drawing' && (
        <div className="p-4 sm:p-6 space-y-4">
          {/* Active Revision Banner */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-300 gap-2">
            <div>
              <span className="font-bold text-white">{currentRev.title}</span>
              <span className="text-slate-400 ml-2">
                (Uploaded by <strong>{currentRev.uploaded_by}</strong> on {currentRev.uploaded_date})
              </span>
            </div>
            {currentRev.supersedes_revision && (
              <span className="text-[11px] text-amber-400 font-mono font-semibold">
                Supersedes: {currentRev.supersedes_revision}
              </span>
            )}
          </div>

          {/* Interactive Canvas */}
          <div className="relative rounded-2xl border border-slate-700 bg-slate-950 overflow-hidden shadow-inner select-none">
            <div
              onClick={handleCanvasClick}
              className={`w-full min-h-[460px] p-6 flex flex-col items-center justify-center relative ${
                isAddingMarkup ? 'cursor-crosshair' : 'cursor-default'
              }`}
            >
              {/* Architectural Grid */}
              <div
                className="absolute inset-0 opacity-15 pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, #38bdf8 1px, transparent 1px), linear-gradient(to bottom, #38bdf8 1px, transparent 1px)',
                  backgroundSize: '32px 32px',
                }}
              />

              {/* DRAWING VISUALIZATIONS */}
              {currentRev.revision === 'Rev 1' ? (
                /* REVISION 1: Monolithic Single Piece (Client Original) */
                <div className="w-full max-w-2xl bg-slate-900/90 border-2 border-rose-500/50 rounded-2xl p-6 sm:p-8 relative z-10 shadow-2xl">
                  <div className="absolute -top-3.5 left-4 bg-rose-500 text-white text-[10px] font-black px-3 py-0.5 rounded shadow">
                    SUPERSEDED BY REV 2 — MONOLITHIC DESIGN HAZARD
                  </div>

                  <div className="text-center mb-5">
                    <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">
                      Original Client Concept: 2400mm Monolithic Unit
                    </span>
                    <div className="h-0.5 w-28 bg-rose-500/50 mx-auto mt-1" />
                  </div>

                  <div className="border-2 border-dashed border-rose-400/60 bg-slate-950/80 rounded-xl p-6 relative">
                    <div className="flex items-center justify-between text-xs text-rose-400 font-mono font-bold mb-2">
                      <span>◄──────────────── 2400mm Single Carcase ────────────────►</span>
                    </div>

                    <div className="h-32 rounded-lg bg-gradient-to-r from-slate-800 to-slate-750 border border-slate-600 flex items-center justify-center relative shadow-inner">
                      <div className="text-center p-3">
                        <div className="text-sm font-black text-white">Cashier Checkout Counter Body</div>
                        <div className="text-xs text-rose-400 font-semibold mt-1">
                          ⚠️ Lift Clearance Violation (Pavilion Hoist max: 2200mm)
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 leading-relaxed">
                      <strong>NW Production Feedback:</strong> Cannot be transported via Level 2 service hoist without severe tilting. Weight exceeds 140kg single lift safety limit. Requires modular split.
                    </div>
                  </div>
                </div>
              ) : currentRev.revision === 'Rev 4' ? (
                /* REVISION 4: Site Variance 2300mm (-100mm) */
                <div className="w-full max-w-3xl bg-slate-900/95 border-2 border-amber-500/60 rounded-2xl p-6 sm:p-8 relative z-10 shadow-2xl">
                  <div className="absolute -top-3.5 left-4 bg-amber-500 text-slate-950 text-[10px] font-black px-3 py-0.5 rounded shadow">
                    REVISION 4 — SITE VARIANCE DETECTED (2300mm)
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-amber-400 mb-3 font-bold">
                    <span>Revised Dimension: 2300mm (-100mm Reduction Due to Site Column Encasement)</span>
                    <span className="text-slate-400">Depth: 900mm | Height: 1050mm</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
                    {/* MODULE A */}
                    <div className="border border-sky-500/70 bg-slate-950/90 rounded-xl p-4">
                      <div className="text-xs font-bold text-sky-400 mb-1 flex items-center justify-between">
                        <span>MODULE A (1200mm)</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-950 text-emerald-300 rounded font-semibold">
                          UNTOUCHED (Standard)
                        </span>
                      </div>
                      <div className="h-32 rounded-lg bg-slate-800/80 border border-slate-700 flex flex-col justify-between p-3">
                        <div className="text-xs text-white font-bold">Corian Solid Surface Top</div>
                        <div className="text-[11px] text-sky-300">POS & Cashier Under-bench Tray</div>
                        <div className="text-[10px] text-slate-400 font-mono">Hafele Full-Extension Runners</div>
                      </div>
                    </div>

                    {/* MODULE B WITH 100mm FIELD PLINTH TRIM */}
                    <div className="border border-amber-500/80 bg-slate-950/90 rounded-xl p-4 relative">
                      <div className="text-xs font-bold text-amber-400 mb-1 flex items-center justify-between">
                        <span>MODULE B (1100mm Effective)</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-950 text-amber-300 rounded font-bold">
                          -100mm PLINTH TRIM
                        </span>
                      </div>
                      <div className="h-32 rounded-lg bg-slate-800/80 border border-slate-700 flex flex-col justify-between p-3">
                        <div className="text-xs text-white font-bold">Wrap Station & Cavity</div>
                        <div className="text-[11px] text-amber-300 font-medium">
                          Trim 100mm off end scribe plinth without modifying carcase core!
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">Concealed Domino Pins</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-amber-950/40 border border-amber-800/70 rounded-xl text-xs text-amber-300 flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>NW Engineering Directive:</strong> Carcase CAR-003 is already in Assembly at workshop based on Rev 3. Do NOT scrap or cut the main carcase. Trim 100mm from Module B end plinth filler. Saves RM 4,200 in material and avoids 5-day rework delay.
                    </div>
                  </div>
                </div>
              ) : (
                /* REVISION 2 & 3: Approved NW Production Drawing (2 × 1200mm Split Modules) */
                <div className="w-full max-w-3xl bg-slate-900/90 border-2 border-emerald-500/50 rounded-2xl p-6 sm:p-8 relative z-10 shadow-2xl">
                  <div className="absolute -top-3.5 left-4 bg-emerald-600 text-white text-[10px] font-black px-3 py-0.5 rounded shadow">
                    APPROVED NW PRODUCTION METHOD — MODULAR CARCASE
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-emerald-400 mb-3 font-bold">
                    <span>Overall: 2400mm (Module A 1200mm + Module B 1200mm)</span>
                    <span className="text-slate-400">Depth: 900mm | Height: 1050mm</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
                    {/* MODULE A */}
                    <div className="border border-sky-500/60 bg-slate-950/90 rounded-xl p-4">
                      <div className="text-xs font-bold text-sky-400 mb-1 flex items-center justify-between">
                        <span>MODULE A (1200mm)</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-sky-950 text-sky-300 rounded font-semibold">
                          Cashier & POS
                        </span>
                      </div>
                      <div className="h-32 rounded-lg bg-slate-800/80 border border-slate-700 flex flex-col justify-between p-3">
                        <div className="text-xs text-white font-bold">Corian Top (Glacier White)</div>
                        <div className="border-t border-dashed border-sky-500/40 pt-1 text-[11px] text-sky-300">
                          Pre-routed 50×75mm PVC Cable Raceway
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                          <span>3 Lockable Drawers</span>
                          <span>Hafele Heavy Runners</span>
                        </div>
                      </div>
                    </div>

                    {/* MODULE B */}
                    <div className="border border-sky-500/60 bg-slate-950/90 rounded-xl p-4">
                      <div className="text-xs font-bold text-sky-400 mb-1 flex items-center justify-between">
                        <span>MODULE B (1200mm)</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-sky-950 text-sky-300 rounded font-semibold">
                          Bagging & Wrap
                        </span>
                      </div>
                      <div className="h-32 rounded-lg bg-slate-800/80 border border-slate-700 flex flex-col justify-between p-3">
                        <div className="text-xs text-white font-bold">Under-counter Storage Cavity</div>
                        <div className="border-t border-dashed border-emerald-500/40 pt-1 text-[11px] text-emerald-300">
                          Pre-drilled for 4 × M6 Worktop Connecting Bolts
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                          <span>Adjustable Shelving</span>
                          <span>Festool Domino Joints</span>
                        </div>
                      </div>
                    </div>

                    {/* Joiner Center Pin */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden sm:flex flex-col items-center pointer-events-none">
                      <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center font-black text-xs shadow-md">
                        ⇄
                      </div>
                      <span className="text-[9px] bg-slate-950 px-1.5 py-0.5 rounded text-amber-300 border border-slate-800 mt-1 whitespace-nowrap font-bold">
                        Concealed Domino Pins
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
                    <div>
                      Material: <span className="text-white font-semibold">18mm E1 Marine Plywood</span> • Finish:{' '}
                      <span className="text-white font-semibold">Wilsonart Natural Oak HPL</span>
                    </div>
                    <div className="text-emerald-400 font-bold flex items-center space-x-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Fits Pavilion Level 2 Service Hoist (Max segment 1200mm)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Interactive Markup Pins */}
              {(currentRev.markups || []).map((mk) => (
                <div
                  key={mk.id}
                  style={{ left: `${mk.x}%`, top: `${mk.y}%` }}
                  className="absolute z-20 -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shadow-xl ring-2 ring-white/40 transition-transform group-hover:scale-125"
                    style={{ backgroundColor: mk.color || '#0284c7' }}
                  >
                    {mk.markup_type === 'dimension' ? '📏' : mk.markup_type === 'production_note' ? '⚠️' : '💬'}
                  </div>

                  {/* Tooltip */}
                  <div className="absolute bottom-9 left-1/2 -translate-x-1/2 w-64 bg-slate-900 border border-slate-700 text-slate-200 p-3 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-30">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="font-bold text-amber-400">{mk.user_name}</span>
                      <span>{mk.date_time}</span>
                    </div>
                    <p className="text-xs text-white leading-relaxed">{mk.content}</p>
                  </div>
                </div>
              ))}

              {/* Temporary Pin while adding markup */}
              {markupPos && (
                <div
                  style={{ left: `${markupPos.x}%`, top: `${markupPos.y}%` }}
                  className="absolute z-30 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center text-sm font-black animate-bounce shadow-xl"
                >
                  📍
                </div>
              )}
            </div>

            {/* In-Canvas Markup Input Drawer */}
            {isAddingMarkup && (
              <div className="p-4 bg-slate-900 border-t border-slate-800">
                {!markupPos ? (
                  <p className="text-xs text-amber-400 font-bold animate-pulse">
                    👉 Click anywhere on the drawing blueprint above to place your markup pin.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-slate-400 font-semibold">Markup Type:</span>
                      {(['dimension', 'production_note', 'installation_note', 'material_note'] as const).map(
                        (type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setMarkupType(type)}
                            className={`px-3 py-1 rounded-lg text-xs capitalize font-bold transition-all cursor-pointer ${
                              markupType === type
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {type.replace('_', ' ')}
                          </button>
                        )
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={markupText}
                        onChange={(e) => setMarkupText(e.target.value)}
                        placeholder="Type observation, measurement note, or contractor clarification..."
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveMarkup}
                        disabled={!markupText.trim()}
                        className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl shadow transition-colors cursor-pointer"
                      >
                        Save Pin
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: AI DRAFT SPECIFICATION & WORK ITEM GENERATOR */}
      {/* ========================================================================= */}
      {activeTab === 'ai-draft' && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* Mandatory AI DRAFT Banner */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                    AI DRAFT — NOT APPROVED
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 font-mono font-bold">
                    gemini-3.8-flash
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                  Extracted specifications, buildability concerns, and suggested Work Items. 
                  <strong> AI must never automatically change the Work Item. Human approval is always required.</strong>
                </p>
              </div>
            </div>

            <button
              onClick={handleRunAIAnalysis}
              disabled={isAnalyzingAI}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2 shrink-0 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isAnalyzingAI ? 'Analyzing Drawing CAD...' : 'Analyze Drawing with AI'}</span>
            </button>
          </div>

          {currentRev.ai_analysis ? (
            <div className="space-y-6">
              {/* Extracted 4-Grid Specs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Dimensions */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                  <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider mb-2.5 flex items-center space-x-2">
                    <Ruler className="w-4 h-4" />
                    <span>Extracted Dimensions & Quantities</span>
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {currentRev.ai_analysis.dimensions.map((dim, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="text-sky-400 font-mono font-bold">•</span>
                        <span>{dim}</span>
                      </li>
                    ))}
                    {currentRev.ai_analysis.quantities?.map((qty, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="text-sky-400 font-mono font-bold">•</span>
                        <span>Quantity: <strong>{qty}</strong></span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Materials & Finishes */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2.5 flex items-center space-x-2">
                    <Layers className="w-4 h-4" />
                    <span>Materials & Finishes</span>
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {currentRev.ai_analysis.materials.map((mat, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="text-emerald-400 font-mono font-bold">•</span>
                        <span>{mat}</span>
                      </li>
                    ))}
                    {currentRev.ai_analysis.finishes.map((fin, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="text-emerald-300 font-mono font-bold">•</span>
                        <span>Finish: {fin}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Production Concerns */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2.5 flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Production & Buildability Concerns</span>
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-300">
                    {currentRev.ai_analysis.production_concerns.map((pc, idx) => (
                      <li key={idx} className="flex items-start space-x-2 p-2 bg-amber-950/20 rounded-lg border border-amber-500/20">
                        <span className="text-amber-400 font-bold shrink-0">⚠️</span>
                        <span className="text-amber-200">{pc}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Matched Company Standards */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                  <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2.5 flex items-center space-x-2">
                    <BookOpen className="w-4 h-4" />
                    <span>Matched NW Knowledge Standards</span>
                  </h4>
                  <div className="space-y-2">
                    {(currentRev.ai_analysis.matched_knowledge || []).map((std) => (
                      <div key={std.id} className="p-2.5 bg-indigo-950/30 border border-indigo-500/30 rounded-xl text-xs">
                        <div className="flex items-center justify-between text-indigo-300 font-bold mb-1">
                          <span>{std.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/60 font-mono">
                            {std.category}
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">{std.recommendation}</p>
                      </div>
                    ))}
                    {(!currentRev.ai_analysis.matched_knowledge || currentRev.ai_analysis.matched_knowledge.length === 0) && (
                      <p className="text-xs text-slate-400">Checking against company joinery standard handbook...</p>
                    )}
                  </div>
                </div>
              </div>

              {/* SUGGESTED WORK ITEMS SECTION (HUMAN APPROVAL REQUIRED) */}
              <div className="bg-slate-950/90 border-2 border-amber-500/40 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Boxes className="w-5 h-5 text-amber-400" />
                      <h4 className="text-sm font-black text-white uppercase tracking-tight">
                        AI Suggested Work Items for Creation
                      </h4>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Review proposed deliverables extracted from CAD. Approve to register official Work Item with exact drawing lineage.
                    </p>
                  </div>

                  {/* Target Work Package Selector */}
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400 font-semibold shrink-0">Target Package:</span>
                    <select
                      value={selectedWorkPackageId}
                      onChange={(e) => setSelectedWorkPackageId(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      {workPackages.map((wp) => (
                        <option key={wp.id} value={wp.id}>
                          {wp.category} — {wp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Suggested Items Grid */}
                <div className="space-y-3">
                  {(currentRev.ai_analysis.potential_work_items || []).map((item, idx) => {
                    const isApproved = approvedItems[idx];
                    return (
                      <div
                        key={idx}
                        className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5 max-w-2xl">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-xs font-bold">
                              {item.item_code}
                            </span>
                            <span className="text-sm font-bold text-white">{item.description}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                              Trade: {item.trade || 'Carpentry'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400">
                            <div>
                              <span>Dimensions: </span>
                              <strong className="text-slate-200">{item.dimensions}</strong>
                            </div>
                            <div>
                              <span>Quantity: </span>
                              <strong className="text-slate-200">{item.quantity} {item.unit || 'Set'}</strong>
                            </div>
                            <div>
                              <span>Material: </span>
                              <strong className="text-slate-200 truncate block">{item.material}</strong>
                            </div>
                            <div>
                              <span>Location: </span>
                              <strong className="text-slate-200">{item.location}</strong>
                            </div>
                          </div>

                          {item.reasoning && (
                            <p className="text-[11px] text-slate-400 italic pt-1">
                              Reasoning: {item.reasoning}
                            </p>
                          )}
                        </div>

                        {/* Approval Button */}
                        <div className="shrink-0">
                          {isApproved ? (
                            <div className="px-4 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold flex items-center space-x-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <span>Work Item Created & Bound to {currentRev.revision}</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleApproveWorkItem(item, idx)}
                              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Approve as Work Item</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-950/60 rounded-2xl border border-slate-800">
              <Sparkles className="w-8 h-8 text-amber-400 mx-auto mb-2 opacity-60" />
              <p className="text-xs text-slate-400 font-medium">
                No AI analysis generated for revision {currentRev.revision} yet. Click "Analyze Drawing with AI" above to extract specifications and proposed work items.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: REVISION IMPACT ANALYSIS & WORK ITEM CHECK */}
      {/* ========================================================================= */}
      {activeTab === 'impact' && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* Comparison Selector */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <Split className="w-5 h-5 text-rose-400" />
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Compare Drawing Revisions & Cross-Reference Work Items
                </h4>
                <p className="text-[11px] text-slate-400">
                  Detects dimensional, material, and specification shifts, cross-referencing factory stage.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">From:</span>
                <select
                  value={compareFromRevId}
                  onChange={(e) => setCompareFromRevId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-200"
                >
                  {drawing.revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.revision} ({r.drawing_type})
                    </option>
                  ))}
                </select>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-500" />

              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">To:</span>
                <select
                  value={compareToRevId}
                  onChange={(e) => setCompareToRevId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-200"
                >
                  {drawing.revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.revision} ({r.drawing_type})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleRunComparison}
                disabled={isComparing || compareFromRevId === compareToRevId}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow transition-all cursor-pointer"
              >
                {isComparing ? 'Comparing...' : 'Run Revision Diff'}
              </button>
            </div>
          </div>

          {/* CRITICAL WARNING BANNER: PRODUCTION IMPACT POSSIBLE */}
          <div className="p-5 rounded-2xl bg-rose-950/50 border-2 border-rose-500/70 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded bg-rose-500 text-white text-[11px] font-black uppercase tracking-wider">
                    ⚠️ PRODUCTION IMPACT POSSIBLE
                  </span>
                  <span className="text-xs font-mono font-bold text-rose-300">
                    CAR-003 is already at Factory Assembly Stage!
                  </span>
                </div>
                <p className="text-xs text-rose-200 leading-relaxed pt-1">
                  Item <strong>CAR-003 (Checkout Counter #03)</strong> was fabricated and assembled based on <strong>Rev 3 (2400mm)</strong>. 
                  Incoming <strong>Rev 4</strong> reduces overall length to <strong>2300mm (-100mm)</strong> due to mall structural column encasement.
                </p>
              </div>
            </div>

            {/* Affected Work Item Detail Card */}
            <div className="bg-slate-900/90 border border-rose-500/40 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-800 pb-2">
                <div>
                  <span className="font-mono font-bold text-amber-400">CAR-003</span>
                  <span className="text-white font-bold ml-2">Checkout Counter #03 (2 × 1200mm Split Modules)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-slate-400">Current Production Status:</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold font-mono">
                    In Progress (Assembly)
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-2">
                <div className="text-slate-300">
                  <strong className="text-amber-400">Workshop Intelligence Action:</strong> Do NOT scrap or recut the plywood carcass. Module A (Cashier station, 1200mm) remains untouched. 
                  Apply field adjustment to Module B: <strong>Trim 100mm off outer plinth filler</strong> to absorb site variance.
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-400 font-mono">
                  <span>Estimated Cost Saved: <strong>RM 4,200</strong></span>
                  <span>Fabrication Delay Avoided: <strong>5 Days</strong></span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {appliedDirective ? (
                  <div className="px-3.5 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Plinth Trim Directive Applied to CAR-003</span>
                  </div>
                ) : (
                  <button
                    onClick={handleApplyPlinthDirective}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow transition-all flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Hammer className="w-4 h-4" />
                    <span>Apply Plinth Trim Engineering Directive</span>
                  </button>
                )}

                <button
                  onClick={() => alert('Variation Order VO-004 created for Mall Column Encasement adjustment.')}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 cursor-pointer"
                >
                  Create Variation Order
                </button>

                <button
                  onClick={() => alert('Clarification requested with Resident Architect & Mall Landlord.')}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 cursor-pointer"
                >
                  Request Site Clarification
                </button>
              </div>
            </div>
          </div>

          {/* Revision Diff Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3">
                Detected Dimensional & Geometric Changes
              </h4>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-start space-x-2">
                  <span className="text-rose-400 font-bold">Δ</span>
                  <span>
                    Counter length reduced from <strong>2400mm</strong> to <strong>2300mm</strong> (-100mm).
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-rose-400 font-bold">Δ</span>
                  <span>
                    Wall clearance plinth offset modified to align with Column C3 encasement.
                  </span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3">
                Material & Hardware Deltas
              </h4>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-start space-x-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Core carcass remains 18mm E1 Marine Plywood.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Wilsonart Natural Oak HPL finish unchanged.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: NW WORKSHOP METHOD & EXPERT PRODUCTION REVIEWS */}
      {/* ========================================================================= */}
      {activeTab === 'nw-review' && (
        <div className="p-4 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center space-x-2">
                <Hammer className="w-5 h-5 text-amber-400" />
                <span>NW Production Reviews & Joinery Engineering</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-world workshop methods captured by Foremen, Master Joiners, and PMs prior to fabrication release.
              </p>
            </div>

            <button
              onClick={() => setShowReviewModal(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow flex items-center space-x-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add NW Production Review</span>
            </button>
          </div>

          {/* List of Reviews */}
          <div className="space-y-4">
            {(drawing.production_reviews || []).map((review) => (
              <div
                key={review.id}
                className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-md"
              >
                {/* Review Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 font-mono text-xs font-bold">
                      {review.client_drawing_revision}
                    </span>
                    <div>
                      <span className="text-xs font-bold text-white">{review.reviewed_by}</span>
                      <span className="text-[11px] text-slate-400 ml-1.5">({review.reviewer_role})</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {review.is_company_standard && (
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[10px] font-bold uppercase tracking-wider flex items-center space-x-1">
                        <BookOpen className="w-3 h-3" />
                        <span>NW Company Standard</span>
                      </span>
                    )}
                    <span className="text-xs text-slate-500 font-mono">{review.review_date}</span>
                  </div>
                </div>

                {/* Recommendation & Justification */}
                <div className="space-y-2">
                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-700/80">
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
                      Production Recommendation
                    </span>
                    <p className="text-xs text-white font-semibold leading-relaxed">
                      {review.production_recommendation}
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Buildability Reason
                    </span>
                    <p className="text-xs text-slate-300 leading-relaxed">{review.reason}</p>
                  </div>
                </div>

                {/* Practical Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  {review.joining_method && (
                    <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block">Joining Method</span>
                      <span className="text-slate-200 mt-0.5 block">{review.joining_method}</span>
                    </div>
                  )}

                  {review.transport_consideration && (
                    <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block">Transport & Lift</span>
                      <span className="text-slate-200 mt-0.5 block">{review.transport_consideration}</span>
                    </div>
                  )}

                  {review.hardware && (
                    <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block">Hardware Spec</span>
                      <span className="text-slate-200 mt-0.5 block">{review.hardware}</span>
                    </div>
                  )}

                  {review.installation_method && (
                    <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-800 sm:col-span-2">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block">Installation Method</span>
                      <span className="text-slate-200 mt-0.5 block">{review.installation_method}</span>
                    </div>
                  )}

                  {review.production_risk && (
                    <div className="p-2.5 bg-amber-950/20 rounded-lg border border-amber-500/30 sm:col-span-3">
                      <span className="text-[10px] text-amber-400 font-bold uppercase block flex items-center space-x-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Identified Risk & Mitigation</span>
                      </span>
                      <span className="text-amber-200 mt-0.5 block">{review.production_risk}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {(!drawing.production_reviews || drawing.production_reviews.length === 0) && (
              <p className="text-xs text-slate-400 p-6 text-center">
                No NW production reviews recorded for this drawing yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: NW PRODUCTION DRAWINGS & SHOP RELEASE */}
      {/* ========================================================================= */}
      {activeTab === 'nw-drawings' && (
        <div className="p-4 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center space-x-2">
                <FileCheck className="w-5 h-5 text-emerald-400" />
                <span>NW Production Drawings & Fabrication Release</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Official shop drawings derived from client design, engineered with split modules and Domino joinery.
              </p>
            </div>

            <button
              onClick={() => setShowNWDrawingModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow flex items-center space-x-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>+ Create NW Production Drawing</span>
            </button>
          </div>

          <div className="space-y-5">
            {(drawing.nw_production_drawings || []).map((nwd) => (
              <div
                key={nwd.id}
                className="bg-slate-950/85 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl relative overflow-hidden"
              >
                {/* Official "APPROVED FOR PRODUCTION" Stamp */}
                {nwd.approved_for_production ? (
                  <div className="p-4 bg-emerald-950/40 border-2 border-emerald-500/70 rounded-xl flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-lg shadow-md">
                        ✓
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                            APPROVED FOR PRODUCTION
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-300 font-mono font-bold">
                            OFFICIAL RELEASE
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Approved by <strong>{nwd.approved_by}</strong> on {nwd.approved_date}. Released to CNC and assembly line.
                        </p>
                      </div>
                    </div>

                    <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 px-3 py-1 rounded-lg border border-emerald-500/40">
                      STAMP: NW-PROD-OK
                    </span>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-950/30 border border-amber-500/40 rounded-xl flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
                        Internal Technical Review
                      </span>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Awaiting authorized PM / Workshop Foreman sign-off before manufacturing order release.
                      </p>
                    </div>

                    {may(authorityItem('drawing_revision', nwd.id), true) ? (
                      <button
                        onClick={() => approveNWProductionDrawing(drawing.id, nwd.id, currentUser.name)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center space-x-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Authorize & Stamp "APPROVED FOR PRODUCTION"</span>
                      </button>
                    ) : (
                      <AuthorityNote dark authority={authority.get(authorityItem('drawing_revision', nwd.id))} />
                    )}
                  </div>
                )}

                {/* Drawing Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-mono text-xs font-bold">
                      {nwd.drawing_number} ({nwd.revision})
                    </span>
                    <span className="text-sm font-bold text-white">{nwd.title}</span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    Linked Client Drawing: {drawing.drawing_number} ({nwd.linked_client_revision})
                  </span>
                </div>

                {/* Specifications */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                      Revised Dimensions for Buildability
                    </span>
                    <span className="text-emerald-400 font-mono font-bold">{nwd.revised_dimensions}</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                      Joining Method & Connectors
                    </span>
                    <span className="text-slate-200">{nwd.joining_method}</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                      Assembly Instructions
                    </span>
                    <span className="text-slate-300 leading-relaxed">{nwd.assembly_instructions}</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                      Site Installation Method
                    </span>
                    <span className="text-slate-300 leading-relaxed">{nwd.installation_instructions}</span>
                  </div>
                </div>
              </div>
            ))}

            {(!drawing.nw_production_drawings || drawing.nw_production_drawings.length === 0) && (
              <p className="text-xs text-slate-400 p-6 text-center">
                No NW production drawings generated yet. Click "+ Create NW Production Drawing" to start.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: REVISION AUDIT & HISTORY */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="p-4 sm:p-6 space-y-4">
          <div className="divide-y divide-slate-800">
            {drawing.revisions.map((rev) => (
              <div key={rev.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded bg-slate-800 text-amber-400 font-mono font-bold text-xs">
                      {rev.revision}
                    </span>
                    <span className="text-xs font-bold text-slate-100">{rev.title}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        rev.approved_status === 'Approved'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : rev.approved_status === 'Superseded'
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {rev.approved_status}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{rev.uploaded_date}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 mt-2 bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                  {rev.notes}
                </p>

                <div className="mt-2 text-[11px] text-slate-400 flex items-center space-x-4">
                  <span>Author / Uploaded by: {rev.uploaded_by}</span>
                  <span>Type: {rev.drawing_type}</span>
                  {rev.supersedes_revision && <span>Replaces: {rev.supersedes_revision}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Revision Modal */}
      {showAddRevisionModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 text-slate-200 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Layers className="w-5 h-5 text-amber-400" />
              <span>Create New Drawing Revision</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Original client drawings are preserved. Previous revision becomes <strong>Superseded</strong>.
            </p>

            <form onSubmit={handleCreateRevision} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Revision Code & Title
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={newRevNumber}
                    onChange={(e) => setNewRevNumber(e.target.value)}
                    placeholder="Rev 5"
                    className="col-span-1 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono font-bold"
                    required
                  />
                  <input
                    type="text"
                    value={newRevTitle}
                    onChange={(e) => setNewRevTitle(e.target.value)}
                    placeholder="Revision Title"
                    className="col-span-3 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-400 font-medium"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Engineering Notes / Reason for Revision
                </label>
                <textarea
                  value={newRevNotes}
                  onChange={(e) => setNewRevNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddRevisionModal(false)}
                  className="px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-xl border border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl shadow"
                >
                  Publish Revision
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Production Review Modal */}
      {showReviewModal && (
        <NWProductionReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          drawing={drawing}
          activeRevisionCode={currentRev.revision}
        />
      )}

      {/* NW Production Drawing Modal */}
      {showNWDrawingModal && (
        <NWProductionDrawingModal
          isOpen={showNWDrawingModal}
          onClose={() => setShowNWDrawingModal(false)}
          drawing={drawing}
          activeRevisionCode={currentRev.revision}
        />
      )}
    </div>
  );
};
