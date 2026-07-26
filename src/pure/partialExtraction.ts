// Works out what "extract this selection into a partial" produces: the new file, its contents, and
// the render call that replaces the selection.
//
// Nothing here touches the filesystem, so the caller decides what to do about a name that is already
// taken. Locals are deliberately not derived: doing it honestly means parsing the Ruby in the
// selection, and getting it wrong would silently change what the view renders.

import { pathApi } from './fsWalk';
import { commonIndent, dedentLines, type LineRange, linesOf } from './lineRange';
import { parseTemplateFileName, splitPartialName, toPosixPath, underscoredStem } from './partialPaths';
import type { DocumentSnapshot, Eol, TextEditSpec } from './textModel';

/** What Rails accepts as one segment of a partial name, and therefore all this accepts. */
const SEGMENT = /^[a-z_][a-z0-9_]*$/;
/** The class or id shorthand a suggestion can be read from. */
const SHORTHAND = /^[.#]([a-z0-9_-]+)/;
const DEFAULT_SUFFIX = '.haml';

export interface PartialExtractionInput {
  /** Absolute path of the document the selection comes from. */
  readonly documentPath: string;
  /** Result of findViewsRoot. Null puts the partial beside the document. */
  readonly viewsRoot: string | null;
  /** Validated with validatePartialName before it gets here. */
  readonly partialName: string;
  readonly range: LineRange;
}

export interface PartialExtraction {
  readonly filePath: string;
  /** The string to write in the render call. Always '/'-separated, whatever the platform. */
  readonly renderPath: string;
  /** Normalised to column zero and terminated with a newline. */
  readonly partialText: string;
  readonly replacement: TextEditSpec;
}

/** An initial value for the name prompt, or '' when the first line suggests nothing usable. */
export function suggestPartialName(firstLine: string): string {
  const match = SHORTHAND.exec(firstLine.trimStart());
  if (match === null) {
    return '';
  }
  const token = match[1] as string;
  // Offering a name the validator would reject the instant the box opens is worse than offering
  // none - so the validator itself is the test.
  return validatePartialName(token) === null ? token : '';
}

/**
 * Null when the name is usable, otherwise the message to show in the prompt.
 *
 * An empty name passes: this doubles as the InputBox validator, and the box opens empty whenever the
 * first line suggests nothing, where greeting the user with an error would be rude. The caller rejects
 * it after the box closes instead.
 */
export function validatePartialName(name: string): string | null {
  if (name === '') {
    return null;
  }
  if (name.trim() !== name) {
    return 'A partial name cannot start or end with whitespace.';
  }
  // Every segment is checked, which is what keeps `..` and an absolute path out: this name becomes a
  // filesystem path directly.
  if (!name.split('/').every((segment) => SEGMENT.test(segment))) {
    return 'Use lowercase letters, digits and underscores, separated by /, as Rails requires of a partial.';
  }
  // `_` alone survives SEGMENT but names a file no render call can address: the underscore is the
  // prefix Rails adds, so the name under it is empty and `render '_'` asks for `__`.
  if (name.split('/').pop() === '_') {
    return 'A partial name needs more than the underscore prefix.';
  }
  return null;
}

/**
 * Whether a submitted name may actually be used.
 *
 * The empty name is rejected here rather than in validatePartialName, which has to let it pass so
 * the input box does not open with an error already showing. Keeping both halves of the contract in
 * this module is what stops the glue from restating one of them.
 */
export function isSubmittablePartialName(name: string): boolean {
  return name !== '' && validatePartialName(name) === null;
}

export function buildPartialExtraction(
  input: PartialExtractionInput,
  document: DocumentSnapshot,
  eol: Eol,
  platform: NodeJS.Platform
): PartialExtraction {
  const p = pathApi(platform);
  const documentDirectory = p.dirname(input.documentPath);
  const { stem, prefixSegments } = splitPartialName(input.partialName);

  const directory = prefixSegments.length > 0 ? p.join(input.viewsRoot ?? documentDirectory, ...prefixSegments) : documentDirectory;
  // The document's own suffix, so a turbo_stream template extracts into a turbo_stream partial.
  const fileName = `${underscoredStem(stem)}${parseTemplateFileName(p.basename(input.documentPath)).suffix || DEFAULT_SUFFIX}`;

  // Rails prepends `_` to the last segment of a render name before looking the file up, so the name
  // in the render call must not carry the underscore the file name does: `render 'posts/_card'`
  // would send Rails to `posts/__card`. Derived from the same stem as the file name so the two can
  // never disagree, and never empty: validatePartialName rejects a stem of `_` alone.
  const renderStem = underscoredStem(stem).slice(1);

  // Always fully qualified: Rails resolves a bare `render 'card'` against the controller's prefix, not
  // against the template's directory, so a bare name would point somewhere else than it reads.
  let renderPath: string;
  if (prefixSegments.length > 0) {
    renderPath = [...prefixSegments, renderStem].join('/');
  } else if (input.viewsRoot === null) {
    renderPath = renderStem;
  } else {
    const relative = p.relative(input.viewsRoot, documentDirectory);
    renderPath = relative === '' ? renderStem : `${toPosixPath(relative, p)}/${renderStem}`;
  }

  const lines = linesOf(input.range, document);
  return {
    filePath: p.join(directory, fileName),
    renderPath,
    // The trailing newline keeps haml-lint's FinalNewline linter quiet on the new file.
    partialText: `${dedentLines(lines).join(eol)}${eol}`,
    replacement: {
      start: { line: input.range.startLine, character: 0 },
      // The end of the last line rather than the start of the next, so a document with no final
      // newline does not grow one.
      end: { line: input.range.endLine, character: document.lineAt(input.range.endLine).text.length },
      newText: `${commonIndent(lines)}= render '${renderPath}'`
    }
  };
}
