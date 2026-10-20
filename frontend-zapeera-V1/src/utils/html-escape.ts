/**
 * Escape a user-controlled string for safe interpolation into HTML that is
 * built as a string (print windows via document.write, label templates).
 * React escapes by default; these string-built documents do not (E2E C-10).
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize a value for embedding inside an inline <script> block.
 * JSON.stringify alone does not stop a `</script>` breakout (the slash is
 * not escaped), so `<` is unicode-escaped afterwards.
 */
export function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
