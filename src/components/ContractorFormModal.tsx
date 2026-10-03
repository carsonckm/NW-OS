/**
 * NW OS — Contractor Creation & Edit Form Modal
 * Implements complete Contractor intake and trade qualification management.
 */

import React, { useState, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import { Contractor, ContractorType, ContractorTrade } from '../types';
import {
  X,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  Wrench,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Hash,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface ContractorFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (contractor: Contractor, message: string) => void;
  contractorToEdit?: Contractor | null;
}

const TRADE_OPTIONS: ContractorTrade[] = [
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

export const ContractorFormModal: React.FC<ContractorFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  contractorToEdit,
}) => {
  const { addContractor, updateContractor } = useNW();

  const [contractorType, setContractorType] = useState<ContractorType>('Company');
  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [trade, setTrade] = useState<ContractorTrade | string>('Carpentry');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Form validation errors
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (contractorToEdit) {
      setContractorType(contractorToEdit.contractor_type || 'Company');
      setCompanyName(contractorToEdit.company_name || '');
      setRegistrationNumber(contractorToEdit.registration_number || '');
      setContactPerson(contractorToEdit.contact_person || '');
      setPhone(contractorToEdit.phone || '');
      setEmail(contractorToEdit.email || '');
      setTrade(contractorToEdit.trade || 'Carpentry');
      setAddress(contractorToEdit.address || '');
      setNotes(contractorToEdit.notes || '');
      setIsActive(contractorToEdit.is_active !== false);
    } else {
      // Default reset
      setContractorType('Company');
      setCompanyName('');
      setRegistrationNumber('');
      setContactPerson('');
      setPhone('');
      setEmail('');
      setTrade('Carpentry');
      setAddress('');
      setNotes('');
      setIsActive(true);
    }
    setErrors({});
  }, [contractorToEdit, isOpen]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!contractorType) {
      errs.contractorType = 'Contractor Type is required.';
    }

    if (!companyName.trim()) {
      errs.companyName =
        contractorType === 'Individual'
          ? 'Contractor Name is required.'
          : 'Contractor / Company Name is required.';
    }

    if (!contactPerson.trim()) {
      errs.contactPerson = 'Contact Person is required.';
    }

    if (!phone.trim()) {
      errs.phone = 'Phone number is required.';
    }

    if (!trade) {
      errs.trade = 'Trade / Category is required.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);

    try {
      if (contractorToEdit) {
        const updatedData: Partial<Contractor> = {
          contractor_type: contractorType,
          company_name: companyName.trim(),
          registration_number: registrationNumber.trim() || undefined,
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          trade,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          is_active: isActive,
        };

        updateContractor(contractorToEdit.id, updatedData);
        onSuccess(
          { ...contractorToEdit, ...updatedData } as Contractor,
          'Contractor updated successfully.'
        );
      } else {
        const newContractor = addContractor({
          contractor_type: contractorType,
          company_name: companyName.trim(),
          registration_number: registrationNumber.trim() || undefined,
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          trade,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          is_active: isActive,
          rating: 4.8,
          preferred_languages: ['English', 'Bahasa Malaysia'],
        });

        onSuccess(newContractor, 'Contractor created successfully.');
      }
      onClose();
    } catch (err) {
      console.error('Failed to save contractor:', err);
      setErrors({ form: 'An error occurred while saving the contractor. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div
        className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full text-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8"
        id="contractor-form-modal"
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">
                {contractorToEdit ? 'Edit Contractor Record' : 'New Contractor Registration'}
              </h2>
              <p className="text-xs text-slate-300">
                {contractorToEdit
                  ? 'Update trade qualifications, contact information, or active status.'
                  : 'Register sub-contractor or specialist trade supplier in NW OS.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors cursor-pointer"
            id="close-contractor-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {errors.form && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          {/* Contractor Type Selection (Required) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Contractor Type <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setContractorType('Company')}
                className={`flex items-center justify-center space-x-2.5 p-3.5 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                  contractorType === 'Company'
                    ? 'bg-amber-50 border-amber-500 text-amber-900 ring-2 ring-amber-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                id="type-company-btn"
              >
                <Building2 className={`w-4 h-4 ${contractorType === 'Company' ? 'text-amber-600' : 'text-slate-400'}`} />
                <span>Company (Sdn Bhd / Enterprise)</span>
              </button>

              <button
                type="button"
                onClick={() => setContractorType('Individual')}
                className={`flex items-center justify-center space-x-2.5 p-3.5 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                  contractorType === 'Individual'
                    ? 'bg-amber-50 border-amber-500 text-amber-900 ring-2 ring-amber-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                id="type-individual-btn"
              >
                <User className={`w-4 h-4 ${contractorType === 'Individual' ? 'text-amber-600' : 'text-slate-400'}`} />
                <span>Individual / Sole Proprietor</span>
              </button>
            </div>
            {errors.contractorType && (
              <p className="text-[11px] text-rose-600 font-medium mt-1">{errors.contractorType}</p>
            )}
          </div>

          {/* Primary Name & Registration Number */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label
                htmlFor="contractor-name-input"
                className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
              >
                {contractorType === 'Individual' ? 'Contractor Name' : 'Contractor / Company Name'}{' '}
                <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="contractor-name-input"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={
                    contractorType === 'Individual'
                      ? 'e.g., Ah Seng / Lim Hock Seng'
                      : 'e.g., Hock Seng Carpentry & Joinery Sdn Bhd'
                  }
                  className={`w-full bg-slate-50 border rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                    errors.companyName
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-slate-200 focus:border-amber-500 focus:ring-amber-500/20'
                  }`}
                />
              </div>
              {errors.companyName && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.companyName}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="registration-number-input"
                className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
              >
                Registration No.
              </label>
              <div className="relative">
                <Hash className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  id="registration-number-input"
                  type="text"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="e.g., 201501029834"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all font-mono"
                />
              </div>
              <p className="text-[10px] text-slate-400">SSM / NRIC / CIDB reg.</p>
            </div>
          </div>

          {/* Trade / Category (Required) */}
          <div className="space-y-1.5">
            <label
              htmlFor="contractor-trade-select"
              className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
            >
              Trade / Category <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Wrench className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
              <select
                id="contractor-trade-select"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                className={`w-full bg-slate-50 border rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:bg-white transition-all cursor-pointer ${
                  errors.trade
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-200 focus:border-amber-500 focus:ring-amber-500/20'
                }`}
              >
                {TRADE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {errors.trade && (
              <p className="text-[11px] text-rose-600 font-medium">{errors.trade}</p>
            )}
          </div>

          {/* Contact Person & Phone (Both Required) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="contact-person-input"
                className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
              >
                Contact Person <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  id="contact-person-input"
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="e.g., Ah Seng / Lim Hock Seng"
                  className={`w-full bg-slate-50 border rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                    errors.contactPerson
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-slate-200 focus:border-amber-500 focus:ring-amber-500/20'
                  }`}
                />
              </div>
              {errors.contactPerson && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.contactPerson}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="phone-input"
                className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
              >
                Phone <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  id="phone-input"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g., +60 12-398 5566"
                  className={`w-full bg-slate-50 border rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all font-mono ${
                    errors.phone
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-slate-200 focus:border-amber-500 focus:ring-amber-500/20'
                  }`}
                />
              </div>
              {errors.phone && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.phone}</p>
              )}
            </div>
          </div>

          {/* Email & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email-input"
                className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  id="email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g., hockseng.carpentry@gmail.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Active / Inactive Status Toggle */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Status
              </label>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-slate-100 border-slate-300 text-slate-600'
                }`}
                id="contractor-status-toggle"
              >
                <div className="flex items-center space-x-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                    }`}
                  />
                  <span>{isActive ? 'Active Contractor' : 'Inactive Contractor'}</span>
                </div>
                {isActive ? (
                  <span className="text-[10px] uppercase font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-300">
                    Active
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded border border-slate-300">
                    Inactive
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Address / Factory Location */}
          <div className="space-y-1.5">
            <label
              htmlFor="address-input"
              className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
            >
              Factory / Workshop Address
            </label>
            <div className="relative">
              <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <textarea
                id="address-input"
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g., Lot 18, Jalan Industri SB 3, Kawasan Perindustrian Sungai Buloh, 47000 Selangor"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Notes & Specializations */}
          <div className="space-y-1.5">
            <label
              htmlFor="notes-input"
              className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
            >
              Notes & Capabilities
            </label>
            <div className="relative">
              <FileText className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <textarea
                id="notes-input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Specializes in PU 2K spray booth, solid timber joinery, CNC router cutting, or mall after-hours delivery clearance."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer"
              id="cancel-contractor-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer disabled:opacity-50"
              id="save-contractor-btn"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>{isSubmitting ? 'Saving...' : 'Save Contractor'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
