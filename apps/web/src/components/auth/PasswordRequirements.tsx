import { Check, Circle } from 'lucide-react';

export const PASSWORD_MIN_LENGTH = 12;

export function PasswordRequirements({ password }: { password: string }) {
  const count = password.length;
  const isComplete = count >= PASSWORD_MIN_LENGTH;
  const hasStarted = count > 0;
  const stateClass = isComplete
    ? 'border-status-positive/30 bg-status-positive/10 text-status-positive'
    : hasStarted
      ? 'border-status-danger/30 bg-status-danger/10 text-status-danger'
      : 'border-border bg-bg-elevated/50 text-fg-tertiary';

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${stateClass}`}
      role="status"
      aria-label={`Password requires at least ${PASSWORD_MIN_LENGTH} characters. ${count} entered.`}
    >
      <span className="flex items-center gap-2">
        {isComplete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
        At least {PASSWORD_MIN_LENGTH} characters
      </span>
      <span className="shrink-0 tabular-nums">{count}/{PASSWORD_MIN_LENGTH}</span>
    </div>
  );
}
