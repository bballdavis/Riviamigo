import type { RivianCredentialRenewalState } from '@riviamigo/types';

export interface RivianCredentialRenewalStatus {
  renewal_state?: RivianCredentialRenewalState | null;
  expected_renewal_at?: string | null;
}

export interface RivianCredentialRenewalNotice {
  label: string;
  message: string;
  due: boolean;
}

export function formatRivianRenewalDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function getRivianCredentialRenewalNotice(
  status?: RivianCredentialRenewalStatus | null,
): RivianCredentialRenewalNotice | null {
  if (status?.renewal_state !== 'renewal_soon' && status?.renewal_state !== 'renewal_due') {
    return null;
  }

  const renewalDate = formatRivianRenewalDate(status.expected_renewal_at);
  const due = status.renewal_state === 'renewal_due';
  return {
    due,
    label: due ? 'Rivian renewal recommended' : `Renew Rivian${renewalDate ? ` by ${renewalDate}` : ' soon'}`,
    message: due
      ? 'The estimated 180-day Rivian connection window has passed. Refresh the Rivian login to avoid an interruption.'
      : `The Rivian connection is approaching its estimated 180-day renewal date${renewalDate ? ` on ${renewalDate}` : ''}.`,
  };
}
