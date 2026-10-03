import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { DrawingType, KnowledgeCategory } from '../types';
import { Upload, X, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

interface UploadDrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDrawingUploaded?: (drawingId: string) => void;
}

export const UploadDrawingModal: React.FC<UploadDrawingModalProps> = ({
  isOpen,
  onClose,
  onDrawingUploaded,
}) => {
  const { currentUser, selectedProjectId, projects, uploadDrawing } = useNW();

  const [drawingNumber, setDrawingNumber] = useState('A-105');
  const [title, setTitle] = useState('Timber Wall Cladding & Concealed Door Details');
  const [category, setCategory] = useState<KnowledgeCategory>('Carpentry');
  const [drawingType, setDrawingType] = useState<DrawingType>('Client / Designer Drawing');
  const [revision, setRevision] = useState('Rev 1');
  const [projectId, setProjectId] = useState(selectedProjectId || projects[0]?.id || 'proj-1');
  const [notes, setNotes] = useState('Initial architectural detail issued for contractor review and shop drawing preparation.');
  const [fileName, setFileName] = useState('A-105_Rev1_Wall_Cladding.pdf');
  const [fileSize, setFileSize] = useState('4.2 MB');
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const created = uploadDrawing({
        drawing_number: drawingNumber.trim(),
        title: title.trim(),
        category,
        drawing_type: drawingType,
        revision: revision.trim() || 'Rev 1',
        project_id: projectId,
        file_url: `/drawings/${drawingNumber}_${revision}.pdf`,
        notes: notes.trim(),
      });

      if (onDrawingUploaded) {
        onDrawingUploaded(created.id);
      }
      onClose();
    } catch (err) {
      console.error('Failed to upload drawing:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const samplePresets = [
    {
      num: 'A-104',
      title: 'Perimeter Display Shelving Units with Integrated LED Grooves',
      cat: 'Carpentry' as KnowledgeCategory,
      type: 'Client / Designer Drawing' as DrawingType,
      rev: 'Rev 1',
      notes: 'Standard 4-tier retail display shelving. Height 2100mm, depth 400mm.',
      file: 'A-104_Rev1_Display_Shelving.pdf',
    },
    {
      num: 'SM-002',
      title: 'Pavilion Level 2 Service Hoist & Corridors Site Measurement',
      cat: 'General Site' as KnowledgeCategory,
      type: 'Site Measurement' as DrawingType,
      rev: 'Rev 1',
      notes: 'Laser survey measurements of corridor corners, service lift dimensions (2200mm max).',
      file: 'SM-002_Site_Measurement_Survey.pdf',
    },
    {
      num: 'MET-01',
      title: 'Entrance Portal Brass Cladding & Steel Sub-Frame',
      cat: 'Metalwork' as KnowledgeCategory,
      type: 'Client / Designer Drawing' as DrawingType,
      rev: 'Rev 1',
      notes: 'Custom hairline finish brass portal framing with 50x50mm RHS steel skeleton.',
      file: 'MET-01_Rev1_Brass_Portal.pdf',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[11px] font-bold">
                NW DRAWING GOVERNANCE
              </span>
              <span className="text-xs text-slate-400">Strict Immutable Revision Audit</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white mt-1 flex items-center space-x-2">
              <Upload className="w-5 h-5 text-amber-400" />
              <span>Upload New Project Drawing</span>
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-slate-800">
          {/* Quick Presets for Demo / Testing */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Quick Test Presets:
            </span>
            <div className="flex flex-wrap gap-2">
              {samplePresets.map((preset) => (
                <button
                  key={preset.num}
                  type="button"
                  onClick={() => {
                    setDrawingNumber(preset.num);
                    setTitle(preset.title);
                    setCategory(preset.cat);
                    setDrawingType(preset.type);
                    setRevision(preset.rev);
                    setNotes(preset.notes);
                    setFileName(preset.file);
                  }}
                  className="px-2.5 py-1 bg-white hover:bg-amber-50 border border-slate-300 hover:border-amber-400 rounded-lg text-xs font-medium text-slate-700 transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <span className="font-mono font-bold text-amber-700">{preset.num}</span>
                  <span className="truncate max-w-[150px]">{preset.title}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Drawing Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={drawingNumber}
                onChange={(e) => setDrawingNumber(e.target.value)}
                placeholder="e.g. A-103"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Initial Revision <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="Rev 1"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Category / Trade <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="Carpentry">Carpentry</option>
                <option value="Metalwork">Metalwork</option>
                <option value="Glass & Glazing">Glass & Glazing</option>
                <option value="Electrical">Electrical</option>
                <option value="Plumbing">Plumbing</option>
                <option value="HVAC">HVAC</option>
                <option value="Wet Works / Masonry">Wet Works / Masonry</option>
                <option value="Flooring">Flooring</option>
                <option value="Painting / Finishes">Painting / Finishes</option>
                <option value="Signage">Signage</option>
                <option value="General Site">General Site</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Drawing Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Checkout Counter Detailed Joinery Plan"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Drawing Classification Type <span className="text-red-500">*</span>
              </label>
              <select
                value={drawingType}
                onChange={(e) => setDrawingType(e.target.value as DrawingType)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="Client / Designer Drawing">Client / Designer Drawing (Original)</option>
                <option value="Site Measurement">Site Measurement (As-Built Survey)</option>
                <option value="NW Production Drawing">NW Production Drawing (Fabrication)</option>
                <option value="NW Installation Drawing">NW Installation Drawing (Site Guide)</option>
                <option value="Other">Other Document</option>
              </select>
            </div>
          </div>

          {/* Drag & Drop File Zone */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Drawing Document File (PDF, DWG/DXF, JPG, PNG) <span className="text-red-500">*</span>
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  const f = e.dataTransfer.files[0];
                  setFileName(f.name);
                  setFileSize(`${(f.size / (1024 * 1024)).toFixed(1)} MB`);
                }
              }}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-all ${
                isDragging
                  ? 'border-amber-500 bg-amber-50/50'
                  : 'border-slate-300 bg-slate-50 hover:bg-slate-100/60'
              }`}
            >
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800">
                    {fileName || 'Drop drawing PDF or CAD image here, or click to browse'}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {fileName ? `Attached File: ${fileName} (${fileSize})` : 'Supports PDF, JPG, PNG, SVG, CAD exports up to 50MB'}
                  </p>
                </div>
                <input
                  type="file"
                  id="drawingFileInput"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.svg,.dwg,.dxf"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      const f = e.target.files[0];
                      setFileName(f.name);
                      setFileSize(`${(f.size / (1024 * 1024)).toFixed(1)} MB`);
                    }
                  }}
                />
                <label
                  htmlFor="drawingFileInput"
                  className="px-3 py-1 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-2xs"
                >
                  Browse Computer
                </label>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Revision Notes & Scope Description
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Issued for tender review. Notes indicate solid surface countertop and plywood carcass."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Governance Notice */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-2 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Governance Rule:</strong> Original client drawings are locked and never overwritten. When new revisions are uploaded, the previous revision becomes <em>Superseded</em> while preserving complete historical audit trails.
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <span className="text-[11px] text-slate-500">
              Uploaded by: <strong>{currentUser.name}</strong> ({currentUser.role})
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !drawingNumber.trim() || !title.trim()}
                className="px-5 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Upload & Register Drawing</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
