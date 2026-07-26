// The Rails snippet set offered by the completion provider, and the rule that gates it.
//
// These are not contributed through `contributes.snippets` because that contribution point accepts
// only `language` and `path` - it has no `when` clause, so a settings toggle is impossible. A
// CompletionItemProvider is the only mechanism that can be turned off.

import type { RailsSnippet, RailsSnippetsMode } from '../types';
import { UPSTREAM_RAILS_SNIPPETS } from './railsSnippetsUpstream';

/**
 * Helpers the 2016-2022 upstream predates.
 *
 * Every prefix here is a string a Rails developer actually types and is free of collisions with the
 * upstream set. Coined prefixes such as `link_to_turbo_method` were deliberately left out: nobody
 * reaches for them, and `link_to` already covers adding a `data:` option.
 */
export const MODERN_RAILS_SNIPPETS: readonly RailsSnippet[] = [
  { prefix: 'form_with', body: '= form_with model: ${1:record} do |${2:form}|\n  $3', detail: 'form_with (model)' },
  { prefix: 'form_with_url', body: '= form_with url: ${1:path} do |${2:form}|\n  $3', detail: 'form_with (url)' },
  { prefix: 'turbo_frame_tag', body: '= turbo_frame_tag ${1:id} do\n  $2', detail: 'turbo_frame_tag block' },
  { prefix: 'turbo_frame_tag_src', body: '= turbo_frame_tag ${1:id}, src: ${2:path}', detail: 'turbo_frame_tag with src' },
  { prefix: 'turbo_stream_from', body: '= turbo_stream_from ${1:stream}', detail: 'turbo_stream_from' },
  { prefix: 'dom_id', body: '= dom_id(${1:record})', detail: 'dom_id' },
  { prefix: 'dom_class', body: '= dom_class(${1:record})', detail: 'dom_class' },
  { prefix: 'rich_text_area', body: '= rich_text_area ${1:object}, ${2:method}', detail: 'rich_text_area' },
  { prefix: 'f.rich_text_area', body: '= f.rich_text_area ${1:method}', detail: 'form.rich_text_area' },
  { prefix: 'tag.div', body: "= tag.${1:div} ${2:content}${3:, class: '$4'}", detail: 'tag builder' },
  { prefix: 'tag.div_block', body: "= tag.${1:div}${2:, class: '$3'} do\n  $4", detail: 'tag builder block' },
  { prefix: 'csp_meta_tag', body: '= csp_meta_tag', detail: 'csp_meta_tag' },
  { prefix: 'preload_link_tag', body: '= preload_link_tag ${1:source}', detail: 'preload_link_tag' },
  { prefix: 'javascript_importmap_tags', body: '= javascript_importmap_tags', detail: 'javascript_importmap_tags' },
  { prefix: 'render_layout', body: "= render layout: '${1:layout}' do\n  $2", detail: 'render layout block' },
  {
    prefix: 'render_collection_cached',
    body: "= render partial: '${1:partial}', collection: ${2:collection}, cached: true",
    detail: 'render cached collection'
  },
  { prefix: 'translate_scoped', body: "= t('.${1:key}')", detail: 'translate (lazy lookup)' },
  { prefix: 'sanitize_allowlist', body: '= sanitize ${1:html}, tags: %w[${2:p br}], attributes: %w[${3:href}]', detail: 'sanitize with an allowlist' }
];

export const RAILS_SNIPPETS: readonly RailsSnippet[] = [...UPSTREAM_RAILS_SNIPPETS, ...MODERN_RAILS_SNIPPETS];

/**
 * `isRails` is a thunk on purpose: resolving it walks up to 32 directories doing existsSync, and
 * someone who set "off" should never pay for that.
 */
export function shouldOfferRailsSnippets(mode: RailsSnippetsMode, isRails: () => boolean): boolean {
  if (mode === 'off') {
    return false;
  }
  if (mode === 'on') {
    return true;
  }
  return isRails();
}
