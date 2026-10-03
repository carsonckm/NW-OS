/**
 * NW OS — New Project Creation Modal
 * Enables project creation linked directly to existing or newly created clients.
 */

import React, { useState, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import { Project, ProjectStatus } from '../types';
import {
  X,
  Building2,
  Calendar,
  DollarSign,
  MapPin,
  FileText,
  User,
  CheckCircle2,
  AlertCircle,
  Plus,
} from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (project: Project, message: string) => void;
  defaultClientId?: string;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultClientId,
}) => {
  const { clients, projects, addProject, availableUsers } = useNW();

  const [clientId, setClientId] = useState<string>('');
  const [projectName, setProjectName] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [contractValue, setContractValue] = useState<string>('650000');
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('Active');
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [pmId, setPmId] = useState('user-pm');
  const [siteSupervisorId, setSiteSupervisorId] = useState('user-site');
  const [description, setDescription] = useState('');

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const selectedClient = defaultClientId || (clients[0] ? clients[0].id : '');
      setClientId(selectedClient);

      // Auto-generate project number
      const nextNum = projects.length + 88 + 10;
      setProjectNumber(`NW-2026-${String(nextNum).padStart(3, '0')}`);
      setProjectName('');
      setSiteAddress('');
      setContractValue('650000');
      setProjectStatus('Active');
      setDescription('');
      setErrors({});
    }
  }, [isOpen, defaultClientId, clients, projects.length]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!clientId) {
      errs.clientId = 'Please select a Client.';
    }
    if (!projectName.trim()) {
      errs.projectName = 'Project Name is required.';
    }
    if (!projectNumber.trim()) {
      errs.projectNumber = 'Project Number is required.';
    }
    if (!siteAddress.trim()) {
      errs.siteAddress = 'Site Address is required (belongs to this individual project).';
    }
    const val = parseFloat(contractValue);
    if (isNaN(val) || val <= 0) {
      errs.contractValue = 'Please enter a valid contract value in RM.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const created = addProject({
        project_number: projectNumber.trim(),
        project_name: projectName.trim(),
        client_id: clientId,
        site_address: siteAddress.trim(),
        contract_value: parseFloat(contractValue),
        project_status: projectStatus,
        start_date: startDate,
        end_date: endDate,
        signed_date: startDate,
        project_manager_id: pmId,
        site_supervisor_id: siteSupervisorId,
        progress_percent: 0,
        description: description.trim() || 'New commercial interior fitout and architectural joinery.',
        is_at_risk: false,
      });

      onSuccess(created, 'Project created successfully.');
      onClose();
    } catch (err) {
      console.error('Error creating project:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedClientObj = clients.find((c) => c.id === clientId);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-5 sm:p-7 text-slate-900 shadow-2xl my-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-5">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700">
              <Building2 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Create New Project</h2>
              <p className="text-xs text-slate-500 font-medium">
                Contract & site operations intake for{' '}
                {selectedClientObj ? selectedClientObj.company_name : 'selected client'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Client Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Select Client <span className="text-rose-500">*</span>
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                errors.clientId
                  ? 'border-rose-400 focus:ring-rose-400/20'
                  : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20'
              }`}
            >
              <option value="" disabled>
                -- Choose a registered client --
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name} ({c.client_type} • Contact: {c.contact_person})
                </option>
              ))}
            </select>
            {errors.clientId && (
              <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errors.clientId}</span>
              </p>
            )}
          </div>

          {/* Project Name & Number */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Project Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Project Solaria — Mid Valley Megamall Boutique"
                className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                  errors.projectName
                    ? 'border-rose-400 focus:ring-rose-400/20'
                    : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20'
                }`}
              />
              {errors.projectName && (
                <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{errors.projectName}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Project Code <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                placeholder="NW-2026-096"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Site Address (Dedicated to Project) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Site Address <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-slate-500 font-medium">
                Specific to this site location
              </span>
            </div>
            <textarea
              rows={2}
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              placeholder="e.g. Lot F-023, First Floor, Mid Valley Megamall, Lingkaran Syed Putra, 59200 Kuala Lumpur"
              className={`w-full bg-slate-50 border rounded-xl p-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                errors.siteAddress
                  ? 'border-rose-400 focus:ring-rose-400/20'
                  : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20'
              }`}
            />
            {errors.siteAddress && (
              <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errors.siteAddress}</span>
              </p>
            )}
          </div>

          {/* Contract Value & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Contract Value (RM) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs font-bold text-slate-400">
                  RM
                </span>
                <input
                  type="number"
                  step="1000"
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  placeholder="500000"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-3 py-2 text-xs text-slate-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white"
                />
              </div>
              {errors.contractValue && (
                <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{errors.contractValue}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Project Status
              </label>
              <select
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value as ProjectStatus)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white"
              >
                <option value="Awarded">Awarded</option>
                <option value="Pre-Start">Pre-Start (Shop Drawings & Procurement)</option>
                <option value="Active">Active Site Operations</option>
                <option value="Practical Completion">Practical Completion</option>
                <option value="On Hold">On Hold</option>
              </select>
            </div>
          </div>

          {/* Timeline & Roles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Target Handover Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Lead Project Manager
              </label>
              <select
                value={pmId}
                onChange={(e) => setPmId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:bg-white"
              >
                <option value="user-pm">Marcus Lee (Senior PM)</option>
                <option value="user-admin">Sarah Cheng (Operations)</option>
                <option value="user-owner">Dato’ Nicholas Wong (Executive Oversight)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Site Supervisor
              </label>
              <select
                value={siteSupervisorId}
                onChange={(e) => setSiteSupervisorId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:bg-white"
              >
                <option value="user-site">Suresh Kumar (Senior Site Supervisor)</option>
                <option value="user-pm">Marcus Lee</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Scope of Work Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Turnkey interior fitout, bespoke joinery, solid surface cashier counters, acoustic wall treatment, and authority approval coordination."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-amber-500 focus:bg-white"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save Project</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
