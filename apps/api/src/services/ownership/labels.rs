//! The one rule for user-supplied names on the Ownership page: comparison
//! vehicle names, maintenance item names, and vehicle-lookup text.

/// Trim `value` and accept it when it is 1 to `max_chars` characters long and
/// contains no control characters (line breaks, tabs, escapes). Surrounding
/// whitespace, including a trailing newline, is trimmed before the check.
pub fn clean_label(value: &str, max_chars: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()
        && value.chars().count() <= max_chars
        && !value.chars().any(char::is_control))
    .then(|| value.to_string())
}
