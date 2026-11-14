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

/// A stored name saved by a build that allowed control characters, made
/// acceptable to [`clean_label`]: each control character becomes a space,
/// whitespace runs collapse, and the result is cut to `max_chars`. `None`
/// when nothing readable is left. Applied on load, so one legacy name cannot
/// block every later save of the record it belongs to.
pub fn repair_stored_label(value: &str, max_chars: usize) -> Option<String> {
    // A name that already passes is kept exactly as stored.
    if let Some(valid) = clean_label(value, max_chars) {
        return Some(valid);
    }
    let spaced: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = collapsed.chars().take(max_chars).collect();
    clean_label(&cut, max_chars)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_legacy_labels_into_valid_ones() {
        assert_eq!(
            repair_stored_label("Oil\tchange\n", 60).as_deref(),
            Some("Oil change")
        );
        assert_eq!(
            repair_stored_label("Tires\u{85}", 60).as_deref(),
            Some("Tires")
        );
        assert_eq!(repair_stored_label("\u{7}\u{1b}", 60), None);
        assert_eq!(
            repair_stored_label(&"x".repeat(90), 80).map(|l| l.len()),
            Some(80)
        );
        assert_eq!(
            repair_stored_label("Two  spaces", 60).as_deref(),
            Some("Two  spaces")
        );
        let repaired = repair_stored_label("A\u{0}B", 60).unwrap();
        assert_eq!(clean_label(&repaired, 60).as_deref(), Some("A B"));
    }
}
