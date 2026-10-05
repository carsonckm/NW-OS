import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** A refused or failed action, shown next to the button that caused it. */
export const FormError: React.FC<{ error?: string | null; onDismiss?: () => void }> = ({ error, onDismiss }) =>
  error ? (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{error}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="font-bold text-rose-600 hover:text-rose-800" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  ) : null;
