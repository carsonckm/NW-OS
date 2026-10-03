/**
 * NW OS — Contractor Management Module
 * Comprehensive Contractor Directory, Trade Qualification Register,
 * and Cross-Project Work Package Allocation.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Contractor, WorkPackage, ContractorTrade } from '../types';
import { ContractorFormModal } from '../components/ContractorFormModal';
import { ContractorDetailView } from '../components/ContractorDetailView';
import { NewWorkPackageModal } from '../components/NewWorkPackageModal';
import {
  Wrench,
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
  Layers,
  CheckCircle2,
  X,
  Hash,
  Sparkles,
  Power,
} from 'lucide-react';

interface ContractorsViewProps {
  onNavigateToWorkItems?: (projectId?: string) => void;
}

const TRADE_LIST: (ContractorTrade | 'ALL')[] = [
  'ALL',
  'Carpentry',
  'Electrical',
  'Glass',
  'Metal',
  'Painting',
  'Ceiling',
  'Flooring',
  'Plumbing',
  'Other',
];

export const ContractorsView: React.FC<ContractorsViewProps> = ({ onNavigateToWorkItems }) => {
  const { contractors, workPackages, projects, deactivateContractor } = useNW();

  // Selected contractor for detail view (null means list view)
  const [selectedContractor, setSelectedContractor] = useState<Contractor | null>(null);

  // Modals
  const [showContractorModal, setShowContractorModal] = useState(false);
  const [contractorToEdit, setContractorToEdit] = useState<Contractor | null>(null);
  const [showWorkPackageModal, setShowWorkPackageModal] = useState(false);
  const [packageDefaultContractorId, setPackageDefaultContractorId] = useState<string | undefined>(undefined);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTradeFilter, setSelectedTradeFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | 'Company' | 'Individual'>('ALL');

  // Success Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 4500);
  };

  const handleContractorSuccess = (contractor: Contractor, message: string) => {
    showToast(message);
    // If we were viewing details of this contractor, keep it synchronized
    if (selectedContractor && selectedContractor.id === contractor.id) {
      setSelectedContractor(contractor);
    }
  };

  const handleWorkPackageSuccess = (wp: WorkPackage, message: string) => {
    showToast(message);
  };

  const handleOpenEdit = (contractor: Contractor, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContractorToEdit(contractor);
    setShowContractorModal(true);
  };

  const handleOpenAssignPackage = (contractorId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPackageDefaultContractorId(contractorId);
    setShowWorkPackageModal(true);
  };

  const handleToggleActiveQuick = (contractor: Contractor, e: React.MouseEvent) => {
    e.stopPropagation();
    deactivateContractor(contractor.id);
    const willBeActive = contractor.is_active === false;
    showToast(
      willBeActive
        ? `Contractor ${contractor.company_name} is now active.`
        : `Contractor ${contractor.company_name} has been deactivated.`
    );
  };

  // Filter contractors based on search, trade, status, and type
  const filteredContractors = contractors.filter((c) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      c.company_name.toLowerCase().includes(q) ||
      c.contact_person.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.registration_number && c.registration_number.toLowerCase().includes(q)) ||
      (c.address && c.address.toLowerCase().includes(q)) ||
      c.trade.toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (selectedTradeFilter !== 'ALL') {
      if (!c.trade.toLowerCase().includes(selectedTradeFilter.toLowerCase())) {
        return false;
      }
    }

    if (selectedStatusFilter === 'ACTIVE' && c.is_active === false) return false;
    if (selectedStatusFilter === 'INACTIVE' && c.is_active !== false) return false;

    if (selectedTypeFilter !== 'ALL') {
      const cType = c.contractor_type || 'Company';
      if (cType !== selectedTypeFilter) return false;
    }

    return true;
  });

  const getTradeColor = (trade: string) => {
    switch (trade) {
      case 'Carpentry':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'Electrical':
        return 'bg-yellow-100 text-yellow-900 border-yellow-300';
      case 'Glass':
        return 'bg-sky-100 text-sky-900 border-sky-300';
      case 'Metal':
        return 'bg-slate-200 text-slate-800 border-slate-300';
      case 'Painting':
        return 'bg-purple-100 text-purple-900 border-purple-300';
      case 'Ceiling':
        return 'bg-indigo-100 text-indigo-900 border-indigo-300';
      case 'Flooring':
        return 'bg-emerald-100 text-emerald-900 border-emerald-300';
      case 'Plumbing':
        return 'bg-cyan-100 text-cyan-900 border-cyan-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  // If a contractor is selected, render the Contractor Detail View
  if (selectedContractor) {
    const currentData =
      contractors.find((c) => c.id === selectedContractor.id) || selectedContractor;

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
                className="ml-2 hover:bg-emerald-700/60 p-1 rounded-lg text-emerald-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <ContractorDetailView
          contractor={currentData}
          onBack={() => setSelectedContractor(null)}
          onEditContractor={(c) => handleOpenEdit(c)}
          onAssignWorkPackage={(cId) => handleOpenAssignPackage(cId)}
          onNavigateToWorkItems={onNavigateToWorkItems}
        />

        <ContractorFormModal
          isOpen={showContractorModal}
          onClose={() => setShowContractorModal(false)}
          onSuccess={handleContractorSuccess}
          contractorToEdit={contractorToEdit}
        />

        <NewWorkPackageModal
          isOpen={showWorkPackageModal}
          onClose={() => setShowWorkPackageModal(false)}
          onSuccess={handleWorkPackageSuccess}
          defaultContractorId={packageDefaultContractorId}
        />
      </>
    );
  }

  // Otherwise, render Contractor List Screen
  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in slide-in-from-top duration-200">
          <div className="bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-xs font-bold border border-emerald-500">
            <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 hover:bg-emerald-700/60 p-1 rounded-lg text-emerald-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Screen Header & New Contractor Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold uppercase tracking-widest">
              Sub-Contractor Register
            </span>
            <span className="text-xs text-slate-500 font-medium font-mono">
              {contractors.length} Registered Trade Partners
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            Contractor Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Master contractor registry, trade qualifications, and cross-project work package allocation.
          </p>
        </div>

        {/* Desktop Primary Action: "+ New Contractor" */}
        <div className="hidden sm:flex items-center space-x-3">
          <button
            onClick={() => {
              setContractorToEdit(null);
              setShowContractorModal(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            id="desktop-new-contractor-btn"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ New Contractor</span>
          </button>
        </div>
      </div>

      {/* Mobile Prominent Full-Width Action Button */}
      <div className="sm:hidden">
        <button
          onClick={() => {
            setContractorToEdit(null);
            setShowContractorModal(true);
          }}
          className="w-full py-3.5 px-4 rounded-xl bg-amber-500 active:bg-amber-600 text-slate-950 text-sm font-bold shadow-md flex items-center justify-center space-x-2 cursor-pointer"
          id="mobile-new-contractor-btn"
        >
          <Plus className="w-5 h-5 text-slate-950" />
          <span>+ New Contractor</span>
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
            placeholder="Search by company name, trade, contact person, phone, or SSM reg number..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
            id="contractor-search-input"
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

        {/* Status & Type Selectors */}
        <div className="flex items-center space-x-2">
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>

          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
          >
            <option value="ALL">All Types</option>
            <option value="Company">Company</option>
            <option value="Individual">Individual</option>
          </select>
        </div>
      </div>

      {/* Trade Quick-Pills Filter */}
      <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none pb-1">
        <Filter className="w-3.5 h-3.5 text-slate-400 mr-1 shrink-0" />
        {TRADE_LIST.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTradeFilter(t)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              selectedTradeFilter === t
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {t === 'ALL' ? 'All Trades' : t}
          </button>
        ))}
      </div>

      {/* Contractor Cards Grid */}
      {filteredContractors.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
          <Wrench className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">No Contractors Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery || selectedTradeFilter !== 'ALL' || selectedStatusFilter !== 'ALL'
              ? 'No contractor matches your current search filters. Try adjusting your query or resetting filters.'
              : 'No contractor records registered yet in NW OS. Click "+ New Contractor" to add one.'}
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedTradeFilter('ALL');
              setSelectedStatusFilter('ALL');
              setSelectedTypeFilter('ALL');
              setContractorToEdit(null);
              setShowContractorModal(true);
            }}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-xs inline-flex items-center space-x-2 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ New Contractor</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredContractors.map((contractor) => {
            const assignedWPs = workPackages.filter((wp) => wp.contractor_id === contractor.id);
            const distinctProjectIds = new Set(assignedWPs.map((wp) => wp.project_id));
            const isActive = contractor.is_active !== false;

            return (
              <div
                key={contractor.id}
                onClick={() => setSelectedContractor(contractor)}
                className="bg-white border border-slate-200 hover:border-amber-400 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
              >
                {/* Header info */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${getTradeColor(
                          contractor.trade
                        )}`}
                      >
                        {contractor.trade}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                        {contractor.contractor_type || 'Company'}
                      </span>
                    </div>

                    {/* Active / Inactive status pill */}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center space-x-1 uppercase shrink-0 ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-slate-100 text-slate-600 border-slate-300'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isActive ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      />
                      <span>{isActive ? 'Active' : 'Inactive'}</span>
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-700 transition-colors line-clamp-1">
                      {contractor.company_name}
                    </h3>
                    {contractor.registration_number && (
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        SSM: {contractor.registration_number}
                      </div>
                    )}
                  </div>

                  {/* Contact details */}
                  <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
                    <div className="flex items-center space-x-2 text-slate-700">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-medium truncate">{contractor.contact_person}</span>
                    </div>

                    <div className="flex items-center space-x-2 text-slate-600">
                      <Phone className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="font-mono font-medium">{contractor.phone}</span>
                    </div>

                    {contractor.email && (
                      <div className="flex items-center space-x-2 text-slate-500">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{contractor.email}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Assignment Counters & Action Footer */}
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Active Projects
                      </span>
                      <span className="font-mono font-bold text-slate-900">
                        {distinctProjectIds.size} {distinctProjectIds.size === 1 ? 'Site' : 'Sites'}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Work Packages
                      </span>
                      <span className="font-mono font-bold text-amber-700">
                        {assignedWPs.length} {assignedWPs.length === 1 ? 'Package' : 'Packages'}
                      </span>
                    </div>
                  </div>

                  {/* Card quick actions */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => handleOpenAssignPackage(contractor.id, e)}
                      className="flex-1 py-2 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-900 border border-amber-200 text-xs font-bold rounded-xl flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                      title="Assign contractor to a work package"
                    >
                      <Plus className="w-3.5 h-3.5 text-amber-700" />
                      <span>Assign Package</span>
                    </button>

                    <button
                      onClick={(e) => handleOpenEdit(contractor, e)}
                      className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                      title="Edit contractor"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Contractor Creation / Edit Modal */}
      <ContractorFormModal
        isOpen={showContractorModal}
        onClose={() => setShowContractorModal(false)}
        onSuccess={handleContractorSuccess}
        contractorToEdit={contractorToEdit}
      />

      {/* Work Package Creation / Assignment Modal */}
      <NewWorkPackageModal
        isOpen={showWorkPackageModal}
        onClose={() => setShowWorkPackageModal(false)}
        onSuccess={handleWorkPackageSuccess}
        defaultContractorId={packageDefaultContractorId}
      />
    </div>
  );
};
