/**
 * NW OS QC Inspection Modal
 * Enforces quality gates before delivery authorization.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import { CheckCircle2, XCircle, AlertCircle, X, Camera, ShieldCheck } from 'lucide-react';

interface QCModalProps {
  isOpen: boolean;
  onClose: () => void;
  workItem: WorkItem;
}

export const QCModal: React.FC<QCModalProps> = ({ isOpen, onClose, workItem }) => {
  const { currentUser, submitQCInspection } = useNW();

  const [result, setResult] = useState<'Passed' | 'Failed' | 'Correction Required'>('Passed');
  const [comments, setComments] = useState('');
  const [correction, setCorrection] = useState('');
  const [samplePhotos] = useState<string[]>([
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&auto=format&fit=crop&q=80',
  ]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQCInspection(
      workItem.id,
      result,
      comments.trim() || (result === 'Passed' ? 'Factory inspection passed all tolerance tests.' : 'Defect noted.'),
      samplePhotos,
      result !== 'Passed' ? correction.trim() : undefined
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-5 sm:p-6 text-slate-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Quality Control (QC) Gate</h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Item: <span className="text-amber-700 font-mono font-bold">{workItem.item_code}</span> — {workItem.description}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Work item summary card */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
            <div className="flex justify-between text-slate-700">
              <span>Drawing: <strong className="text-slate-900 font-mono">{workItem.drawing_revision}</strong></span>
              <span>Dimensions: <strong className="text-slate-900">{workItem.dimensions}</strong></span>
            </div>
            <div className="text-slate-600">
              Materials: <span className="text-slate-800 font-medium">{workItem.material}</span>
            </div>
          </div>

          {/* Decision Buttons */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Inspection Result</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setResult('Passed')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1 transition-colors cursor-pointer ${
                  result === 'Passed'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Pass & Release</span>
              </button>

              <button
                type="button"
                onClick={() => setResult('Correction Required')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1 transition-colors cursor-pointer ${
                  result === 'Correction Required'
                    ? 'bg-amber-50 border-amber-500 text-amber-900 ring-2 ring-amber-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Correction Req.</span>
              </button>

              <button
                type="button"
                onClick={() => setResult('Failed')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1 transition-colors cursor-pointer ${
                  result === 'Failed'
                    ? 'bg-rose-50 border-rose-500 text-rose-800 ring-2 ring-rose-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <XCircle className="w-4 h-4 text-rose-600" />
                <span>Reject & Redo</span>
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Inspector Comments & Measurements Verified
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={2}
              placeholder="e.g. Dimensions verified with tape. Edges flush. Hinges operate smoothly..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
              required
            />
          </div>

          {/* Correction field if failed */}
          {result !== 'Passed' && (
            <div>
              <label className="block text-xs font-bold text-rose-700 mb-1">
                Correction Required for Contractor:
              </label>
              <input
                type="text"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder="e.g. Re-press edge band on lower plinth / touch-up clear coat"
                className="w-full bg-slate-50 border border-rose-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:bg-white"
                required
              />
            </div>
          )}

          {/* Inspection Note */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600">
            {result === 'Passed' ? (
              <span className="text-emerald-700 font-medium">
                ✓ Once approved, status changes to <strong>QC Passed</strong> and the contractor is automatically notified to enter delivery date & time. (System will NOT automatically dispatch without contractor confirmation).
              </span>
            ) : (
              <span className="text-amber-800 font-medium">
                ⚠️ Contractor will receive an urgent task to rectify this defect before another inspection can be requested.
              </span>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs cursor-pointer"
            >
              Submit Inspection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
