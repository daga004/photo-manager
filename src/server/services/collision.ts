/**
 * Allocates a filename that is free within a destination directory. Given the
 * candidate name and the set of names already present, returns the candidate
 * unchanged if free, otherwise inserts a `__dupN` suffix before the extension
 * (incrementing N) until an unused name is found.
 *
 * This is purely about filename uniqueness — it does NOT decide duplicate-ness.
 * By the time placement reaches here, true content-duplicates have already been
 * caught and quarantined by placeAndIndex's verified global fingerprint check,
 * so any same-name clash at this point is guaranteed to be *different* content
 * that simply needs a distinct name.
 */
export function allocateFilename(candidateFilename: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  if (!taken.has(candidateFilename)) return candidateFilename;

  const dotIdx = candidateFilename.lastIndexOf(".");
  const base = dotIdx === -1 ? candidateFilename : candidateFilename.slice(0, dotIdx);
  const ext = dotIdx === -1 ? "" : candidateFilename.slice(dotIdx);

  let n = 2;
  while (taken.has(`${base}__dup${n}${ext}`)) n++;
  return `${base}__dup${n}${ext}`;
}
