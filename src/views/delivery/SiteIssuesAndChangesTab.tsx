import React, { useState } from 'react';
import {
  AlertTriangle,
  Ruler,
  GitPullRequest,
  CheckCircle2,
  Clock,
  Camera,
  MapPin,
  FileText,
  Plus,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { SiteMeasurementRecord, ClientChangeRequest } from '../../types';

export const SiteIssuesAndChangesTab: React.FC = () => {
  const {
    siteMeasurements,
    clientChangeRequests,
    addSiteMeasurement,
    addClientChangeRequest,
    issues,
    projects,
    workItems,
    currentUser,
  } = useNW();

  const [activeSubTab, setActiveSubTab] = useState<'measurements' | 'client-requests' | 'issues'>('measurements');

  // Form states
  const [showMeasureForm, setShowMeasureForm] = useState(false);
  const [showChangeForm, setShowChangeForm] = useState(false);

  // New Measurement state
  const [measureProjectId, setMeasureProjectId] = useState(projects[0]?.id || '');
  const [measureItemCode, setMeasureItemCode] = useState('CAR-003');
  const [measureLocation, setMeasureLocation] = useState('Demo Supermarket Cashier Zone Aisle 3');
  const [measureValue, setMeasureValue] = useState('2380');
  const [measureUnit, setMeasureUnit] = useState('mm');
  const [measureApprovedDim, setMeasureApprovedDim] = useState('2400mm');
  const [measureDrawingRef, setMeasureDrawingRef] = useState('A-103-NW Rev 1');
  const [measureNotes, setMeasureNotes] = useState('Laser meter measurement on wall opening');

  // New Client Request state
  const [changeProjectId, setChangeProjectId] = useState(projects[0]?.id || '');
  const [changeItemCode, setChangeItemCode] = useState('CAR-003');
  const [changeDrawingRev, setChangeDrawingRev] = useState('A-103 Rev 4');
  const [changeDetails, setChangeDetails] = useState('"Can you make this cabinet 100mm wider?" (Client verbally requested on site)');
  const [changeRequestedAction, setChangeRequestedAction] = useState('Widen right-hand cashier pedestal by 100mm with matching Wilsonart Oak HPL');
  const [changeRequestedBy, setChangeRequestedBy] = useState('Client Representative Mr. Tan');

  const deliveryAndSiteIssues = issues.filter(
    (i) => i.category === 'Delivery' || i.category === 'Site condition' || i.category === 'Installation'
  );

  const handleSaveMeasurement = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === measureProjectId);
    const item = workItems.find((w) => w.item_code === measureItemCode);

    addSiteMeasurement({
      project_id: measureProjectId,
      project_name: proj?.project_name || 'Demo Supermarket',
      work_item_id: item?.id || 'wi-demo-1',
      work_item_code: measureItemCode,
      location: measureLocation,
      measurement_value: measureValue,
      unit: measureUnit,
      drawing_reference: measureDrawingRef,
      approved_dimension: measureApprovedDim,
      notes: measureNotes,
      submitted_by: `${currentUser.name} (${currentUser.role})`,
    });

    setShowMeasureForm(false);
  };

  const handleSaveChangeRequest = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === changeProjectId);
    const item = workItems.find((w) => w.item_code === changeItemCode);

    addClientChangeRequest({
      project_id: changeProjectId,
      project_name: proj?.project_name || 'Demo Supermarket',
      work_item_id: item?.id || 'wi-demo-1',
      work_item_code: changeItemCode,
      current_drawing_rev: changeDrawingRev,
      request_details: changeDetails,
      requested_change: changeRequestedAction,
      requested_by: changeRequestedBy,
    });

    setShowChangeForm(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Sub-Nav */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-rose-100 text-rose-900 rounded-lg">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Site Issues, Measurements & Scope Variations
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Section 22 & 25: Laser measurement conflict detection and client change request routing to formal commercial variations.
          </p>
        </div>

        {/* Sub-nav Buttons */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
          <button
            onClick={() => setActiveSubTab('measurements')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
              activeSubTab === 'measurements' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Site Measurements ({siteMeasurements.length})
          </button>
          <button
            onClick={() => setActiveSubTab('client-requests')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
              activeSubTab === 'client-requests' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Client Scope Changes ({clientChangeRequests.length})
          </button>
          <button
            onClick={() => setActiveSubTab('issues')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
              activeSubTab === 'issues' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Delivery & Site Issues ({deliveryAndSiteIssues.length})
          </button>
        </div>
      </div>

      {/* Tab 1: Site Measurements */}
      {activeSubTab === 'measurements' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              Field Laser Measurements Log:
            </span>
            <button
              onClick={() => setShowMeasureForm(true)}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Record New Measurement</span>
            </button>
          </div>

          {/* Form Modal */}
          {showMeasureForm && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
              <form
                onSubmit={handleSaveMeasurement}
                className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-sm font-black text-slate-900">
                    Record Site Measurement (Section 22)
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowMeasureForm(false)}
                    className="text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Project</label>
                    <select
                      value={measureProjectId}
                      onChange={(e) => setMeasureProjectId(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.project_number} — {p.project_name.slice(0, 25)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Work Item Code</label>
                    <input
                      type="text"
                      value={measureItemCode}
                      onChange={(e) => setMeasureItemCode(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Measured Value</label>
                    <div className="flex">
                      <input
                        type="text"
                        value={measureValue}
                        onChange={(e) => setMeasureValue(e.target.value)}
                        placeholder="e.g. 2380"
                        className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-l-lg text-xs font-bold"
                      />
                      <span className="px-2.5 py-2 bg-slate-200 text-slate-700 text-xs font-bold rounded-r-lg border border-l-0 border-slate-200">
                        mm
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Approved Drawing Dimension</label>
                    <input
                      type="text"
                      value={measureApprovedDim}
                      onChange={(e) => setMeasureApprovedDim(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">Site Location</label>
                    <input
                      type="text"
                      value={measureLocation}
                      onChange={(e) => setMeasureLocation(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">Notes</label>
                    <textarea
                      rows={2}
                      value={measureNotes}
                      onChange={(e) => setMeasureNotes(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowMeasureForm(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold"
                  >
                    Save Measurement
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Measurements Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {siteMeasurements.map((m) => (
              <div
                key={m.id}
                className={`bg-white rounded-xl border p-4 shadow-xs space-y-3 ${
                  m.is_conflict ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-black text-slate-900">
                      {m.work_item_code}
                    </span>
                    <p className="text-xs text-slate-500 font-medium truncate">{m.project_name}</p>
                  </div>
                  {m.is_conflict ? (
                    <span className="px-2 py-0.5 text-[10px] font-black bg-amber-200 text-amber-900 rounded-md flex items-center space-x-1 animate-pulse">
                      <AlertTriangle className="w-3 h-3" />
                      <span>CONFLICT</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-900 rounded-md">
                      MATCH
                    </span>
                  )}
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Site Measurement
                    </span>
                    <span className="text-base font-black text-slate-900">
                      {m.measurement_value} {m.unit}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Approved Drawing
                    </span>
                    <span className="text-xs font-bold text-slate-700 block">
                      {m.approved_dimension}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 flex items-center space-x-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{m.location}</span>
                </div>

                {m.conflict_notes && (
                  <div className="p-2.5 bg-amber-100/70 border border-amber-300 rounded-lg text-xs text-amber-950 font-medium">
                    {m.conflict_notes}
                  </div>
                )}

                <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100 flex items-center justify-between">
                  <span>{m.submitted_by}</span>
                  <span>{new Date(m.date_time).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Client Scope Changes (Section 25) */}
      {activeSubTab === 'client-requests' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              Client Scope Change Requests (Section 25):
            </span>
            <button
              onClick={() => setShowChangeForm(true)}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Record Client Change Request</span>
            </button>
          </div>

          {/* Form Modal */}
          {showChangeForm && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
              <form
                onSubmit={handleSaveChangeRequest}
                className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-sm font-black text-slate-900">
                    Record Client Scope Change (Section 25)
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowChangeForm(false)}
                    className="text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Project</label>
                    <select
                      value={changeProjectId}
                      onChange={(e) => setChangeProjectId(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.project_number} — {p.project_name.slice(0, 25)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Work Item Code</label>
                    <input
                      type="text"
                      value={changeItemCode}
                      onChange={(e) => setChangeItemCode(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Verbatim Client Request</label>
                    <textarea
                      rows={2}
                      value={changeDetails}
                      onChange={(e) => setChangeDetails(e.target.value)}
                      placeholder='e.g. "Can you make this cabinet 100mm wider?"'
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Requested Action / Technical Scope</label>
                    <input
                      type="text"
                      value={changeRequestedAction}
                      onChange={(e) => setChangeRequestedAction(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Requested By (Client Representative)</label>
                    <input
                      type="text"
                      value={changeRequestedBy}
                      onChange={(e) => setChangeRequestedBy(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowChangeForm(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold"
                  >
                    Route to Variation Workflow
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Client Requests List */}
          <div className="space-y-3">
            {clientChangeRequests.map((req) => (
              <div
                key={req.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-black text-slate-800">
                      {req.request_code}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 rounded-md">
                      {req.status}
                    </span>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs font-bold text-slate-700">{req.work_item_code}</span>
                  </div>

                  <h4 className="text-sm font-black text-slate-900">
                    {req.request_details}
                  </h4>

                  <p className="text-xs text-slate-600">
                    <span className="font-bold">Requested Scope:</span> {req.requested_change}
                  </p>

                  <div className="text-[11px] text-slate-400">
                    Requested by {req.requested_by} on {new Date(req.requested_date).toLocaleDateString()} • Linked Variation: <span className="font-mono font-bold text-slate-700">{req.linked_variation_id}</span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center space-x-2">
                  <span className="px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-bold rounded-lg border border-slate-200">
                    Commercial Costing Pending
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Delivery & Site Issues */}
      {activeSubTab === 'issues' && (
        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-700">
            Active Site & Transit Issues ({deliveryAndSiteIssues.length}):
          </div>

          <div className="space-y-3">
            {deliveryAndSiteIssues.map((iss) => (
              <div
                key={iss.id}
                className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-900 rounded-md">
                      {iss.category}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-md">
                      {iss.severity}
                    </span>
                    <span className="text-xs font-bold text-slate-500">•</span>
                    <span className="text-xs font-bold text-slate-800">{iss.status}</span>
                  </div>
                  <h4 className="text-sm font-black text-slate-900 mt-1">{iss.title}</h4>
                  <p className="text-xs text-slate-600 mt-0.5">{iss.description}</p>
                </div>

                <div className="text-right shrink-0 text-xs text-slate-500">
                  <div>Assigned: <span className="font-bold text-slate-800">{iss.assigned_to_name}</span></div>
                  <div>Due: <span className="font-bold text-rose-700">{iss.due_date}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
