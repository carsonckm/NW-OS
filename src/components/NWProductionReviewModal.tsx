import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Drawing, KnowledgeCategory } from '../types';
import { ShieldCheck, X, BookOpen, AlertTriangle, Hammer, CheckCircle2 } from 'lucide-react';

interface NWProductionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  drawing: Drawing;
  activeRevisionCode?: string;
  onReviewSaved?: () => void;
}

export const NWProductionReviewModal: React.FC<NWProductionReviewModalProps> = ({
  isOpen,
  onClose,
  drawing,
  activeRevisionCode = 'Rev 1',
  onReviewSaved,
}) => {
  const { currentUser, addNWProductionReview } = useNW();

  const [reviewedBy, setReviewedBy] = useState(currentUser.name);
  const [reviewerRole, setReviewerRole] = useState<string>(currentUser.role);
  const [status, setStatus] = useState<'Approved' | 'Review' | 'Draft'>('Draft');
  const [reviewCategory, setReviewCategory] = useState<KnowledgeCategory>(
    (drawing.category as KnowledgeCategory) || 'Carpentry'
  );

  // Workshop Expertise Fields
  const [productionRecommendation, setProductionRecommendation] = useState('');
  const [reason, setReason] = useState('');
  const [materialRecommendation, setMaterialRecommendation] = useState('');
  const [constructionMethod, setConstructionMethod] = useState('');
  const [joiningMethod, setJoiningMethod] = useState('');
  const [hardware, setHardware] = useState('');
  const [transportConsideration, setTransportConsideration] = useState('');
  const [installationMethod, setInstallationMethod] = useState('');
  const [productionRisk, setProductionRisk] = useState('');
  const [isCompanyStandard, setIsCompanyStandard] = useState(false);
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    addNWProductionReview(drawing.id, {
      drawing_id: drawing.id,
      client_drawing_revision: activeRevisionCode,
      status,
      reviewed_by: reviewedBy,
      reviewer_role: reviewerRole,
      review_category: reviewCategory,
      production_recommendation: productionRecommendation.trim(),
      reason: reason.trim(),
      material_recommendation: materialRecommendation.trim(),
      construction_method: constructionMethod.trim(),
      joining_method: joiningMethod.trim(),
      hardware: hardware.trim(),
      transport_consideration: transportConsideration.trim(),
      installation_method: installationMethod.trim(),
      production_risk: productionRisk.trim(),
      notes: notes.trim(),
      is_company_standard: isCompanyStandard,
    });

    if (onReviewSaved) onReviewSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[11px] font-bold">
                NW PRODUCTION METHOD
              </span>
              <span className="text-xs text-slate-400">Shop-Floor Practical Engineering</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white mt-1 flex items-center space-x-2">
              <Hammer className="w-5 h-5 text-amber-400" />
              <span>Add NW Production Review & Workshop Method</span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Reviewing: <strong className="text-amber-400 font-mono">{drawing.drawing_number}</strong> ({drawing.title}) — Revision: <strong className="text-amber-400 font-mono">{activeRevisionCode}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-slate-800 max-h-[80vh] overflow-y-auto">
          {/* Reviewer Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Reviewer Name</label>
              <input
                type="text"
                value={reviewedBy}
                onChange={(e) => setReviewedBy(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Role / Trade Authority</label>
              <input
                type="text"
                value={reviewerRole}
                onChange={(e) => setReviewerRole(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Review Outcome</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="Approved">Approved with NW Method</option>
                <option value="Review">Under Technical Review</option>
                <option value="Draft">Draft Notes</option>
              </select>
            </div>
          </div>

          {/* Primary Production Recommendation & Reason */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1 flex items-center justify-between">
                <span>Production Recommendation <span className="text-red-500">*</span></span>
                <span className="text-[11px] font-normal text-slate-500">What practical change is needed?</span>
              </label>
              <textarea
                value={productionRecommendation}
                onChange={(e) => setProductionRecommendation(e.target.value)}
                rows={2}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 leading-relaxed"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1 flex items-center justify-between">
                <span>Reason / Buildability Justification <span className="text-red-500">*</span></span>
                <span className="text-[11px] font-normal text-slate-500">Why can’t it be built as originally drawn?</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 leading-relaxed"
                required
              />
            </div>
          </div>

          {/* Detailed Workshop Specifications (2-column layout) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Construction Method
              </label>
              <textarea
                value={constructionMethod}
                onChange={(e) => setConstructionMethod(e.target.value)}
                rows={2}
                placeholder="e.g. Pre-fabricated carcases with internal cable risers..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Joining Method
              </label>
              <textarea
                value={joiningMethod}
                onChange={(e) => setJoiningMethod(e.target.value)}
                rows={2}
                placeholder="e.g. Festool Domino DF 500 loose tenons + worktop bolts..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Material Recommendation
              </label>
              <textarea
                value={materialRecommendation}
                onChange={(e) => setMaterialRecommendation(e.target.value)}
                rows={2}
                placeholder="e.g. 18mm E1 Marine Plywood with Wilsonart HPL..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Hardware Specification
              </label>
              <textarea
                value={hardware}
                onChange={(e) => setHardware(e.target.value)}
                rows={2}
                placeholder="e.g. Hafele Quadro runners, Blum CLIP top hinges..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Transport & Hoist Considerations
              </label>
              <textarea
                value={transportConsideration}
                onChange={(e) => setTransportConsideration(e.target.value)}
                rows={2}
                placeholder="e.g. Max dimension 1200mm, weight under 65kg for lift..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Installation Method
              </label>
              <textarea
                value={installationMethod}
                onChange={(e) => setInstallationMethod(e.target.value)}
                rows={2}
                placeholder="e.g. Dock Module A first, laser level, bolt Module B..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Production Risk & Mitigation */}
          <div>
            <label className="block text-xs font-bold text-slate-900 mb-1 flex items-center space-x-1.5 text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Identified Production / Site Risk & Mitigation</span>
            </label>
            <textarea
              value={productionRisk}
              onChange={(e) => setProductionRisk(e.target.value)}
              rows={2}
              placeholder="e.g. Uneven floor levels: supply 10mm site scribe strip..."
              className="w-full bg-amber-50/50 border border-amber-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* NW Knowledge Base Rule Prompt */}
          <div className="p-4 bg-amber-50/70 border border-amber-300 rounded-xl space-y-2">
            <div className="flex items-start space-x-2.5">
              <input
                type="checkbox"
                id="kbSaveStandard"
                checked={isCompanyStandard}
                onChange={(e) => setIsCompanyStandard(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 bg-white"
              />
              <label htmlFor="kbSaveStandard" className="text-xs font-bold text-amber-950 cursor-pointer">
                Save this method to NW Knowledge Base as an NW Company Standard?
              </label>
            </div>
            <p className="text-[11px] text-amber-800 pl-6.5">
              When checked, this practical workshop solution is saved permanently into the company's collective knowledge database. Future estimators, PMs, and CAD detailers will automatically receive this standard whenever similar drawings or retail counter scopes are drafted.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Record NW Production Review</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
