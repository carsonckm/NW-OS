/**
 * NW OS — Client Management Module
 * Comprehensive Client List Screen & Client Detail orchestration.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Client, Project } from '../types';
import { ClientFormModal } from '../components/ClientFormModal';
import { ClientDetailView } from '../components/ClientDetailView';
import { NewProjectModal } from '../components/NewProjectModal';
import {
  Building2,
  User,
  Plus,
  Search,
  Filter,
  Phone,
  Mail,
  MapPin,
  ChevronRight,
  Edit,
  FileText,
  Briefcase,
  CheckCircle2,
  X,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';

interface ClientsViewProps {
  onNavigateToWorkItems?: (projectId: string) => void;
}

export const ClientsView: React.FC<ClientsViewProps> = ({ onNavigateToWorkItems }) => {
  const { clients, projects } = useNW();

  // Selected client for detail view (null means list view)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // Modals
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientToEdit, setClientToEdit] = useState<Client | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectDefaultClientId, setProjectDefaultClientId] = useState<string | undefined>(undefined);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');

  // Success Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 4500);
  };

  const handleCreateClientSuccess = (client: Client, message: string) => {
    showToast(message);
    // If we were editing the currently selected client, update it
    if (selectedClient && selectedClient.id === client.id) {
      setSelectedClient(client);
    }
  };

  const handleCreateProjectSuccess = (project: Project, message: string) => {
    showToast(message);
  };

  const handleOpenEdit = (client: Client, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setClientToEdit(client);
    setShowClientModal(true);
  };

  const handleOpenNewProject = (clientId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setProjectDefaultClientId(clientId);
    setShowProjectModal(true);
  };

  // Filter clients based on search and type
  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contact_person.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.email && c.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.registration_number && c.registration_number.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedTypeFilter === 'ALL') return true;
    if (selectedTypeFilter === 'Company') {
      return c.client_type === 'Company' || c.client_type === 'Corporate' || c.client_type === 'Retail' || c.client_type === 'Commercial' || c.client_type === 'F&B';
    }
    if (selectedTypeFilter === 'Individual') {
      return c.client_type === 'Individual / Homeowner' || c.client_type === 'Luxury Residential';
    }
    return c.client_type === selectedTypeFilter;
  });

  // Render Detail View if a client is selected
  if (selectedClient) {
    // Keep reference synchronized with updated state
    const currentClientData = clients.find((c) => c.id === selectedClient.id) || selectedClient;

    return (
      <>
        {/* Floating Success Toast */}
        {toastMessage && (
          <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in slide-in-from-top duration-200">
            <div className="bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-xs font-bold border border-emerald-500">
              <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
              <span>{toastMessage}</span>
              <button
                onClick={() => setToastMessage(null)}
                className="ml-2 hover:bg-emerald-700/60 p-1 rounded-lg text-emerald-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <ClientDetailView
          client={currentClientData}
          onBack={() => setSelectedClient(null)}
          onEditClient={(client) => handleOpenEdit(client)}
          onNewProject={(clientId) => handleOpenNewProject(clientId)}
          onNavigateToWorkItems={onNavigateToWorkItems}
        />

        {/* Modals */}
        <ClientFormModal
          isOpen={showClientModal}
          onClose={() => {
            setShowClientModal(false);
            setClientToEdit(null);
          }}
          onSuccess={handleCreateClientSuccess}
          clientToEdit={clientToEdit}
        />

        <NewProjectModal
          isOpen={showProjectModal}
          onClose={() => {
            setShowProjectModal(false);
            setProjectDefaultClientId(undefined);
          }}
          onSuccess={handleCreateProjectSuccess}
          defaultClientId={projectDefaultClientId}
        />
      </>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Floating Success Toast */}
      {toastMessage && (
        <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in slide-in-from-top duration-200">
          <div className="bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-xs font-bold border border-emerald-500">
            <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 hover:bg-emerald-700/60 p-1 rounded-lg text-emerald-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header & Desktop Primary Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold uppercase tracking-widest">
              Client Directory & Accounts
            </span>
            <span className="text-xs text-slate-500 font-medium font-mono">
              {clients.length} Registered Accounts
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            Client Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Maintain master corporate accounts, contact liaisons, and multi-project contract portfolios.
          </p>
        </div>

        {/* Desktop Primary Action: "+ New Client" */}
        <div className="hidden sm:flex items-center space-x-3">
          <button
            onClick={() => {
              setClientToEdit(null);
              setShowClientModal(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            id="desktop-new-client-btn"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ New Client</span>
          </button>
        </div>
      </div>

      {/* Mobile Prominent Full-Width Action Button */}
      <div className="sm:hidden">
        <button
          onClick={() => {
            setClientToEdit(null);
            setShowClientModal(true);
          }}
          className="w-full py-3.5 px-4 rounded-xl bg-amber-500 active:bg-amber-600 text-slate-950 text-sm font-bold shadow-md flex items-center justify-center space-x-2 cursor-pointer"
          id="mobile-new-client-btn"
        >
          <Plus className="w-5 h-5 text-slate-950" />
          <span>+ New Client</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by company name, contact person, phone, or SSM reg number..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none pb-1 md:pb-0">
          <Filter className="w-3.5 h-3.5 text-slate-400 mr-1 shrink-0 hidden sm:block" />
          {[
            { id: 'ALL', label: 'All Accounts' },
            { id: 'Company', label: 'Companies' },
            { id: 'Individual', label: 'Individuals / Homeowners' },
            { id: 'Retail', label: 'Retail' },
            { id: 'F&B', label: 'F&B' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTypeFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTypeFilter === tab.id
                  ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Client List Grid */}
      {filteredClients.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-600">
            <Building2 className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">No Clients Found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `No clients matched "${searchQuery}". Try clearing the search query or changing filters.`
                : 'No clients are currently registered in this category. Register your first client now.'}
            </p>
          </div>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedTypeFilter('ALL');
              setClientToEdit(null);
              setShowClientModal(true);
            }}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs inline-flex items-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Client</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClients.map((client) => {
            const clientProjects = projects.filter((p) => p.client_id === client.id);
            const totalValue = clientProjects.reduce((sum, p) => sum + (p.contract_value || 0), 0);
            const isIndividual = client.client_type === 'Individual / Homeowner';

            return (
              <div
                key={client.id}
                onClick={() => setSelectedClient(client)}
                className="group bg-white border border-slate-200 hover:border-amber-400 hover:shadow-md rounded-2xl p-5 transition-all cursor-pointer flex flex-col justify-between space-y-4 relative"
              >
                <div>
                  {/* Top Row: Type Badge and Action Controls */}
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                        isIndividual
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-amber-50 text-amber-800 border-amber-300'
                      }`}
                    >
                      {client.client_type}
                    </span>

                    <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleOpenEdit(client, e)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        title="Edit Client Details"
                        aria-label="Edit Client"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Company Name / Client Name */}
                  <div className="mt-2.5">
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-900 transition-colors line-clamp-1">
                      {client.company_name}
                    </h3>

                    {client.registration_number && (
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {isIndividual ? 'IC/Passport:' : 'SSM:'} {client.registration_number}
                      </div>
                    )}
                  </div>

                  {/* Contact Person Details */}
                  <div className="mt-3.5 pt-3 border-t border-slate-100 space-y-2 text-xs">
                    <div className="flex items-center space-x-2 text-slate-700">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold truncate">{client.contact_person}</span>
                    </div>

                    <div className="flex items-center space-x-2 text-slate-600">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <a
                        href={`tel:${client.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-amber-800 hover:underline"
                      >
                        {client.phone}
                      </a>
                    </div>

                    {client.email && (
                      <div className="flex items-center space-x-2 text-slate-500 text-[11px]">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{client.email}</span>
                      </div>
                    )}

                    {client.billing_address && (
                      <div className="flex items-start space-x-2 text-slate-500 text-[11px] pt-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-1">{client.billing_address}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Section: Multi-Project Stats & Quick Action */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs mb-3">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Active Projects
                      </span>
                      <span className="font-bold text-slate-900 font-mono">
                        {clientProjects.length} {clientProjects.length === 1 ? 'Project' : 'Projects'}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Portfolio Value
                      </span>
                      <span className="font-mono font-bold text-emerald-600">
                        RM {(totalValue / 1000).toFixed(0)}k
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setSelectedClient(client)}
                      className="py-2 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center justify-center space-x-1 transition-colors cursor-pointer"
                    >
                      <span>View Profile</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>

                    <button
                      onClick={(e) => handleOpenNewProject(client.id, e)}
                      className="py-2 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold rounded-xl border border-amber-200 flex items-center justify-center space-x-1 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3 text-amber-700" />
                      <span>+ Project</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <ClientFormModal
        isOpen={showClientModal}
        onClose={() => {
          setShowClientModal(false);
          setClientToEdit(null);
        }}
        onSuccess={handleCreateClientSuccess}
        clientToEdit={clientToEdit}
      />

      <NewProjectModal
        isOpen={showProjectModal}
        onClose={() => {
          setShowProjectModal(false);
          setProjectDefaultClientId(undefined);
        }}
        onSuccess={handleCreateProjectSuccess}
        defaultClientId={projectDefaultClientId}
      />
    </div>
  );
};
