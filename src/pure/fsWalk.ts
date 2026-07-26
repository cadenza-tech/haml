// Upward directory search shared by the haml-lint invocation resolver and the Rails detector.
//
// Lives here rather than in src/hamlLint so that src/pure never depends on it: the dependency
// direction is hamlLint -> pure, and src/test/pure/boundary.test.ts only checks for vscode imports,
// so a reversed edge would go unnoticed.

import * as nodePath from 'node:path';

/** Guards against pathological symlink loops when no boundary is available. */
export const MAX_UPWARD_LEVELS = 32;

export interface FsDeps {
  readonly fileExists: (path: string) => boolean;
  readonly readFile: (path: string) => string | null;
  /**
   * File names inside a directory, or null when it cannot be read. Optional because only partial
   * resolution lists directories; every other consumer probes known paths.
   */
  readonly readDirectory?: (path: string) => readonly string[] | null;
  readonly platform: NodeJS.Platform;
}

export function pathApi(platform: NodeJS.Platform): nodePath.PlatformPath {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/**
 * Walks up from `start`, stopping once `boundary` has been examined (or at the filesystem root when
 * there is no boundary), and returns the first directory for which `predicate` holds.
 */
export function findUpwards(
  start: string,
  boundary: string | undefined,
  predicate: (directory: string) => boolean,
  platform: NodeJS.Platform = process.platform
): string | null {
  const p = pathApi(platform);
  let current = start;
  for (let level = 0; level < MAX_UPWARD_LEVELS; level++) {
    if (predicate(current)) {
      return current;
    }
    if (boundary !== undefined && current === boundary) {
      return null;
    }
    const parent = p.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

export const GEMFILE_LOCK_NAME = 'Gemfile.lock';

/**
 * True when `directory` holds a Gemfile.lock whose specs section lists the gem.
 *
 * Both consumers ask this of the same file and both must read an unreadable lock file as "no": the
 * invocation resolver decides whether `bundle exec` can work at all, the Rails detector whether this
 * is a Rails app. `gemPattern` must carry no /g or /y flag, so `test` stays stateless across
 * directories.
 *
 * Only the per-directory predicate is shared, not the walk: railsDetection makes one pass testing
 * two signals per level, and splitting that into two walks would change how often fileExists is
 * called without changing the answer.
 */
export function lockfileListsGem(directory: string, gemPattern: RegExp, deps: FsDeps): boolean {
  const lockPath = pathApi(deps.platform).join(directory, GEMFILE_LOCK_NAME);
  if (!deps.fileExists(lockPath)) {
    return false;
  }
  const contents = deps.readFile(lockPath);
  return contents !== null && gemPattern.test(contents);
}
