import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { OnboardingWizard } from './OnboardingWizard';
import * as api from '@/lib/api';

type SetupState = 'loading' | 'needs_setup' | 'ready';

interface SetupCheckProps {
  children: ReactNode;
}

export default function SetupCheck({ children }: SetupCheckProps) {
  const [state, setState] = useState<SetupState>('loading');

  const checkSetup = useCallback(async () => {
    try {
      const { needsSetup } = await api.getSetupStatus();
      setState(needsSetup ? 'needs_setup' : 'ready');
    } catch (err) {
      console.error('Setup status check failed:', err);
      // If the check fails, proceed to the app so it doesn't block usage
      setState('ready');
    }
  }, []);

  useEffect(() => {
    checkSetup();
  }, [checkSetup]);

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-0">
        <span className="font-mono text-sm text-text-dim">
          Checking setup status...
        </span>
      </div>
    );
  }

  if (state === 'needs_setup') {
    return <OnboardingWizard onComplete={() => setState('ready')} />;
  }

  return <>{children}</>;
}
