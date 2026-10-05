/**
 * NW OS Knowledge Base & Standard Operating Procedures (SOP)
 * Documents construction tolerances, carpentry engineering standards, and company governance rules.
 */

import React, { useState } from 'react';
import {
  BookOpen,
  Ruler,
  ShieldAlert,
  Layers,
  Sparkles,
  CheckCircle2,
  FileText,
  HelpCircle,
  Truck,
} from 'lucide-react';
import { KnowledgeArticles } from './knowledge/KnowledgeArticles';
import { RecurringProblems } from '../components/RecurringProblems';

export const KnowledgeBaseView: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>('standards');

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold uppercase tracking-widest">
              Standard Operating Procedures
            </span>
            <span className="text-xs text-slate-400">Malaysian Construction & Joinery</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            NW Knowledge Base & Governance Rules
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Standard guidelines for tolerances, drawing revisions, subcontracting, and exception handling.
          </p>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex space-x-2 overflow-x-auto pb-1">
        {[
          { id: 'standards', label: 'Knowledge & Recurring Problems' },
          { id: 'tolerances', label: 'Tolerances & Quality' },
          { id: 'drawings', label: 'Drawing Revisions Policy' },
          { id: 'carpentry', label: 'Carpentry & Joinery Splitting' },
          { id: 'exceptions', label: 'Manage By Exception' },
          { id: 'ai-guardrails', label: 'AI Guardrails & Limits' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
              activeCategory === cat.id
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        {activeCategory === 'tolerances' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-amber-400">
              <Ruler className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">Dimensional Tolerances (CIDB & NW Standards)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <h4 className="font-bold text-amber-300">Factory Joinery & Cabinetry</h4>
                <p className="text-slate-300">
                  Maximum permissible variance: <strong>±1.0 mm</strong> across carcass dimensions. 
                  Gaps between modular cabinet doors must maintain uniform <strong>2.5 mm – 3.0 mm</strong> reveal with Blum/Salice soft-close hinges.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <h4 className="font-bold text-amber-300">Site As-Built & Laser Survey</h4>
                <p className="text-slate-300">
                  Drywall/masonry opening tolerance: <strong>±5.0 mm</strong>. 
                  Always allocate a minimum <strong>20 mm – 50 mm scribing / filler plinth</strong> on end panels to accommodate unplumb site walls before fabricating fixed joinery.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'drawings' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-amber-400">
              <Layers className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">Drawing Revisions & Audit Trail</h3>
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2 text-slate-300">
              <p className="font-bold text-red-400">
                Golden Rule: NEVER OVERWRITE THE ORIGINAL CLIENT / DESIGNER DRAWING.
              </p>
              <p>
                1. <strong>Client / Designer Drawing (Design Intent):</strong> Stored as baseline reference. Any designer update increments Client Rev (e.g. CD-01, CD-02).
              </p>
              <p>
                2. <strong>NW Production Shop Drawing (Build Reality):</strong> Contains exact CNC cutlists, joint details, sub-assembly modules, and site adjustments. Labeled explicitly as "NW Production Drawing".
              </p>
              <p>
                3. <strong>Immutable Revisions:</strong> Every revision change creates a new immutable record with timestamp, author, delta markup, and contractor distribution log.
              </p>
            </div>
          </div>
        )}

        {activeCategory === 'carpentry' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-amber-400">
              <Layers className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">Carpentry Modular Splitting Standards</h3>
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2 text-slate-300">
              <p>
                To pass standard Malaysian commercial mall freight elevators (such as Pavilion KL Service Hoist: max 2.2m height, 1.8m depth, 1500kg limit), any joinery piece longer than <strong>2100 mm</strong> must be engineered into modular split sections (e.g., Module A + Module B).
              </p>
              <p>
                Provide concealed mechanical connectors (e.g., Lamello Clamex / Hafele Minifix) and a joint plinth reveal to ensure rapid seamless site assembly.
              </p>
            </div>
          </div>
        )}

        {activeCategory === 'exceptions' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">Management By Exception Principles</h3>
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-3 text-slate-300">
              <p>
                The owner should manage by exception, not by constantly coordinating people.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="font-bold text-emerald-400 block">Automated / Delegated to PM & Site:</span>
                  <ul className="list-disc pl-4 space-y-1 mt-1 text-slate-400">
                    <li>Routine QC pass/fail inspections</li>
                    <li>Delivery scheduling and lorry booking</li>
                    <li>Site receiving confirmation</li>
                    <li>Contractor status progress updates</li>
                  </ul>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="font-bold text-red-400 block">Escalated to Owner (Dato’ Nicholas):</span>
                  <ul className="list-disc pl-4 space-y-1 mt-1 text-slate-400">
                    <li>Site discrepancies impacting client aesthetic</li>
                    <li>Cost variations &gt; RM 500</li>
                    <li>Schedule delays &gt; 2 calendar days</li>
                    <li>Contractual disputes or safety infractions</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'standards' && (
          <div className="space-y-4">
            <RecurringProblems />
            <KnowledgeArticles />
          </div>
        )}

        {activeCategory === 'ai-guardrails' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-amber-400">
              <Sparkles className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">AI Safety & Guardrail Architecture</h3>
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2 text-slate-300">
              <p className="text-amber-300 font-semibold">
                Strict Boundaries Enforced by NW OS Server:
              </p>
              <ul className="list-disc pl-4 space-y-1.5 text-slate-400">
                <li>AI must NOT independently change approved dimensions.</li>
                <li>AI must NOT approve drawings or markups without human PM signature.</li>
                <li>AI must NOT approve variations or commit company financial liability.</li>
                <li>AI will refuse to guess dimensions or completion dates if unconfirmed.</li>
                <li>AI enforces strict role boundary: Contractor cannot view client margins; Client cannot view contractor buy rates.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
