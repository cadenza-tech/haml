// haml-lint version parsing and feature gates. Pure; no vscode imports.

export type SemVerTriple = readonly [number, number, number];

/** HAML-level autocorrect (not just RuboCop cops) landed in 0.74.0. */
export const MIN_HAML_AUTOCORRECT: SemVerTriple = [0, 74, 0];

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

/** Extracts the first x.y.z from `haml-lint --version` output. Returns null when absent. */
export function parseVersion(text: unknown): SemVerTriple | null {
  if (typeof text !== 'string') {
    return null;
  }
  const match = VERSION_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `a` is the same as or newer than `b`. */
export function gte(a: SemVerTriple, b: SemVerTriple): boolean {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) {
    return aMajor > bMajor;
  }
  if (aMinor !== bMinor) {
    return aMinor > bMinor;
  }
  return aPatch >= bPatch;
}

export function supportsHamlAutocorrect(version: SemVerTriple | null): boolean {
  return version !== null && gte(version, MIN_HAML_AUTOCORRECT);
}
