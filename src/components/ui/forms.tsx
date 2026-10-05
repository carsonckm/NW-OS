/**
 * Small shared building blocks for the Phase 4 operational screens, in the app's existing
 * visual style (slate / amber, rounded-xl, text-xs).
 */
import React from 'react';
import { X } from 'lucide-react';

export const Modal: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ title, subtitle, onClose, children, footer, wide }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-8" role="dialog" aria-label={title}>
    <div className={`w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} rounded-2xl border border-slate-200 bg-white shadow-xl`}>
      <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
    </div>
  </div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string; className?: string }> = ({ label, children, hint, className }) => (
  <label className={`block text-xs ${className ?? ''}`}>
    <span className="mb-1 block font-bold text-slate-700">{label}</span>
    {children}
    {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
  </label>
);

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30';

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea rows={3} {...props} className={`${inputClass} ${props.className ?? ''}`} />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;

type Tone = 'primary' | 'secondary' | 'danger' | 'success';
const TONES: Record<Tone, string> = {
  primary: 'bg-amber-500 text-slate-950 hover:bg-amber-400',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
};

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }> = ({ tone = 'secondary', busy, children, ...props }) => (
  <button
    type="button"
    {...props}
    disabled={props.disabled || busy}
    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${props.className ?? ''}`}
  >
    {busy ? 'Working…' : children}
  </button>
);

const PILL: Record<string, string> = {
  good: 'bg-emerald-100 text-emerald-800',
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-amber-100 text-amber-900',
  bad: 'bg-rose-100 text-rose-800',
  neutral: 'bg-slate-100 text-slate-700',
};

export const Pill: React.FC<{ tone?: keyof typeof PILL; children: React.ReactNode; title?: string }> = ({ tone = 'neutral', children, title }) => (
  <span title={title} className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${PILL[tone]}`}>
    {children}
  </span>
);

export const Section: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, actions, children }) => (
  <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {children}
  </div>
);

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => new Date(new Date(date).getTime() + days * 86400000).toISOString().slice(0, 10);
export const rm = (n: unknown) => `RM ${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
