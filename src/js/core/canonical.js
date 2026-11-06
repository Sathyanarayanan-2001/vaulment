// Records from different devices may hold the same keys in a different order, so
// raw JSON text cannot be compared. Canonical text sorts keys at every depth.

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}
