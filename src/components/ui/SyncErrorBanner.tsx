import React, { useEffect, useState } from 'react';
import { useNW } from '../../context/NWContext';
import { FormError } from './FormError';

/**
 * Surface connection/save problems without claiming that an unconfirmed write rolled back.
 * Explicit server refusals already include their own not-saved explanation.
 */
export const SyncErrorBanner: React.FC = () => {
  const { coreDataSync } = useNW();
  const [dismissed, setDismissed] = useState<string | undefined>();
  const message = coreDataSync.status === 'error' ? coreDataSync.message : undefined;
  useEffect(() => setDismissed(undefined), [message]);
  if (!message || dismissed === message) return null;
  return (
    <div className="mx-auto mt-3 w-full max-w-7xl px-4 sm:px-6 lg:px-8" data-testid="sync-error-banner">
      <FormError error={message} onDismiss={() => setDismissed(message)} />
    </div>
  );
};
