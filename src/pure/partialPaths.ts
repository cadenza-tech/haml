// Turns a partial name from a `render` call into the file it names, and back again.
//
// Rails resolves a partial through its lookup context: a name with a slash is relative to the view
// root, a bare name to the prefixes of whichever controller renders the view - its own directory,
// then what it inherits, `application` last. Which controller that is cannot be read off a file, so
// for a bare name this guesses: beside the document, which is right for a view in its controller's
// own directory, then `application`. `prepend_view_path` and an engine's view path chain are out of
// reach as well without booting the app.

import type * as nodePath from 'node:path';
import { type FsDeps, findUpwards, pathApi } from './fsWalk';

/** Template handlers, most specific to this extension first. Also the tail of the completion glob. */
const PARTIAL_HANDLERS: readonly string[] = ['haml', 'erb'];

const VIEWS_DIRECTORY = 'views';
const APP_DIRECTORY = 'app';
/** The prefix every controller inherits from ApplicationController. */
const APPLICATION_PREFIX = 'application';
const DEFAULT_FORMAT = 'html';

/**
 * Names that cannot address a partial, and must never reach the filesystem: whitespace, a backslash,
 * an interpolation this module cannot evaluate, an absolute name, and any traversal segment.
 */
const UNRESOLVABLE_NAME = /[\s\\]|#\{|^\/|(^|\/)\.\.(\/|$)/;

export interface PartialLookup {
  /** Absolute path of the document holding the render call. */
  readonly documentPath: string;
  /** Result of findViewsRoot. Null falls back to the document's own directory. */
  readonly viewsRoot: string | null;
  /** The literal as written, e.g. 'shared/foo'. */
  readonly name: string;
}

export interface PartialGlobInput {
  readonly workspaceFolderPath: string;
  readonly viewsRoot: string | null;
  readonly documentDirectory: string;
}

/** A glob and a Rails partial name are posix whatever platform the path came from. */
export function toPosixPath(value: string, p: nodePath.PlatformPath): string {
  return value.split(p.sep).join('/');
}

export interface PartialNameParts {
  /** The last segment: `foo` in `shared/foo`. */
  readonly stem: string;
  /** Everything before it: `['shared']`. Empty for a bare name. */
  readonly prefixSegments: readonly string[];
}

/** Splits a name as written in a render call. Always '/'-separated: this is a Rails string. */
export function splitPartialName(name: string): PartialNameParts {
  const segments = name.split('/');
  return { stem: segments[segments.length - 1] as string, prefixSegments: segments.slice(0, -1) };
}

/**
 * The file prefix for a user-typed partial name: `_foo` from both `foo` and `_foo`.
 *
 * Prompt leniency only - naming the file in the Split to Partial box, both spellings of the on-disk
 * name mean the same file. A render-call name is a different thing: Rails prepends `_` to it
 * unconditionally (`render '_foo'` looks up `__foo`), which is what partialSearch mirrors.
 */
export function underscoredStem(stem: string): string {
  return stem.startsWith('_') ? stem : `_${stem}`;
}

export interface TemplateFileName {
  /** Before the first dot, without a leading underscore: `_foo.html.haml` gives `foo`. */
  readonly stem: string;
  /** From the first dot, or '' when there is none: `.html.haml`. */
  readonly suffix: string;
  /** The segment before the handler, or null: `html` from `_foo.html.haml`, null from `_foo.haml`. */
  readonly format: string | null;
}

/** Parses `name.format.handler`, which three call sites were each doing with indexOf('.'). */
export function parseTemplateFileName(fileName: string): TemplateFileName {
  const withoutUnderscore = fileName.startsWith('_') ? fileName.slice(1) : fileName;
  const firstDot = withoutUnderscore.indexOf('.');
  if (firstDot === -1) {
    return { stem: withoutUnderscore, suffix: '', format: null };
  }
  const suffix = withoutUnderscore.slice(firstDot);
  const dotted = withoutUnderscore.slice(firstDot + 1).split('.');
  // Second to last, so `a.b.c.haml` still yields `c`.
  return { stem: withoutUnderscore.slice(0, firstDot), suffix, format: dotted.length >= 2 ? (dotted[dotted.length - 2] as string) : null };
}

function isInside(relative: string, p: nodePath.PlatformPath): boolean {
  return relative !== '..' && !relative.startsWith(`..${p.sep}`) && !p.isAbsolute(relative);
}

/**
 * The format segment of the document's own name: `index.turbo_stream.haml` gives `turbo_stream`.
 *
 * Rails resolves a partial in the format of the template asking for it, so deriving the search order
 * from the document rather than hard-coding html is what keeps that order from being arbitrary.
 */
function documentFormat(documentPath: string, p: nodePath.PlatformPath): string | null {
  return parseTemplateFileName(p.basename(documentPath)).format;
}

/**
 * The app/views directory containing `documentPath`.
 *
 * The predicate reads directory names only, so this costs no filesystem calls at all and cannot be
 * fooled the way a marker file can - which is why, unlike detectRails, it keeps walking when there is
 * no workspace folder to stop at. An engine's app/views and a dummy app's both win over an outer one
 * because findUpwards returns the first match walking up.
 */
export function findViewsRoot(documentPath: string, workspaceFolderPath: string | undefined, platform: NodeJS.Platform): string | null {
  const p = pathApi(platform);
  return findUpwards(
    p.dirname(documentPath),
    workspaceFolderPath,
    (directory) => p.basename(directory) === VIEWS_DIRECTORY && p.basename(p.dirname(directory)) === APP_DIRECTORY,
    platform
  );
}

interface PartialSearch {
  /** The directories Rails would look in, most specific first. */
  readonly directories: readonly string[];
  /** `_foo` - what a matching file name starts with. */
  readonly underscored: string;
  /** Format preference, best first; '' is the formatless `_foo.haml` shape. */
  readonly formats: readonly string[];
}

/** Where and what to look for, shared by the exact candidates and the listing fallback. */
function partialSearch(lookup: PartialLookup, platform: NodeJS.Platform): PartialSearch | null {
  if (lookup.name === '' || UNRESOLVABLE_NAME.test(lookup.name)) {
    return null;
  }
  const p = pathApi(platform);
  const documentDirectory = p.dirname(lookup.documentPath);
  const { stem, prefixSegments } = splitPartialName(lookup.name);

  const directories: string[] = [];
  if (prefixSegments.length > 0) {
    directories.push(p.join(lookup.viewsRoot ?? documentDirectory, ...prefixSegments));
  } else {
    directories.push(documentDirectory);
    if (lookup.viewsRoot !== null) {
      directories.push(p.join(lookup.viewsRoot, APPLICATION_PREFIX));
    }
  }

  return {
    directories,
    // Unconditionally, the way Rails does: `render 'x/_foo'` looks up `x/__foo`, never `x/_foo`.
    // Resolving the underscored spelling to `_foo` would navigate a line that raises
    // MissingTemplate at runtime - the leniency that masked exactly such a bug in Split to Partial.
    underscored: `_${stem}`,
    formats: [documentFormat(lookup.documentPath, p) ?? DEFAULT_FORMAT, DEFAULT_FORMAT, '']
  };
}

/** Every path Rails would try, in order. Empty when the name cannot address a partial. */
export function partialCandidatePaths(lookup: PartialLookup, platform: NodeJS.Platform): readonly string[] {
  const search = partialSearch(lookup, platform);
  if (search === null) {
    return [];
  }
  const p = pathApi(platform);

  const fileNames: string[] = [];
  for (const handler of PARTIAL_HANDLERS) {
    for (const format of search.formats) {
      const fileName = format === '' ? `${search.underscored}.${handler}` : `${search.underscored}.${format}.${handler}`;
      if (!fileNames.includes(fileName)) {
        fileNames.push(fileName);
      }
    }
  }

  const candidates: string[] = [];
  for (const directory of search.directories) {
    for (const fileName of fileNames) {
      candidates.push(p.join(directory, fileName));
    }
  }
  return candidates;
}

/**
 * A directory-listing match for names the fixed candidates cannot enumerate.
 *
 * Rails inserts locale and variant segments between the format and the stem - `_foo.en.html.haml`,
 * `_foo.html+phone.erb` - and the completion side offers such files as plain `foo`, so go to
 * definition has to resolve what completion inserted. Ranked the same way the exact candidates are
 * ordered: directory first, then handler, then format preference, with the file name as a
 * deterministic tie-break.
 */
function resolveByListing(search: PartialSearch, deps: FsDeps): string | null {
  const readDirectory = deps.readDirectory;
  if (readDirectory === undefined) {
    return null;
  }
  const p = pathApi(deps.platform);
  for (const directory of search.directories) {
    const entries = readDirectory(directory);
    if (entries === null) {
      continue;
    }
    let bestName: string | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      if (!entry.startsWith(`${search.underscored}.`)) {
        continue;
      }
      const handlerRank = PARTIAL_HANDLERS.indexOf(entry.slice(entry.lastIndexOf('.') + 1));
      if (handlerRank === -1) {
        continue;
      }
      const parsed = parseTemplateFileName(entry);
      const formatIndex = search.formats.indexOf(parsed.format ?? '');
      const formatRank = formatIndex === -1 ? search.formats.length : formatIndex;
      const rank = handlerRank * (search.formats.length + 1) + formatRank;
      if (rank < bestRank || (rank === bestRank && bestName !== null && entry < bestName)) {
        bestRank = rank;
        bestName = entry;
      }
    }
    if (bestName !== null) {
      return p.join(directory, bestName);
    }
  }
  return null;
}

/**
 * The file a partial name resolves to, or null.
 *
 * Rails has one answer, so this stops at the first candidate that exists rather than collecting them.
 * Shaped like detectRails so that the filesystem stays injected and the ordering stays unit-testable.
 * The exact candidates keep priority; the listing fallback runs only after all of them missed.
 */
export function resolvePartialPath(lookup: PartialLookup, deps: FsDeps): string | null {
  for (const candidate of partialCandidatePaths(lookup, deps.platform)) {
    if (deps.fileExists(candidate)) {
      return candidate;
    }
  }
  const search = partialSearch(lookup, deps.platform);
  return search === null ? null : resolveByListing(search, deps);
}

/** The workspace-folder-relative glob for findFiles, or null when the base is outside the folder. */
export function partialGlob(input: PartialGlobInput, platform: NodeJS.Platform): string | null {
  const p = pathApi(platform);
  const base = input.viewsRoot ?? input.documentDirectory;
  const relative = p.relative(input.workspaceFolderPath, base);
  if (!isInside(relative, p)) {
    return null;
  }
  const prefix = relative === '' ? '' : `${toPosixPath(relative, p)}/`;
  // Only a views root is worth descending into; a fallback directory is searched on its own.
  const descend = input.viewsRoot === null ? '' : '**/';
  return `${prefix}${descend}_*.{${PARTIAL_HANDLERS.join(',')}}`;
}

/** The name to write in a render call for a partial file, or null when it is outside `base`. */
export function partialRootRelativeName(partialPath: string, base: string, platform: NodeJS.Platform): string | null {
  const p = pathApi(platform);
  const relative = p.relative(base, partialPath);
  if (relative === '' || !isInside(relative, p)) {
    return null;
  }
  const directory = p.dirname(relative);
  const { stem } = parseTemplateFileName(p.basename(relative));
  // Always forward slashes: this is a Rails string, not a path.
  return directory === '.' ? stem : `${toPosixPath(directory, p)}/${stem}`;
}

export interface PartialCompletionCandidate {
  /** The path it came from, so the caller can map back to its uri for the detail line. */
  readonly path: string;
  readonly label: string;
  /** A partial beside the document is the likeliest one to be wanted, so it sorts first. */
  readonly sortText: string;
}

/**
 * Turns the paths findFiles returned into the labels a render call would accept.
 *
 * Always the name relative to the views root, a partial beside the document included. Rails looks a
 * name without a slash up under the rendering controller's prefixes, not beside the template that
 * wrote it, so the bare name only works from a view in that controller's own directory - and which
 * controller renders a view is not something this can know. partialExtraction writes the same form.
 *
 * Deduplicated by label rather than by path: a `.haml` and an `.erb` of one partial share theirs, and
 * the completion widget would show the same string twice with no way to tell them apart.
 */
export function partialCompletionCandidates(
  paths: readonly string[],
  base: string,
  documentDirectory: string,
  platform: NodeJS.Platform
): readonly PartialCompletionCandidate[] {
  const p = pathApi(platform);
  const candidates: PartialCompletionCandidate[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const rootRelative = partialRootRelativeName(path, base, platform);
    if (rootRelative === null) {
      continue;
    }
    if (seen.has(rootRelative)) {
      continue;
    }
    seen.add(rootRelative);
    const beside = p.dirname(path) === documentDirectory;
    candidates.push({ path, label: rootRelative, sortText: (beside ? '0' : '1') + rootRelative });
  }
  return candidates;
}
