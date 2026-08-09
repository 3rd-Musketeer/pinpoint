function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply data-text (legacy) and data-slot-<name> values from an include placeholder
 * to matching data-ios-slot="<name>" nodes in the component fragment.
 */
export function applyIncludeSlots(fragment, rawAttributes) {
  const slots = {};
  const attributes = rawAttributes || '';
  const legacyText = attributes.match(/\bdata-text=(['"])([\s\S]*?)\1/i);
  if (legacyText) slots.text = legacyText[2];

  const slotPattern = /\bdata-slot-([a-zA-Z0-9_-]+)=(['"])([\s\S]*?)\2/gi;
  let match;
  while ((match = slotPattern.exec(attributes))) slots[match[1]] = match[3];

  let output = fragment;
  Object.entries(slots).forEach(([name, value]) => {
    const slotName = escapeRegExp(name);
    const pattern = new RegExp(`(data-ios-slot=["']${slotName}["'][^>]*>)([\\s\\S]*?)(<\\/)`, 'i');
    output = output.replace(pattern, (_all, before, _old, after) => before + value + after);
  });
  return output;
}
