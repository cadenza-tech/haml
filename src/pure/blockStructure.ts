// Where a Haml block starts and ends, for the edits that must not cut one in half. Pure; no vscode
// imports.
//
// A block is a line plus every line indented deeper - except that Ruby's mid-block keywords sit at
// the opener's own indent and still belong to it:
//
//   - if a
//     %p x
//   - else          <- indent 0, same as `- if`, and not a sibling
//     %p y
//
// Reading the block as ending before `- else` is what put a `-# haml-lint:enable` comment between an
// `if` body and its `else`, which Haml rejects ("Got else with no preceding if"), and what let
// Split to Partial leave the `- else` behind. Checked against haml 6.4: a silent comment is also a
// syntax error between `- begin` and `- rescue` and between `- case` and its first `- when`, and
// between two `- when`s it renders nothing at all without saying why. Around the whole construct it
// is harmless, so both ends move outwards to the construct.

import { isBlankText } from './characters';
import type { DocumentSnapshot } from './textModel';

/**
 * `- in` is left out although Ruby has it: Haml itself does not compile `case`/`in`. The lookahead
 * keeps `- else_branch = 1` and `- when_ready` ordinary script lines.
 */
const CONTINUATION = /^[ \t]*-[ \t]*(else|elsif|when|rescue|ensure)(?![\w?!])/;
/** Haml's own START_BLOCK_KEYWORD_REGEX takes an assignment in front of the keyword: `- y = case x`. */
const CASE_OPENER = /^[ \t]*[-=][ \t]*(?:[@$]?\w+(?:[ \t]*,[ \t]*[@$]?\w+)*[ \t]*=[ \t]*)?case(?![\w?!])/;

function continuationKeyword(text: string): string | null {
  return CONTINUATION.exec(text)?.[1] ?? null;
}

/**
 * The last line of the block that reaches `lastLine` at `indent`: every following line indented
 * deeper, and every mid-block keyword at exactly that indent with what it holds.
 *
 * Blank lines never end a block on their own - they are only excluded when nothing of the block
 * follows - so a stanza split by an empty line stays intact. An infinite `indent`, which is what a
 * blank target has, extends over nothing.
 */
export function extendBlock(lastLine: number, indent: number, document: DocumentSnapshot): number {
  let blockEnd = lastLine;
  for (let index = lastLine + 1; index < document.lineCount; index++) {
    const line = document.lineAt(index);
    if (isBlankText(line.text)) {
      continue;
    }
    const lineIndent = line.firstNonWhitespaceCharacterIndex;
    if (lineIndent < indent || (lineIndent === indent && continuationKeyword(line.text) === null)) {
      break;
    }
    blockEnd = index;
  }
  return blockEnd;
}

/**
 * The line that opens the construct `lineIndex` continues, or `lineIndex` itself when it continues
 * none.
 *
 * The opener is normally the nearest line above at the same indent that is not itself a mid-block
 * keyword. A `case` is the exception: Haml takes `- when` one level under `- case` as well as beside
 * it, and once it has, the `- else` of that case sits at the nested level too - so for those two a
 * shallower `case` is the opener. Any other shallower line means the document is not what it looks
 * like, and nothing is moved.
 */
export function findBlockStart(lineIndex: number, document: DocumentSnapshot): number {
  const target = document.lineAt(lineIndex);
  const keyword = continuationKeyword(target.text);
  if (keyword === null) {
    return lineIndex;
  }
  const indent = target.firstNonWhitespaceCharacterIndex;
  for (let index = lineIndex - 1; index >= 0; index--) {
    const line = document.lineAt(index);
    if (isBlankText(line.text) || line.firstNonWhitespaceCharacterIndex > indent) {
      continue;
    }
    if (line.firstNonWhitespaceCharacterIndex < indent) {
      return (keyword === 'when' || keyword === 'else') && CASE_OPENER.test(line.text) ? index : lineIndex;
    }
    if (continuationKeyword(line.text) === null) {
      return index;
    }
  }
  return lineIndex;
}
