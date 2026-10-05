/**
 * NW OS Shop Drawings & Revision Management View
 * Strictly separates "Client / Designer Drawing" from "NW Production Drawing" with full immutable revision history.
 * Features an interactive 9-step simulation walkthrough demonstrating the full end-to-end governance lifecycle.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { DrawingViewer } from '../components/DrawingViewer';
import { UploadDrawingModal } from '../components/UploadDrawingModal';
import { RevisionRegister } from '../components/RevisionRegister';
import { canUploadClientDrawing } from '../utils/permissions';
import {
  Layers,
  FileText,
  ChevronRight,
  Sparkles,
  ShieldAlert,
  Plus,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Hammer,
  Search,
  Filter,
  Eye,
  Boxes,
  Cpu,
} from 'lucide-react';
import { KnowledgeCategory } from '../types';

export const DrawingsView: React.FC = () => {
  const {
    currentUser,
    drawings,
    selectedProjectId,
    projects,
    drawingDemoStep,
    runDrawingDemoWorkflowStep,
    resetDrawingDemo,
  } = useNW();

  const [selectedDrawingId, setSelectedDrawingId] = useState<string>(drawings[0]?.id || 'dwg-1');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isAdvancingDemo, setIsAdvancingDemo] = useState(false);

  const canUpload = canUploadClientDrawing(currentUser);

  const activeDrawing = drawings.find((d) => d.id === selectedDrawingId) || drawings[0];

  const filteredDrawings = drawings.filter((dwg) => {
    const matchesSearch =
      dwg.drawing_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dwg.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || dwg.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const demoSteps = [
    {
      step: 1,
      title: '1. Client Drawing Rev 1',
      summary: 'A-103 Rev 1 received. Monolithic 2400mm single carcase design.',
    },
    {
      step: 2,
      title: '2. AI Drawing Analysis',
      summary: 'Extracts specs with AI DRAFT tag. Flags Pavilion lift clearance violation (>2200mm).',
    },
    {
      step: 3,
      title: '3. NW Production Review',
      summary: 'Foreman Ah Huat recommends splitting into 2 × 1200mm modular units with Domino pins.',
    },
    {
      step: 4,
      title: '4. NW Production Drawing',
      summary: 'Generates A-103-NW Rev 1 with shop details. Approved for Production with green stamp.',
    },
    {
      step: 5,
      title: '5. Work Item CAR-003',
      summary: 'Work Item CAR-003 registered and explicitly bound to approved drawing revision.',
    },
    {
      step: 6,
      title: '6. Workshop Assembly',
      summary: 'Cutting complete. Plywood carcase frame assembly underway at factory.',
    },
    {
      step: 7,
      title: '7. Client Rev 4 Arrives',
      summary: 'Designer issues Rev 4 reducing length to 2300mm (-100mm) for site column encasement.',
    },
    {
      step: 8,
      title: '8. Revision Impact Check',
      summary: 'High-visibility alert: ⚠️ PRODUCTION IMPACT POSSIBLE — CAR-003 is already at Assembly!',
    },
    {
      step: 9,
      title: '9. Engineering Resolution',
      summary: 'NW Directive: Trim 100mm off Module B end scribe plinth. Saves RM 4,200 scrap!',
    },
  ];

  const handleStepClick = async (stepNum: number) => {
    setIsAdvancingDemo(true);
    try {
      await runDrawingDemoWorkflowStep(stepNum);
      setSelectedDrawingId('dwg-1');
    } finally {
      setIsAdvancingDemo(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Top Banner & Governance Principle */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black uppercase tracking-wider">
              Drawing Governance Principle
            </span>
            <span className="text-xs text-slate-500 font-semibold">
              NEVER overwrite original client drawings • Explicit Lineage Tracking
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-2 tracking-tight">
            NW Drawing Intelligence & Production Method
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
            Distinguishes between <strong>Original Client / Designer Drawings</strong>, <strong>NW Workshop Reviews</strong>, and <strong>NW Production Drawings</strong>. 
            AI extracts specifications as non-binding <em>AI DRAFT</em> suggestions requiring human approval, and cross-references revisions with active factory stages to prevent costly workshop scrap.
          </p>
        </div>

        {canUpload ? (
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ Upload New Drawing</span>
          </button>
        ) : (
          <div className="text-[11px] text-slate-400 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
            Upload restricted to Owner, Admin & PM
          </div>
        )}
      </div>

      {/* Mandatory Lifecycle Flow Ribbon */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 border border-slate-800 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
              Mandatory Production Flow
            </span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              (Strict Traceability Pipeline)
            </span>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-400">Demo Scenario:</span>
            <button
              onClick={resetDrawingDemo}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg text-xs font-bold border border-slate-700 flex items-center space-x-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Demo</span>
            </button>
          </div>
        </div>

        {/* 9-Step Interactive Stepper Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-9 gap-1.5 pt-1">
          {demoSteps.map((s) => {
            const isActive = drawingDemoStep === s.step;
            const isCompleted = drawingDemoStep > s.step;
            return (
              <button
                key={s.step}
                onClick={() => handleStepClick(s.step)}
                disabled={isAdvancingDemo}
                className={`p-2 rounded-xl text-left transition-all border cursor-pointer ${
                  isActive
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-md ring-2 ring-amber-400/50'
                    : isCompleted
                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/60'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-750 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono font-bold mb-0.5">
                  <span>Step {s.step}</span>
                  {isCompleted && <span>✓</span>}
                  {isActive && <span className="animate-pulse">●</span>}
                </div>
                <div className="text-[11px] font-bold truncate">{s.title.slice(3)}</div>
              </button>
            );
          })}
        </div>

        {/* Active Step Real-time Explanation Banner */}
        <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start space-x-3 text-xs">
          <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5 font-bold font-mono">
            {drawingDemoStep}
          </div>
          <div className="flex-1">
            <span className="font-bold text-amber-400 mr-2">
              {demoSteps[drawingDemoStep - 1]?.title}:
            </span>
            <span className="text-slate-300">
              {demoSteps[drawingDemoStep - 1]?.summary}
            </span>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            {drawingDemoStep > 1 && (
              <button
                onClick={() => handleStepClick(drawingDemoStep - 1)}
                disabled={isAdvancingDemo}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700"
              >
                Prev
              </button>
            )}
            {drawingDemoStep < 9 ? (
              <button
                onClick={() => handleStepClick(drawingDemoStep + 1)}
                disabled={isAdvancingDemo}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow flex items-center space-x-1"
              >
                <span>Next Step</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="text-xs font-bold text-emerald-400 font-mono">
                WORKFLOW COMPLETED
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Drawing Search & Category Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search drawings by number or title..."
              className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="All">All Trades</option>
            <option value="Carpentry">Carpentry</option>
            <option value="Metalwork">Metalwork</option>
            <option value="Glass & Glazing">Glass & Glazing</option>
            <option value="Electrical">Electrical</option>
            <option value="General Site">General Site</option>
          </select>
        </div>

        {/* Drawing Selector Cards Strip */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1">
          {filteredDrawings.map((dwg) => {
            const isSelected = selectedDrawingId === dwg.id;
            return (
              <button
                key={dwg.id}
                onClick={() => setSelectedDrawingId(dwg.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all text-left shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-md ring-2 ring-amber-400/40'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400 shadow-2xs'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className={`font-mono text-xs font-bold ${isSelected ? 'text-slate-950' : 'text-amber-700'}`}>
                    {dwg.drawing_number}
                  </span>
                  <span className="text-[10px] opacity-75">
                    ({dwg.revisions.length} revs)
                  </span>
                </div>
                <div className="truncate max-w-[140px] font-bold text-[11px] mt-0.5">
                  {dwg.title}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Drawing Viewer */}
      {activeDrawing ? (
        <>
          <DrawingViewer drawing={activeDrawing} />
          <RevisionRegister drawing={activeDrawing} />
        </>
      ) : (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-xs text-slate-500">No matching drawings found.</p>
        </div>
      )}

      {/* Upload Drawing Modal */}
      {showUploadModal && (
        <UploadDrawingModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          onDrawingUploaded={(newId) => setSelectedDrawingId(newId)}
        />
      )}
    </div>
  );
};
