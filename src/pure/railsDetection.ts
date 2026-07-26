// Decides whether a document belongs to a Rails project, for `haml.snippets.rails: "auto"`.

import { type FsDeps, findUpwards, lockfileListsGem, pathApi } from './fsWalk';

/** rails as Bundler writes it into the specs section of Gemfile.lock. */
const GEMFILE_LOCK_RAILS = /^\s+rails \(/m;
export const APPLICATION_RB_SEGMENTS = ['config', 'application.rb'];

export interface RailsDetectionInput {
  /** Absolute path of the document. Callers must have already excluded non-file schemes. */
  readonly documentPath: string;
  readonly workspaceFolderPath?: string;
}

/**
 * Two signals, because neither alone is enough: an app generated with --skip-bundle has no lock
 * file, and an engine's dummy app has no config/application.rb at the level being searched.
 */
export function detectRails(input: RailsDetectionInput, deps: FsDeps): boolean {
  const p = pathApi(deps.platform);
  const documentDirectory = p.dirname(input.documentPath);
  const boundary = input.workspaceFolderPath ?? documentDirectory;

  const found = findUpwards(
    documentDirectory,
    boundary,
    (directory) => {
      if (deps.fileExists(p.join(directory, ...APPLICATION_RB_SEGMENTS))) {
        return true;
      }
      return lockfileListsGem(directory, GEMFILE_LOCK_RAILS, deps);
    },
    deps.platform
  );
  return found !== null;
}
