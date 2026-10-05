import React, { useEffect, useState } from 'react';
import { useNW } from '../../context/NWContext';
import { FormError } from './FormError';

/**
 * Background saves (older screens write through the sync) that the server refused: shown at
 * the top of the page with the server's reason, not only in the footer. The screen already
 * shows the database's state again.
 */
export const SyncErrorBanner: React.FC = () => {
  const { coreDataSync } = useNW();
  const [dismissed, setDismissed] = useState<string | undefined>();
  const message = coreDataSync.status === 'error' ? coreDataSync.message : undefined;
  useEffect(() => setDismissed(undefined), [message]);
  if (!message || dismissed === message) return null;
  return (
    <div className="mx-auto mt-3 w-full max-w-7xl px-4 sm:px-6 lg:px-8" data-testid="sync-error-banner">
      <FormError error={`Not saved — ${message}`} onDismiss={() => setDismissed(message)} />
    </div>
  );
};
