/**
 * NW OS — Client Detail View
 * Comprehensive client profile with contact info, billing address, associated projects, documents, and audit history.
 */

import React, { useState } from 'react';
import { RecordFiles } from './RecordFiles';
import { useNW } from '../context/NWContext';
import { Client, Project } from '../types';
import {
  ArrowLeft,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  DollarSign,
  FileText,
  Clock,
  Edit,
  Plus,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  FolderPlus,
  AlertCircle,
  ExternalLink,
  Download,
  X,
} from 'lucide-react';

interface ClientDetailViewProps {
  client: Client;
  onBack: () => void;
  onEditClient: (client: Client) => void;
  onNewProject: (clientId: string) => void;
  onNavigateToWorkItems?: (projectId: string) => void;
}

export const ClientDetailView: React.FC<ClientDetailViewProps> = ({
  client,
  onBack,
  onEditClient,
  onNewProject,
  onNavigateToWorkItems,
}) => {
  const { projects, documents, auditLogs, setSelectedProjectId } = useNW();
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'documents' | 'activity'>('overview');
  // Projects belonging to this client
  const clientProjects = projects.filter((p) => p.client_id === client.id);
  const clientDocuments = documents.filter((d) => clientProjects.some((p) => p.id === d.project_id));
  const totalContractValue = clientProjects.reduce((sum, p) => sum + (p.contract_value || 0), 0);

  // Client-related audit logs
  const clientLogs = auditLogs.filter(
    (log) =>
      log.object_id === client.id ||
      clientProjects.some((p) => p.id === log.object_id) ||
      (log.new_value && log.new_value.toLowerCase().includes(client.company_name.toLowerCase()))
  );

  const isIndividual = client.client_type === 'Individual / Homeowner';

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800 animate-in fade-in duration-200">
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 text-xs font-bold text-slate-600 hover:text-amber-700 bg-white hover:bg-amber-50 px-3 py-1.5 rounded-xl border border-slate-200 transition-colors w-fit cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Client List</span>
        </button>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={() => onEditClient(client)}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
          >
            <Edit className="w-3.5 h-3.5 text-slate-500" />
            <span>Edit Client</span>
          </button>

          <button
            onClick={() => onNewProject(client.id)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Project</span>
          </button>
        </div>
      </div>

      {/* Client Hero Profile Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 border border-amber-300 flex items-center justify-center text-amber-800 shrink-0 shadow-xs">
              {isIndividual ? (
                <User className="w-7 h-7 text-amber-700" />
              ) : (
                <Building2 className="w-7 h-7 text-amber-700" />
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  {client.company_name}
                </h1>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    isIndividual
                      ? 'bg-purple-50 text-purple-700 border-purple-200'
                      : 'bg-amber-50 text-amber-800 border-amber-300'
                  }`}
                >
                  {client.client_type}
                </span>
              </div>

              {client.registration_number && (
                <div className="text-xs text-slate-500 mt-1 font-mono">
                  <span className="font-semibold text-slate-700">
                    {isIndividual ? 'NRIC / Passport:' : 'SSM Reg No:'}
                  </span>{' '}
                  {client.registration_number}
                </div>
              )}

              <p className="text-xs text-slate-500 mt-1">
                Client ID:{' '}
                <span className="font-mono text-slate-600">{client.id}</span> • Registered on{' '}
                {new Date(client.created_at).toLocaleDateString('en-MY', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-2.5 text-right">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                Associated Projects
              </span>
              <span className="text-xl font-black text-slate-900 font-mono">
                {clientProjects.length}
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-2.5 text-right">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                Total Portfolio Value
              </span>
              <span className="text-xl font-black text-emerald-600 font-mono">
                RM {(totalContractValue / 1000).toFixed(0)}k
              </span>
            </div>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div className="flex border-b border-slate-200 mt-6 -mb-2 space-x-6">
          {[
            { id: 'overview' as const, label: 'Client Information' },
            { id: 'projects' as const, label: `Projects (${clientProjects.length})` },
            { id: 'documents' as const, label: `Documents (${clientDocuments.length})` },
            { id: 'activity' as const, label: `Activity History (${clientLogs.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-amber-500 text-amber-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT: Overview (Contact & Billing) */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Contact Information Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <User className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Primary Contact Person</h3>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Designated Liaison</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">
                  Contact Name
                </span>
                <span className="text-slate-900 font-bold text-sm">{client.contact_person}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <div className="flex items-center space-x-1.5 text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>Phone / Mobile</span>
                  </div>
                  <a
                    href={`tel:${client.phone}`}
                    className="text-amber-700 hover:text-amber-800 font-mono font-bold hover:underline"
                  >
                    {client.phone}
                  </a>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <div className="flex items-center space-x-1.5 text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">
                    <Mail className="w-3 h-3 text-slate-400" />
                    <span>Email Address</span>
                  </div>
                  {client.email ? (
                    <a
                      href={`mailto:${client.email}`}
                      className="text-amber-700 hover:text-amber-800 font-medium hover:underline truncate block"
                    >
                      {client.email}
                    </a>
                  ) : (
                    <span className="text-slate-400 italic">No email provided</span>
                  )}
                </div>
              </div>
            </div>

            {/* Notes Section */}
            {client.notes && (
              <div className="pt-2">
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block mb-1">
                  Client Notes & Preferences
                </span>
                <div className="p-3 bg-amber-50/50 border border-amber-200/70 rounded-xl text-xs text-slate-700 leading-relaxed">
                  {client.notes}
                </div>
              </div>
            )}
          </div>

          {/* Billing Address Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Official Billing Address</h3>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Head Office / Residence</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-slate-800 leading-relaxed">
                {client.billing_address ? (
                  client.billing_address
                ) : (
                  <span className="text-slate-400 italic">No billing address on file.</span>
                )}
              </div>

              {/* Architectural Clarity Note */}
              <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900 space-y-1">
                <div className="font-bold flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>Separation of Billing & Site Addresses</span>
                </div>
                <p className="text-[11px] text-sky-800 leading-relaxed">
                  Per NW OS architecture, the client's official billing address is kept distinct from project site addresses. When {client.company_name} commissions new projects (e.g. at shopping malls or office towers), each project retains its own distinct site delivery and induction address.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Projects */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Projects for {client.company_name} ({clientProjects.length})
              </h3>
              <p className="text-xs text-slate-500">
                Multiple commercial and bespoke projects managed under this client account.
              </p>
            </div>
            <button
              onClick={() => onNewProject(client.id)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ New Project</span>
            </button>
          </div>

          {clientProjects.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">No Projects Created Yet</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {client.company_name} does not have any active or completed projects. Click below to initiate their first project.
                </p>
              </div>
              <button
                onClick={() => onNewProject(client.id)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>+ Create First Project</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {clientProjects.map((proj) => (
                <div
                  key={proj.id}
                  className="bg-white border border-slate-200 hover:border-amber-300 hover:shadow-md rounded-2xl p-5 transition-all space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        {proj.project_number}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 mt-1.5 line-clamp-1">
                        {proj.project_name}
                      </h4>
                      <div className="text-[11px] text-slate-500 flex items-center space-x-1 mt-1">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="line-clamp-1">{proj.site_address}</span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase shrink-0 ${
                        proj.project_status === 'Active'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {proj.project_status}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500 font-medium">Physical Progress</span>
                      <span className="text-slate-900 font-mono font-bold">{proj.progress_percent}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          proj.is_at_risk ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${proj.progress_percent}%` }}
                      />
                    </div>
                  </div>

                  {/* Financial and Schedule details */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">
                        Contract Value
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        RM {(proj.contract_value / 1000).toFixed(0)}k
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">
                        Target Handover
                      </span>
                      <span className="font-mono text-slate-700">{proj.end_date}</span>
                    </div>
                  </div>

                  {/* Button to jump into operations */}
                  <button
                    onClick={() => {
                      setSelectedProjectId(proj.id);
                      if (onNavigateToWorkItems) {
                        onNavigateToWorkItems(proj.id);
                      }
                    }}
                    className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                  >
                    <span>Inspect Production & Work Packages</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold">Client project documents</h3>
          <p className="text-xs text-slate-500">Only registered documents from this client's projects are listed. Attach files to a project document from its project workspace.</p>
          {clientDocuments.length === 0 && <p className="text-sm text-slate-500">No documents recorded for this client.</p>}
          {clientDocuments.map((doc) => (
            <article key={doc.id} className="border-t pt-3">
              <h4 className="text-sm font-semibold">{doc.title}</h4>
              <p className="text-xs text-slate-500">{doc.document_type} · {doc.status} · {doc.uploaded_at}</p>
              <RecordFiles collection="documents" recordId={doc.id} canUpload={false} />
            </article>
          ))}
        </section>
      )}

      {/* TAB CONTENT: Activity History */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Activity History & Audit Trail</h3>
            <p className="text-xs text-slate-500">
              Immutable log of client registrations, contract updates, and project interactions.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            {clientLogs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No recent activity logs recorded for this client.
              </div>
            ) : (
              <div className="relative pl-6 border-l-2 border-slate-200 space-y-6">
                {clientLogs.map((log) => (
                  <div key={log.id} className="relative group">
                    <div className="absolute -left-[31px] top-0.5 w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-2xs" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-slate-900">{log.action}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleString('en-MY')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Performed by <strong className="text-slate-800">{log.user_name}</strong> ({log.user_role})
                      </p>
                      {log.new_value && (
                        <p className="text-[11px] text-slate-500 mt-1 font-mono bg-slate-50 p-2 rounded-lg border border-slate-200/80 inline-block">
                          Details: {log.new_value}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
