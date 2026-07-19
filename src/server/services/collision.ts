export interface ExistingEntry {
  name: string;
  hash: string;
}

export type CollisionResult =
  | { kind: "duplicate"; matchedName: string }
  | { kind: "place"; filename: string };

/**
 * Decides what to do when placing `candidateFilename` into a destination
 * directory that may already contain a file of the same name:
 *  - if an existing entry has the same name AND the same content hash, this
 *    is a true duplicate — caller should quarantine the source, not copy it.
 *  - if an existing entry has the same name but a DIFFERENT hash, disambiguate
 *    by inserting a `__dupN` suffix before the extension, retrying until a
 *    free (or same-hash) name is found.
 *  - otherwise the original name is free to use as-is.
 */
export function resolveCollision(
  candidateFilename: string,
  candidateHash: string,
  existingEntries: ExistingEntry[],
): CollisionResult {
  const existingByName = new Map(existingEntries.map((e) => [e.name, e.hash]));

  const existingHash = existingByName.get(candidateFilename);
  if (existingHash === undefined) {
    return { kind: "place", filename: candidateFilename };
  }
  if (existingHash === candidateHash) {
    return { kind: "duplicate", matchedName: candidateFilename };
  }

  const dotIdx = candidateFilename.lastIndexOf(".");
  const base = dotIdx === -1 ? candidateFilename : candidateFilename.slice(0, dotIdx);
  const ext = dotIdx === -1 ? "" : candidateFilename.slice(dotIdx);

  let n = 2;
  let candidate = `${base}__dup${n}${ext}`;
  while (existingByName.has(candidate)) {
    if (existingByName.get(candidate) === candidateHash) {
      return { kind: "duplicate", matchedName: candidate };
    }
    n++;
    candidate = `${base}__dup${n}${ext}`;
  }
  return { kind: "place", filename: candidate };
}
