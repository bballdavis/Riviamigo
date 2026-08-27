import { describe, expect, it } from 'vitest';
import { formatRivianRenewalDate, getRivianCredentialRenewalNotice } from '../lib/rivianCredentialRenewal';

describe('Rivian credential renewal presentation', () => {
  it('does not warn while credentials are healthy or require reauthentication', () => {
    expect(getRivianCredentialRenewalNotice({ renewal_state: 'healthy' })).toBeNull();
    expect(getRivianCredentialRenewalNotice({ renewal_state: 'reauth_required' })).toBeNull();
  });

  it('describes an upcoming advisory renewal date without calling it an expiration', () => {
    const notice = getRivianCredentialRenewalNotice({
      renewal_state: 'renewal_soon',
      expected_renewal_at: '2027-02-23T12:00:00Z',
    });

    expect(notice).toMatchObject({ due: false });
    expect(notice?.label).toContain('Renew Rivian by');
    expect(notice?.message).toContain('estimated 180-day renewal date');
    expect(notice?.message).not.toContain('expire');
  });

  it('uses a recoverable recommendation when the estimate is due', () => {
    expect(getRivianCredentialRenewalNotice({ renewal_state: 'renewal_due' })).toEqual({
      due: true,
      label: 'Rivian renewal recommended',
      message: 'The estimated 180-day Rivian connection window has passed. Refresh the Rivian login to avoid an interruption.',
    });
  });

  it('ignores invalid dates', () => {
    expect(formatRivianRenewalDate('not-a-date')).toBeNull();
  });
});
