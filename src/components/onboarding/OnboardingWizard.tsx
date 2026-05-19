import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/atoms/Button';
import * as api from '@/lib/api';

type Step = 0 | 1 | 2;

interface ProviderStatus {
  claude: boolean;
  gemini: boolean;
  codex: boolean;
}

interface SetupFormData {
  approval_mode: 'auto' | 'manual';
}

const STEP_LABELS = ['Welcome', 'Providers', 'Configure'] as const;

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full',
              'font-mono text-[10px] font-semibold transition-colors',
              i < current
                ? 'bg-accent-green/20 text-accent-green'
                : i === current
                  ? 'bg-accent-orange/20 text-accent-orange'
                  : 'bg-surface-3 text-text-dim',
            )}
          >
            {i < current ? (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                className="text-accent-green"
              >
                <path
                  d="M2 5L4.5 7.5L8 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          <span
            className={cn(
              'font-mono text-[10px] tracking-wider uppercase',
              i === current ? 'text-text-secondary' : 'text-text-dim',
            )}
          >
            {label}
          </span>
          {i < STEP_LABELS.length - 1 && (
            <div
              className={cn(
                'mx-1 h-px w-8',
                i < current ? 'bg-accent-green/30' : 'bg-border-primary',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={cn(
          'mb-6 flex h-16 w-16 items-center justify-center',
          'rounded-xl border border-accent-orange/30 bg-accent-orange-bg',
        )}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          className="text-accent-orange"
        >
          <path
            d="M16 4L28 10V22L16 28L4 22V10L16 4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M16 16L28 10M16 16L4 10M16 16V28"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r="3" fill="currentColor" opacity="0.3" />
        </svg>
      </div>

      <h2 className="mb-2 text-lg font-semibold text-text-primary">
        Welcome to AgentFlow
      </h2>

      <p className="mb-6 max-w-sm font-mono text-xs leading-relaxed text-text-secondary">
        AgentFlow orchestrates AI coding agents across multi-step
        pipelines. Define tasks, assign models, set dependencies,
        and let the system handle execution order and approvals.
      </p>

      <div className="grid w-full max-w-sm grid-cols-3 gap-3">
        {[
          { title: 'Pipelines', desc: 'Multi-stage task flows' },
          { title: 'Agents', desc: 'Claude, Gemini, Codex' },
          { title: 'Control', desc: 'Approve or auto-run' },
        ].map((item) => (
          <div
            key={item.title}
            className={cn(
              'rounded-lg border border-border-primary bg-surface-2 p-3',
              'text-center',
            )}
          >
            <div className="mb-1 font-mono text-[11px] font-semibold text-text-primary">
              {item.title}
            </div>
            <div className="font-mono text-[9px] text-text-muted">
              {item.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderStep({
  providers,
  detecting,
}: {
  providers: ProviderStatus;
  detecting: boolean;
}) {
  const providerList: { key: keyof ProviderStatus; label: string; desc: string }[] = [
    { key: 'claude', label: 'Claude CLI', desc: 'Anthropic Claude Code' },
    { key: 'gemini', label: 'Gemini CLI', desc: 'Google Gemini' },
    { key: 'codex', label: 'Codex CLI', desc: 'OpenAI Codex' },
  ];

  return (
    <div className="flex flex-col items-center">
      <h2 className="mb-1 text-lg font-semibold text-text-primary">
        Provider Detection
      </h2>
      <p className="mb-6 font-mono text-xs text-text-muted">
        Checking which CLI tools are installed on your system.
      </p>

      <div className="w-full max-w-sm space-y-2">
        {providerList.map(({ key, label, desc }) => {
          const found = providers[key];
          return (
            <div
              key={key}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-4 transition-colors',
                detecting
                  ? 'border-border-primary bg-surface-2'
                  : found
                    ? 'border-accent-green/30 bg-accent-green-bg'
                    : 'border-border-primary bg-surface-2',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg',
                  detecting
                    ? 'bg-surface-3'
                    : found
                      ? 'bg-accent-green/10'
                      : 'bg-surface-3',
                )}
              >
                {detecting ? (
                  <div className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-text-secondary" />
                ) : found ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="text-accent-green"
                  >
                    <path
                      d="M3 7L6 10L11 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className="text-text-dim"
                  >
                    <path
                      d="M3 3L9 9M9 3L3 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </div>

              <div className="flex-1">
                <div
                  className={cn(
                    'font-mono text-xs font-semibold',
                    detecting
                      ? 'text-text-secondary'
                      : found
                        ? 'text-accent-green'
                        : 'text-text-dim',
                  )}
                >
                  {label}
                </div>
                <div className="font-mono text-[10px] text-text-muted">
                  {desc}
                </div>
              </div>

              <span
                className={cn(
                  'font-mono text-[10px]',
                  detecting
                    ? 'text-text-dim'
                    : found
                      ? 'text-accent-green'
                      : 'text-text-dim',
                )}
              >
                {detecting ? 'checking...' : found ? 'installed' : 'not found'}
              </span>
            </div>
          );
        })}
      </div>

      {!detecting && !providers.claude && !providers.gemini && !providers.codex && (
        <div className="mt-4 w-full max-w-sm rounded-lg border border-accent-orange/30 bg-accent-orange-bg px-4 py-3 text-center">
          <div className="font-mono text-[11px] font-semibold text-accent-orange">No providers detected</div>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-text-secondary">
            You can still continue setup. Install at least one CLI tool later to enable task execution.
          </p>
        </div>
      )}

      {!detecting && (providers.claude || providers.gemini || providers.codex) && (
        <p className="mt-4 max-w-sm text-center font-mono text-[10px] leading-relaxed text-text-dim">
          You can install missing providers later. AgentFlow will only use
          the models that have a corresponding CLI available.
        </p>
      )}
    </div>
  );
}

function ConfigStep({
  formData,
  onUpdate,
}: {
  formData: SetupFormData;
  onUpdate: (data: Partial<SetupFormData>) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <h2 className="mb-1 text-lg font-semibold text-text-primary">
        Configuration
      </h2>
      <p className="mb-6 font-mono text-xs text-text-muted">
        Set your project defaults. These can be changed later in Settings.
      </p>

      <div className="w-full max-w-sm space-y-5">
        {/* Approval Mode */}
        <div>
          <label className="mb-1.5 block font-mono text-[10px] tracking-widest text-text-muted uppercase">
            Default Approval Mode
          </label>
          <div className="flex gap-2">
            {(
              [
                {
                  id: 'manual' as const,
                  label: 'Manual',
                  desc: 'Review and approve each task before execution',
                },
                {
                  id: 'auto' as const,
                  label: 'Auto',
                  desc: 'Tasks run automatically when dependencies are met',
                },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onUpdate({ approval_mode: mode.id })}
                className={cn(
                  'flex-1 cursor-pointer rounded-lg border px-4 py-3 text-left transition-all',
                  formData.approval_mode === mode.id
                    ? 'border-accent-orange bg-accent-orange-bg'
                    : 'border-border-secondary bg-surface-2 hover:border-border-hover',
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'h-3 w-3 rounded-full border-2 transition-colors',
                      formData.approval_mode === mode.id
                        ? 'border-accent-orange bg-accent-orange'
                        : 'border-text-dim bg-transparent',
                    )}
                  >
                    {formData.approval_mode === mode.id && (
                      <div className="m-px h-1.5 w-1.5 rounded-full bg-surface-0" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'font-mono text-xs font-semibold',
                      formData.approval_mode === mode.id
                        ? 'text-accent-orange'
                        : 'text-text-secondary',
                    )}
                  >
                    {mode.label}
                  </span>
                </div>
                <div className="mt-1 pl-5 font-mono text-[10px] text-text-muted">
                  {mode.desc}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>(0);
  const [providers, setProviders] = useState<ProviderStatus>({
    claude: false,
    gemini: false,
    codex: false,
  });
  const [detecting, setDetecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<SetupFormData>({
    approval_mode: 'manual',
  });

  const detectProvidersCb = useCallback(async () => {
    setDetecting(true);
    try {
      const result = await api.detectProviders();
      setProviders({
        claude: result['claude'] ?? false,
        gemini: result['gemini'] ?? false,
        codex: result['codex'] ?? false,
      });
    } catch (err) {
      console.error('Provider detection failed:', err);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    if (step === 1) {
      detectProvidersCb();
    }
  }, [step, detectProvidersCb]);

  const updateFormData = useCallback((partial: Partial<SetupFormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleComplete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, string> = {
        approval_mode: formData.approval_mode,
      };
      const result = await api.submitSetup(payload);
      if (result.ok) {
        onComplete();
      } else {
        setError('Setup failed. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Setup failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const canGoNext = (): boolean => {
    if (step === 1 && detecting) return false;
    return true;
  };

  const goNext = () => {
    if (step < 2) {
      setStep((step + 1) as Step);
    }
  };

  const goBack = () => {
    if (step > 0) {
      setStep((step - 1) as Step);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/95 backdrop-blur-sm">
      <div
        className={cn(
          'w-full max-w-lg rounded-xl border border-border-primary',
          'bg-surface-1 shadow-2xl animate-fade-in',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-primary px-6 py-4">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Setup
          </span>
          <StepIndicator current={step} />
        </div>

        {/* Content */}
        <div className="px-6 py-8">
          {step === 0 && <WelcomeStep />}
          {step === 1 && (
            <ProviderStep providers={providers} detecting={detecting} />
          )}
          {step === 2 && (
            <ConfigStep formData={formData} onUpdate={updateFormData} />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 rounded border border-accent-red/30 bg-accent-red-bg px-4 py-2">
            <span className="font-mono text-[11px] text-accent-red">{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-primary px-6 py-4">
          <div>
            {step > 0 && (
              <Button variant="ghost" onClick={goBack} disabled={submitting}>
                Back
              </Button>
            )}
          </div>
          <div>
            {step < 2 ? (
              <Button
                variant="primary"
                onClick={goNext}
                disabled={!canGoNext()}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleComplete}
                disabled={submitting}
              >
                {submitting ? 'Setting up...' : 'Complete Setup'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
