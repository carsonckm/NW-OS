import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { DrawingType, KnowledgeCategory } from '../types';
import { Upload, X, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { FILE_ACCEPT, filesAvailable, uploadFile } from '../services/files';

interface UploadDrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDrawingUploaded?: (drawingId: string) => void;
  /** The project the drawing belongs to; defaults to the project selected in the app. */
  projectId?: string;
}

export const UploadDrawingModal: React.FC<UploadDrawingModalProps> = ({
  isOpen,
  onClose,
  onDrawingUploaded,
  projectId: projectIdProp,
}) => {
  const { currentUser, selectedProjectId, userProjects, uploadDrawing, authMode } = useNW();

  // Every field starts empty: nothing is registered with values the user did not enter.
  const [drawingNumber, setDrawingNumber] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory | ''>('');
  const [drawingType, setDrawingType] = useState<DrawingType | ''>('');
  const [revision, setRevision] = useState('');
  // The target project: only one this user can see (in database mode, a PostgreSQL project).
  // There is no fallback: without a valid project, nothing can be uploaded.
  const [projectId, setProjectId] = useState(projectIdProp ?? selectedProjectId ?? '');
  const [notes, setNotes] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  // The chosen file; in database mode its bytes are stored on the server (private, per project).
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const targetProject = userProjects.find((p) => p.id === projectId);
  const missing = [
    !targetProject && 'project',
    !drawingNumber.trim() && 'drawing number',
    !revision.trim() && 'revision',
    !category && 'category',
    !title.trim() && 'title',
    !drawingType && 'classification type',
  ].filter(Boolean) as string[];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!targetProject || !category || !drawingType || missing.length) {
      setError(`Fill in: ${missing.join(', ')}`);
      return;
    }
    setIsSubmitting(true);

    try {
      // Database mode: the drawing file itself is uploaded first; the revision refers to it.
      // Demo mode (no server database) keeps the illustrative path.
      let fileUrl = `/drawings/${drawingNumber}_${revision}.pdf`;
      if (await filesAvailable()) {
        if (!file) throw new Error('Choose the drawing file to upload');
        fileUrl = (await uploadFile(file, { purpose: 'drawing', projectId: targetProject.id })).url;
      }
      const created = uploadDrawing({
        drawing_number: drawingNumber.trim(),
        title: title.trim(),
        category,
        drawing_type: drawingType,
        revision: revision.trim(),
        project_id: targetProject.id,
        file_url: fileUrl,
        notes: notes.trim(),
      });

      if (onDrawingUploaded) {
        onDrawingUploaded(created.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The drawing could not be uploaded');
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
          {/* Target project: shown, and chosen deliberately */}
          <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
            <label htmlFor="uploadDrawingProject" className="block text-xs font-bold text-slate-700 mb-1">
              Target project <span className="text-red-500">*</span>
            </label>
            <select
              id="uploadDrawingProject"
              value={targetProject ? targetProject.id : ''}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              required
            >
              <option value="">Select the project this drawing belongs to</option>
              {userProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name} ({p.project_number})
                </option>
              ))}
            </select>
            <p className="text-[11px] mt-1 text-slate-600" data-testid="upload-target-project">
              {targetProject
                ? <>This drawing will be registered on <strong>{targetProject.project_name}</strong> ({targetProject.project_number}).</>
                : 'No project selected: choose the project before uploading.'}
            </p>
          </div>

          {/* Quick Presets: demo mode only (no server database), never on real records */}
          {!authMode && (
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
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="uploadDrawingNumber" className="block text-xs font-bold text-slate-700 mb-1">
                Drawing Number <span className="text-red-500">*</span>
              </label>
              <input
                id="uploadDrawingNumber"
                type="text"
                value={drawingNumber}
                onChange={(e) => setDrawingNumber(e.target.value)}
                placeholder="e.g. A-103"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label htmlFor="uploadDrawingRevision" className="block text-xs font-bold text-slate-700 mb-1">
                Initial Revision <span className="text-red-500">*</span>
              </label>
              <input
                id="uploadDrawingRevision"
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="e.g. Rev 0"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label htmlFor="uploadDrawingCategory" className="block text-xs font-bold text-slate-700 mb-1">
                Category / Trade <span className="text-red-500">*</span>
              </label>
              <select
                id="uploadDrawingCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeCategory | '')}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              >
                <option value="">Select…</option>
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
              <label htmlFor="uploadDrawingTitle" className="block text-xs font-bold text-slate-700 mb-1">
                Drawing Title <span className="text-red-500">*</span>
              </label>
              <input
                id="uploadDrawingTitle"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Checkout Counter Detailed Joinery Plan"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label htmlFor="uploadDrawingType" className="block text-xs font-bold text-slate-700 mb-1">
                Drawing Classification Type <span className="text-red-500">*</span>
              </label>
              <select
                id="uploadDrawingType"
                value={drawingType}
                onChange={(e) => setDrawingType(e.target.value as DrawingType | '')}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              >
                <option value="">Select…</option>
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
                  setFile(f);
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
                    {fileName ? `Attached File: ${fileName} (${fileSize})` : 'PDF, JPG, PNG, DWG or DXF, up to 25 MB'}
                  </p>
                </div>
                <input
                  type="file"
                  id="drawingFileInput"
                  className="hidden"
                  accept={FILE_ACCEPT.drawing}
                  aria-label="Drawing file"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      const f = e.target.files[0];
                      setFile(f);
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

          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              {error}
            </div>
          )}

          {/* Governance Notice */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-2 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Governance Rule:</strong> Original client drawings are locked and never overwritten. When new revisions are uploaded, the previous revision becomes <em>Superseded</em> while preserving complete historical audit trails.
            </div>
          </div>

          {missing.length > 0 && (
            <p data-testid="upload-missing" className="text-[11px] text-slate-500">
              Still needed before upload: {missing.join(', ')}.
            </p>
          )}

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
                disabled={isSubmitting || missing.length > 0}
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
