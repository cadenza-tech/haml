// The data attributes Rails and Hotwire define, rendered for each of the three Haml notations.
//
// A static dictionary, deliberately. Reading Stimulus controllers off disk to offer their target and
// value names would mean parsing JavaScript and keeping an index warm, and the payoff is small: the
// attributes worth completing are the framework's own, where a typo fails silently at runtime.
//
// The rendered forms are built once at load, the same way SNIPPET_STRINGS is in src/completions.ts,
// because provideCompletionItems runs synchronously on every keystroke.

import type { AttributeSyntax, DataAttribute, DataAttributeCompletion } from '../types';

const DATA_PREFIX = 'data-';

/**
 * Sorted by name within each source so the list is diffable.
 *
 * Stimulus contributes only its two fixed attributes: `data-<controller>-target` and friends are named
 * per controller, so a pattern label would never fuzzy-match what the user actually types.
 */
export const DATA_ATTRIBUTES: readonly DataAttribute[] = [
  { name: 'data-confirm', source: 'Rails UJS', description: 'Ask for confirmation with this message before following the link.' },
  { name: 'data-disable', source: 'Rails UJS', description: 'Disable the element while the request is in flight.', valueless: true },
  { name: 'data-disable-with', source: 'Rails UJS', description: 'Disable the submit button and show this text while submitting.' },
  { name: 'data-method', source: 'Rails UJS', description: 'Send the request with this HTTP method instead of GET.' },
  { name: 'data-params', source: 'Rails UJS', description: 'Extra parameters to send with a non-GET request.' },
  { name: 'data-remote', source: 'Rails UJS', description: 'Submit the form or follow the link over XHR.' },
  { name: 'data-type', source: 'Rails UJS', description: 'The data type to expect back from a remote request.' },
  { name: 'data-url', source: 'Rails UJS', description: 'The URL a remote request should go to.' },
  { name: 'data-action', source: 'Stimulus', description: 'Route a DOM event to a controller method, as event->controller#method.' },
  { name: 'data-controller', source: 'Stimulus', description: 'Attach one or more Stimulus controllers to this element.' },
  { name: 'data-turbo', source: 'Turbo', description: 'Set to false to opt this element out of Turbo Drive.' },
  { name: 'data-turbo-action', source: 'Turbo', description: 'How the visit changes history: advance or replace.' },
  { name: 'data-turbo-cache', source: 'Turbo', description: 'Set to false to keep this page out of the Turbo cache.' },
  { name: 'data-turbo-confirm', source: 'Turbo', description: 'Ask for confirmation with this message before visiting or submitting.' },
  { name: 'data-turbo-eval', source: 'Turbo', description: 'Set to false to stop Turbo re-evaluating this script on a visit.' },
  { name: 'data-turbo-frame', source: 'Turbo', description: 'Target this Turbo Frame, or _top to replace the whole page.' },
  { name: 'data-turbo-method', source: 'Turbo', description: 'Visit with this HTTP method instead of GET.' },
  { name: 'data-turbo-permanent', source: 'Turbo', description: 'Keep this element and its state across Turbo visits.', valueless: true },
  { name: 'data-turbo-prefetch', source: 'Turbo', description: 'Set to false to stop Turbo prefetching this link on hover.' },
  { name: 'data-turbo-preload', source: 'Turbo', description: 'Preload this link into the Turbo cache.', valueless: true },
  { name: 'data-turbo-stream', source: 'Turbo', description: 'Let this link or form accept a Turbo Stream response.', valueless: true },
  { name: 'data-turbo-submits-with', source: 'Turbo', description: 'Text to show on the submit button while the form is submitting.' },
  { name: 'data-turbo-temporary', source: 'Turbo', description: 'Remove this element before the page is cached.', valueless: true },
  { name: 'data-turbo-track', source: 'Turbo', description: 'Set to reload to prompt a full reload when this asset changes.' }
];

/**
 * Teaches the notation rather than a name: the HTML specification defines no data-* names at all.
 *
 * Absent from rubyDataHash on purpose - inside a `data:` hash every key is already free-form, so there
 * is nothing left to demonstrate.
 */
const GENERIC: Readonly<Record<AttributeSyntax, DataAttributeCompletion | null>> = {
  htmlAttributes: {
    label: DATA_PREFIX,
    body: 'data-${1:name}="$2"',
    detail: 'HTML',
    documentation: 'A custom data attribute of your own.'
  },
  rubyHash: {
    label: DATA_PREFIX,
    body: "'data-${1:name}': '$2'",
    detail: 'HTML',
    documentation: 'A custom data attribute of your own.'
  },
  rubyDataHash: null
};

function render(attribute: DataAttribute, syntax: AttributeSyntax): DataAttributeCompletion {
  // Haml turns an underscore in a nested data: hash key into a dash, so that is how the key is written.
  const nested = attribute.name.slice(DATA_PREFIX.length).replace(/-/g, '_');
  const label = syntax === 'rubyDataHash' ? nested : attribute.name;
  let body: string;
  if (syntax === 'htmlAttributes') {
    body = attribute.valueless === true ? label : `${label}="$1"`;
  } else if (syntax === 'rubyHash') {
    // Always single quotes, whatever the user typed, so the extension emits one style.
    body = attribute.valueless === true ? `'${label}': true` : `'${label}': '$1'`;
  } else {
    body = attribute.valueless === true ? `${label}: true` : `${label}: '$1'`;
  }
  return { label, body, detail: attribute.source, documentation: attribute.description };
}

function completionsFor(syntax: AttributeSyntax): readonly DataAttributeCompletion[] {
  const rendered = DATA_ATTRIBUTES.map((attribute) => render(attribute, syntax));
  const generic = GENERIC[syntax];
  return generic === null ? rendered : [...rendered, generic];
}

export const DATA_ATTRIBUTE_COMPLETIONS: Readonly<Record<AttributeSyntax, readonly DataAttributeCompletion[]>> = {
  htmlAttributes: completionsFor('htmlAttributes'),
  rubyHash: completionsFor('rubyHash'),
  rubyDataHash: completionsFor('rubyDataHash')
};
