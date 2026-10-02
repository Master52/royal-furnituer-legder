export function versionAtLeast(actual, required) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d+(\.\d+)*$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  };
  const current = parse(actual), minimum = parse(required);
  if (!current || !minimum) return false;
  for (let index = 0; index < Math.max(current.length, minimum.length); index++) {
    const difference = (current[index] ?? 0) - (minimum[index] ?? 0);
    if (difference) return difference > 0;
  }
  return true;
}

export function backendInfo(result) {
  return { version: typeof result.backendVersion === 'string' ? result.backendVersion : '', checkedAt: new Date().toISOString() };
}
