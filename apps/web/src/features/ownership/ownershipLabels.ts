/**
 * Mirrors the API's single rule for Ownership names (services/ownership/labels.rs):
 * 1 to `maxChars` characters after trimming, and no control characters such as
 * line breaks or tabs. Returns the field error, or null when the name is valid.
 */
export function ownershipLabelError(value: string, maxChars: number): string | null {
  // Rust's `str::trim` also strips U+0085 (NEXT LINE); JS `trim` does not.
  const label = value.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
  const chars = [...label];
  if (chars.length === 0 || chars.length > maxChars) return `Enter a name of 1 to ${maxChars} characters.`;
  if (chars.some(isControlCharacter)) return 'Names cannot contain line breaks, tabs, or other control characters.';
  return null;
}

/** Unicode general category Cc, matching Rust's `char::is_control`. */
function isControlCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}
