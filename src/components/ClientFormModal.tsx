/**
 * NW OS — Client Creation & Edit Form Modal
 * Implements strict Malaysian construction client record intake.
 */

import React, { useState, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import { Client, ClientType } from '../types';
import {
  X,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (client: Client, message: string) => void;
  clientToEdit?: Client | null;
}

export const ClientFormModal: React.FC<ClientFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  clientToEdit,
}) => {
  const { addClient, updateClient } = useNW();

  const [clientType, setClientType] = useState<ClientType>('Company');
  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Form errors
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (clientToEdit) {
      setClientType(clientToEdit.client_type);
      setCompanyName(clientToEdit.company_name);
      setRegistrationNumber(clientToEdit.registration_number || '');
      setContactPerson(clientToEdit.contact_person);
      setPhone(clientToEdit.phone);
      setEmail(clientToEdit.email || '');
      setBillingAddress(clientToEdit.billing_address || '');
      setNotes(clientToEdit.notes || '');
    } else {
      // Default reset
      setClientType('Company');
      setCompanyName('');
      setRegistrationNumber('');
      setContactPerson('');
      setPhone('');
      setEmail('');
      setBillingAddress('');
      setNotes('');
    }
    setErrors({});
  }, [clientToEdit, isOpen]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!clientType) {
      errs.clientType = 'Client Type is required.';
    }

    if (!companyName.trim()) {
      errs.companyName =
        clientType === 'Individual / Homeowner'
          ? 'Client Name is required.'
          : 'Company Name is required.';
    }

    if (!contactPerson.trim()) {
      errs.contactPerson = 'Contact Person is required.';
    }

    if (!phone.trim()) {
      errs.phone = 'Phone number is required.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);

    try {
      if (clientToEdit) {
        updateClient(clientToEdit.id, {
          client_type: clientType,
          company_name: companyName.trim(),
          registration_number: registrationNumber.trim(),
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim(),
          billing_address: billingAddress.trim(),
          notes: notes.trim(),
        });

        const updated: Client = {
          ...clientToEdit,
          client_type: clientType,
          company_name: companyName.trim(),
          registration_number: registrationNumber.trim(),
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim(),
          billing_address: billingAddress.trim(),
          notes: notes.trim(),
          updated_at: new Date().toISOString(),
        };

        onSuccess(updated, 'Client updated successfully.');
      } else {
        const created = addClient({
          client_type: clientType,
          company_name: companyName.trim(),
          registration_number: registrationNumber.trim(),
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim(),
          billing_address: billingAddress.trim(),
          notes: notes.trim(),
        });

        onSuccess(created, 'Client created successfully.');
      }
      onClose();
    } catch (err) {
      console.error('Error saving client:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isIndividual = clientType === 'Individual / Homeowner';

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-5 sm:p-7 text-slate-900 shadow-2xl my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-5">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              {isIndividual ? (
                <User className="w-5 h-5 text-amber-600" />
              ) : (
                <Building2 className="w-5 h-5 text-amber-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {clientToEdit ? 'Edit Client Record' : 'New Client'}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {clientToEdit
                  ? `Update details for ${clientToEdit.company_name}`
                  : 'Register a corporate entity or individual client for project contracts'}
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Client Type Picker */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Client Type <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { type: 'Company' as ClientType, label: 'Company', desc: 'Corporate / SME' },
                {
                  type: 'Individual / Homeowner' as ClientType,
                  label: 'Individual',
                  desc: 'Homeowner / Private',
                },
                { type: 'Retail' as ClientType, label: 'Retail', desc: 'Mall & Boutique' },
                { type: 'F&B' as ClientType, label: 'F&B', desc: 'Restaurant & Cafe' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.type}
                  onClick={() => setClientType(item.type)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    clientType === item.type
                      ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/20 text-slate-900'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  <div className="font-bold text-xs">{item.label}</div>
                  <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
                </button>
              ))}
            </div>
            {errors.clientType && (
              <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errors.clientType}</span>
              </p>
            )}
          </div>

          {/* Row: Company Name & Registration Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isIndividual ? 'Client Full Name' : 'Company Name'}{' '}
                <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={
                    isIndividual
                      ? 'e.g. Tan Sri Arthur Lim / Dr. Jason Khoo'
                      : 'e.g. Pavilion Retail Holdings Sdn Bhd'
                  }
                  className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                    errors.companyName
                      ? 'border-rose-400 focus:ring-rose-400/20'
                      : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20'
                  }`}
                />
              </div>
              {errors.companyName && (
                <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{errors.companyName}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isIndividual ? 'NRIC / Passport No.' : 'Registration Number (SSM)'}
              </label>
              <input
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder={
                  isIndividual
                    ? 'e.g. 850412-14-5567'
                    : 'e.g. 201701034928 (1248901-T)'
                }
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                {isIndividual ? 'Malaysian NRIC or Expat Passport' : 'Suruhanjaya Syarikat Malaysia SSM Registration'}
              </span>
            </div>
          </div>

          {/* Row: Contact Person, Phone, Email */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Contact Person <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="e.g. Michelle Tan (Fitout Director)"
                  className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                    errors.contactPerson
                      ? 'border-rose-400 focus:ring-rose-400/20'
                      : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20'
                  }`}
                />
              </div>
              {errors.contactPerson && (
                <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{errors.contactPerson}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Phone <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +60 12-998 1234"
                  className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                    errors.phone
                      ? 'border-rose-400 focus:ring-rose-400/20'
                      : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20'
                  }`}
                />
              </div>
              {errors.phone && (
                <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{errors.phone}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. michelle@pavilion.com.my"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Billing Address */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Billing Address
              </label>
              <span className="text-[10px] text-slate-500 font-medium italic">
                Note: Project site address belongs to the specific Project, not here
              </span>
            </div>
            <textarea
              rows={2}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              placeholder="e.g. Level 10, Pavilion Tower, 75 Jalan Raja Chulan, 50200 Kuala Lumpur"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Strict mall loading bay permits required. Special payment milestones (30% deposit, 50% factory inspection, 20% handover)."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
            />
          </div>

          {/* Architecture note */}
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-start space-x-2 text-[11px] text-amber-900">
            <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Multi-Project Architecture:</strong> A single Client record can host multiple commercial or residential projects. The project site address and contract terms will be linked when creating each project.
            </div>
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
              className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{clientToEdit ? 'Save Changes' : 'Save Client'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
