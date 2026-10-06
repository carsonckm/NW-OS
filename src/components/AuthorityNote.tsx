/**
 * Why an approval action is not offered, in the server's words (the authority resolver's
 * reason and code). "Owner approval required" when the Owner must decide (project sensitivity
 * or a policy); nothing for people with no part in the decision at all.
 */
import React from 'react';
import type { ScreenAuthority } from '../services/authority';

const QUIET = new Set(['INSUFFICIENT_PERMISSION']);

export const AuthorityNote: React.FC<{ authority?: ScreenAuthority; dark?: boolean; always?: boolean; className?: string }> = ({ authority, dark, always, className = '' }) => {
  if (!authority || authority.allowed) return null;
  const owner = authority.requires_owner || authority.reason_code === 'SENSITIVITY_BLOCKED' || authority.reason_code === 'OWNER_REQUIRED';
  if (!owner && !always && QUIET.has(authority.reason_code)) return null;
  const title = owner
    ? `Owner approval required${authority.project_sensitivity && authority.reason_code === 'SENSITIVITY_BLOCKED' ? ` (${authority.project_sensitivity} project)` : ''}`
    : 'Not yours to approve';
  const tone = owner
    ? dark
      ? 'border-amber-500/40 bg-amber-950/40 text-amber-200'
      : 'border-amber-300 bg-amber-50 text-amber-900'
    : dark
      ? 'border-slate-700 bg-slate-900 text-slate-300'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <div data-testid="authority-note" data-reason-code={authority.reason_code} className={`rounded-xl border px-3 py-2 text-[11px] leading-snug ${tone} ${className}`}>
      <div className="font-bold">{title}</div>
      <div>{authority.reason}</div>
      <div className="mt-0.5 font-mono text-[9px] opacity-70">{authority.reason_code}</div>
    </div>
  );
};
