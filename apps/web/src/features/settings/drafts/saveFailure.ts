/** Keeps the API's user-facing message when there is one; otherwise uses the fallback. */
export function saveFailure(error: unknown, fallback: string): Error {
  const message = (error as { detail?: { message?: string } } | null)?.detail?.message;
  return new Error(message || fallback);
}
