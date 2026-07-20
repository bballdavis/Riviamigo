type ApiFailure = Error & {
  code?: string;
  detail?: { code?: string };
};

export function connectErrorMessage(error: unknown): string {
  const failure = error as ApiFailure;
  const code = failure?.code ?? failure?.detail?.code;

  switch (code) {
    case 'RIVIAN_CREDENTIALS_REJECTED':
      return 'Rivian did not accept that email or password. Check both and try again.';
    case 'RIVIAN_OTP_REJECTED':
      return 'Rivian did not accept that verification code. Check it and try again.';
    case 'RIVIAN_CONNECT_SESSION_EXPIRED':
      return 'This Rivian sign-in session has expired. Start again from the account step.';
    case 'DEPENDENCY_UNAVAILABLE':
      return 'Temporary secure-session storage is unavailable. Please try again.';
    case 'RIVIAN_API':
      return 'Rivian could not complete this request. Please try again shortly.';
    default:
      return 'We could not complete the Rivian connection. Please try again.';
  }
}
