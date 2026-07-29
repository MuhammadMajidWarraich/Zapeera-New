export type RequiredFieldsMap = Record<string, string>;

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

/**
 * Returns labels for any missing required fields.
 *
 * Example:
 * getMissingRequiredFields({ name: "", email: "a@b.com" }, { name: "Name", email: "Email" })
 * -> ["Name"]
 */
export function getMissingRequiredFields(
  values: Record<string, unknown>,
  required: RequiredFieldsMap
): string[] {
  const missing: string[] = [];
  for (const [key, label] of Object.entries(required)) {
    if (isMissingValue(values[key])) missing.push(label);
  }
  return missing;
}

