import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Drawing } from '../types';
import { FileCode, X, Layers, CheckCircle2, ShieldCheck } from 'lucide-react';

interface NWProductionDrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  drawing: Drawing;
  activeRevisionCode?: string;
  onSaved?: () => void;
}

export const NWProductionDrawingModal: React.FC<NWProductionDrawingModalProps> = ({
  isOpen,
  onClose,
  drawing,
  activeRevisionCode = 'Rev 1',
  onSaved,
}) => {
  const { currentUser, createNWProductionDrawing } = useNW();

  const [drawingNumber, setDrawingNumber] = useState(`${drawing.drawing_number}-NW`);
  const [revision, setRevision] = useState('Rev 1');
  const [title, setTitle] = useState(`NW Production Drawing — ${drawing.title} (Modular 2-Carcase Build)`);
  const [revisedDimensions, setRevisedDimensions] = useState('2400 × 900 × 1050mm (Split 2 × 1200mm Modules)');
  const [constructionDetails, setConstructionDetails] = useState(
    'Split carcass into Module A (1200mm Cashier & sub-DB) and Module B (1200mm Bagging & Wrap cavity). Dual side gable panels with concealed Domino dowels.'
  );
  const [materialDetails, setMaterialDetails] = useState(
    '18mm E1 Marine Plywood core; Wilsonart Natural Oak HPL external face; 12mm Dupont Corian Glacier White solid surface seamless bonded countertop.'
  );
  const [hardwareDetails, setHardwareDetails] = useState(
    'Hafele Quadro soft-close full-extension drawer runners; Blum CLIP top 110-degree hinges; 4 × M6 connecting bolts.'
  );
  const [joiningMethod, setJoiningMethod] = useState(
    'Concealed Festool Domino DF 500 beechwood loose tenons with internal lock bolts.'
  );
  const [assemblyInstructions, setAssemblyInstructions] = useState(
    '1. Pre-route cable conduits prior to carcass pressing. 2. Edgeband all exposed gables with 2mm matching PVC. 3. Pre-assemble drawers and test fit runners at factory.'
  );
  const [installationInstructions, setInstallationInstructions] = useState(
    '1. Hoist modules individually via Pavilion Service Lift. 2. Position Module A and align laser level with floor benchmark. 3. Dock Module B, engage Domino pins, tighten M6 connector bolts. 4. Bond Corian top on site.'
  );
  const [productionNotes, setProductionNotes] = useState(
    'Approved by Master Joiner Ah Huat for workshop execution. Exceeds standard structural load criteria.'
  );

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    createNWProductionDrawing(drawing.id, {
      drawing_number: drawingNumber.trim(),
      revision: revision.trim(),
      title: title.trim(),
      linked_client_drawing_id: drawing.id,
      linked_client_revision: activeRevisionCode,
      status: 'Internal Review',
      approved_for_production: false,
      revised_dimensions: revisedDimensions.trim(),
      construction_details: constructionDetails.trim(),
      material_details: materialDetails.trim(),
      hardware_details: hardwareDetails.trim(),
      joining_method: joiningMethod.trim(),
      assembly_instructions: assemblyInstructions.trim(),
      installation_instructions: installationInstructions.trim(),
      production_notes: productionNotes.trim(),
      file_url: `/drawings/${drawingNumber}_${revision}.svg`,
      uploaded_by: currentUser.name,
    });

    if (onSaved) onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">
                NW SHOP DRAWING ENGINE
              </span>
              <span className="text-xs text-slate-400">Shop Floor Build & Fabrication Release</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white mt-1 flex items-center space-x-2">
              <FileCode className="w-5 h-5 text-amber-400" />
              <span>Create NW Production Drawing</span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Derived from Client Drawing: <strong className="text-amber-400 font-mono">{drawing.drawing_number}</strong> ({activeRevisionCode})
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">NW Drawing Number</label>
              <input
                type="text"
                value={drawingNumber}
                onChange={(e) => setDrawingNumber(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">NW Revision</label>
              <input
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Linked Client Rev</label>
              <input
                type="text"
                value={activeRevisionCode}
                disabled
                className="w-full bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-600 cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Production Drawing Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-900 mb-1">
              Revised Dimensions for Buildability & Transport
            </label>
            <input
              type="text"
              value={revisedDimensions}
              onChange={(e) => setRevisedDimensions(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold font-mono text-emerald-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Construction Details</label>
              <textarea
                value={constructionDetails}
                onChange={(e) => setConstructionDetails(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Joining & Connection Details</label>
              <textarea
                value={joiningMethod}
                onChange={(e) => setJoiningMethod(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Materials Specification</label>
              <textarea
                value={materialDetails}
                onChange={(e) => setMaterialDetails(e.target.value)}
                rows={2}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Hardware Specification</label>
              <textarea
                value={hardwareDetails}
                onChange={(e) => setHardwareDetails(e.target.value)}
                rows={2}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Shop Assembly Instructions</label>
              <textarea
                value={assemblyInstructions}
                onChange={(e) => setAssemblyInstructions(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Site Installation Instructions</label>
              <textarea
                value={installationInstructions}
                onChange={(e) => setInstallationInstructions(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Production Notes & Tolerances</label>
            <textarea
              value={productionNotes}
              onChange={(e) => setProductionNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

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
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Create NW Production Drawing</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
