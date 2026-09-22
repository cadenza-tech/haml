// Rails view helper snippets derived from haml-vscode by Karuna Murti (MIT).
//
// Upstream: https://github.com/karuna/haml-vscode
// Vendored commit: 504875f60bcd474f17762b2daf97680476135f79 (snippets/snippets.json)
// See syntaxes/NOTICE.md for the licence and the list of modifications.
//
// Bodies are verbatim apart from the repairs below. The 221 entries here are the upstream 228
// minus the seven whose prefix already exists in src/pure/controlSnippets.ts (if, else, elsif,
// unless, each, yield, content_for), so the two sets never produce duplicate suggestions.
//
// Seven upstream bodies were repaired. VS Code's snippet parser rejects two outright and inserts
// their literal text instead: fields_for had `${:record_object}` (no tab stop number) and
// render_partial_collection had `${7, layout: $8}` (a comma where the parser wants a colon).
// The other five parse, but inserted Ruby that cannot:
//   video_tag            `autobuf.fer:`, a stray dot inside the `autobuffer:` keyword
//   stylesheet_link_tag  `'${1:src}' ${2:media: '$3'}`, no comma before the keyword argument; now
//                        `'${1:src}'${2:, media: '$3'}`, the shape favicon_link_tag already has
//   button_block         `= button ${1:, {\}} do` opened its argument list with the comma; now
//   f.button_block       `= button(${1:{\}}) do`, in parentheses like time_tag_block because a bare
//                        `{}` there is read as a second block
//   select               `${2:method}, ${3:, {\}}` doubled the comma; now `${2:method}${3:, {\}}`,
//                        the head select_block already has
// Three `detail` strings named another helper and were corrected: mail_to_block said
// 'link_to_unless_current block', and collection_radio_buttons and collection_radio_buttons_block
// both said 'form.collection_radio_buttons'.
//
// Generated - do not hand-edit. Regenerate from the pinned commit above, then reapply all of the
// above. src/test/pure/railsSnippets.test.ts fails by name for the comma repairs if one is lost.

import type { RailsSnippet } from '../types';

export const UPSTREAM_RAILS_SNIPPETS: readonly RailsSnippet[] = [
  { prefix: 'html_safe', body: '= $1.html_safe', detail: 'html_safe' },
  { prefix: 'surround', body: "= surround '${1:(}', '${2:)}' do\n  $3", detail: 'surround' },
  { prefix: 'precede', body: "= precede '${1:precede}' do\n  $2", detail: 'precede' },
  { prefix: 'succeed', body: "= succeed '${1:succeed}' do\n  $2", detail: 'succeed' },
  { prefix: 'url_for', body: "= url_for '${1:url}'", detail: 'url_for' },
  { prefix: 'audio_tag', body: '= audio_tag $1', detail: 'audio_tag' },
  { prefix: 'auto_discovery_link_tag', body: '= auto_discovery_link_tag', detail: 'auto_discovery_link_tag' },
  { prefix: 'favicon_link_tag', body: "= favicon_link_tag '${1:src}'${2:, rel: '$3'}${4:, type: '$5'}", detail: 'favicon_link_tag' },
  { prefix: 'image_alt', body: "image_alt('$1')", detail: 'image_alt' },
  { prefix: 'image_tag', body: "= image_tag '${1:src}'${2:, alt: '$3', height: '$4', width: '$5', class: '$6'}", detail: 'image_tag' },
  { prefix: 'javascript_include_tag', body: "= javascript_include_tag '${1:src}'", detail: 'javascript_include_tag' },
  { prefix: 'stylesheet_link_tag', body: "= stylesheet_link_tag '${1:src}'${2:, media: '$3'}", detail: 'stylesheet_link_tag' },
  { prefix: 'video_tag', body: "= video_tag '${1:src}'${2:, controls: '$3', autobuffer: $4, size: '$5', poster: '$6'}", detail: 'video_tag' },
  { prefix: 'asset_path', body: "= asset_path '${1:src}'${2:, type: '$3'}", detail: 'asset_path' },
  { prefix: 'asset_url', body: "= asset_url '${1:src}'${2:, type: '$3'}", detail: 'asset_url' },
  { prefix: 'audio_path', body: "= audio_path '${1:src}'", detail: 'audio_path' },
  { prefix: 'audio_url', body: "= audio_url '${1:src}'", detail: 'audio_url' },
  { prefix: 'compute_asset_extname', body: "compute_asset_extname('${1:src}')", detail: 'compute_asset_extname' },
  { prefix: 'compute_asset_host', body: "compute_asset_host('${1:src}')", detail: 'compute_asset_host' },
  { prefix: 'compute_asset_path', body: "compute_asset_path('${1:src}')", detail: 'compute_asset_path' },
  { prefix: 'font_path', body: "= font_path '${1:src}'", detail: 'font_path' },
  { prefix: 'font_url', body: "= font_url '${1:src}'", detail: 'font_url' },
  { prefix: 'image_path', body: "= image_path '${1:src}'", detail: 'image_path' },
  { prefix: 'image_url', body: "= image_url '${1:src}'", detail: 'image_url' },
  { prefix: 'javascript_path', body: "= javascript_path '${1:src}'", detail: 'javascript_path' },
  { prefix: 'javascript_url', body: "= javascript_url '${1:src}'", detail: 'javascript_url' },
  { prefix: 'stylesheet_path', body: "= stylesheet_path '${1:src}'", detail: 'stylesheet_path' },
  { prefix: 'stylesheet_url', body: "= stylesheet_url '${1:src}'", detail: 'stylesheet_url' },
  { prefix: 'video_path', body: "= video_path '${1:src}'", detail: 'video_path' },
  { prefix: 'video_url', body: "= video_url '${1:src}'", detail: 'video_url' },
  { prefix: 'cache', body: '- cache ${1:name} do\n  $2', detail: 'cache' },
  { prefix: 'cache_if', body: '- cache_if ${1:condition}, ${2:name} do\n  $3', detail: 'cache_if' },
  { prefix: 'cache_unless', body: '- cache_unless ${1:condition}, ${2:name} do\n  $3', detail: 'cache_unless' },
  { prefix: 'capture', body: '- @$1 = capture do\n  $2', detail: 'capture' },
  { prefix: 'content_for?', body: '- content_for?($1)', detail: 'content_for?' },
  { prefix: 'provide', body: '- provide $1 do\n  $2', detail: 'provide' },
  { prefix: 'csrf_meta_tag', body: '= csrf_meta_tag', detail: 'csrf_meta_tag' },
  { prefix: 'csrf_meta_tags', body: '= csrf_meta_tags', detail: 'csrf_meta_tags' },
  { prefix: 'date_select', body: '= date_select(${1:object_name}, ${2:method}${3:, $4})', detail: 'date_select' },
  { prefix: 'datetime_select', body: '= datetime_select(${1:object_name}, ${2:method}${3:, $4})', detail: 'datetime_select' },
  {
    prefix: 'distance_of_time_in_words',
    body: '= distance_of_time_in_words(${1:from_time}${2:, ${3:to_time}}${4:, {\\}})',
    detail: 'distance_of_time_in_words'
  },
  {
    prefix: 'distance_of_time_in_words_to_now',
    body: '= distance_of_time_in_words_to_now(${1:from_time}${2:, {\\}})',
    detail: 'distance_of_time_in_words_to_now'
  },
  { prefix: 'select_date', body: '= select_date(${1:date}${2:, {\\}})', detail: 'select_date' },
  { prefix: 'select_datetime', body: '= select_datetime(${1:date}${2:, {\\}})', detail: 'select_datetime' },
  { prefix: 'select_day', body: '= select_day(${1:date}${2:, {\\}})', detail: 'select_day' },
  { prefix: 'select_hour', body: '= select_hour(${1:datetime}${2:, {\\}})', detail: 'select_hour' },
  { prefix: 'select_minute', body: '= select_minute(${1:datetime}${2:, {\\}})', detail: 'select_minute' },
  { prefix: 'select_month', body: '= select_month(${1:date}${2:, {\\}})', detail: 'select_month' },
  { prefix: 'select_second', body: '= select_second(${1:datetime}${2:, {\\}})', detail: 'select_second' },
  { prefix: 'select_time', body: '= select_time(${1:datetime}${2:, {\\}})', detail: 'select_time' },
  { prefix: 'select_year', body: '= select_year(${1:date}${2:, {\\}})', detail: 'select_year' },
  { prefix: 'time_ago_in_words', body: '= time_ago_in_words(${1:from_time}${2:, {\\}})', detail: 'time_ago_in_words' },
  { prefix: 'time_select', body: '= time_select(${1:object_name}, ${2:method}${3:, {\\}})', detail: 'time_select' },
  { prefix: 'time_tag', body: '= time_tag(${1:date_or_time}${2:, {\\}})', detail: 'time_tag' },
  { prefix: 'time_tag_block', body: '= time_tag(${1:date_or_time}${2:, {\\}}) do\n  $4', detail: 'time_tag block' },
  { prefix: 'debug', body: '= debug $1', detail: 'debug' },
  { prefix: 'button', body: '= button ${1:name}${2:, {\\}}', detail: 'button' },
  { prefix: 'button_block', body: '= button(${1:{\\}}) do\n  $3', detail: 'button block' },
  { prefix: 'f.button', body: '= f.button ${1:name}${2:, {\\}}', detail: 'form.button' },
  { prefix: 'f.button_block', body: '= f.button(${1:{\\}}) do\n  $3', detail: 'form.button block' },
  { prefix: 'button_tag', body: '= button_tag $1', detail: 'button_tag' },
  { prefix: 'button_tag_block', body: '= button_tag $1 do\n  $2', detail: 'button_tag block' },
  { prefix: 'check_box', body: '= check_box ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'check_box' },
  { prefix: 'f.check_box', body: '= f.check_box ${1:method}${2:, {\\}}', detail: 'form.check_box' },
  { prefix: 'check_box_tag', body: '= check_box_tag ${1:name}${2:, {\\}}', detail: 'check_box_tag' },
  { prefix: 'f.date_select', body: '= f.date_select ${1:method}${2:, {\\}}', detail: 'form.date_select' },
  { prefix: 'f.datetime_select', body: '= f.datetime_select ${1:method}${2:, {\\}}', detail: 'form.datetime_select' },
  { prefix: 'fields_for', body: '= fields_for ${1:record_name}, ${2:record_object}${3:, {\\}} do |$4|\n  $5', detail: 'fields_for' },
  { prefix: 'f.fields_for', body: '= f.fields_for ${1:record_object}${2:, {\\}} do |$3|\n  $4', detail: 'form.fields_for' },
  { prefix: 'file_field', body: '= file_field ${1:method}${2:, {\\}}', detail: 'file_field' },
  { prefix: 'f.file_field', body: '= f.file_field ${1:method}${2:, {\\}}', detail: 'form.file_field' },
  { prefix: 'file_field_tag', body: '= file_field_tag ${1:name}${2:, {\\}}', detail: 'file_field_tag' },
  {
    prefix: 'f.grouped_collection_select',
    body: '= f.grouped_collection_select ${1:method}, ${2:collection}, ${3:group_method}, ${4:group_label_method}, ${5:option_key_method}, ${6:option_value_method}${7:, {\\}}',
    detail: 'form.grouped_collection_select'
  },
  { prefix: 'hidden_field', body: '= hidden_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'hidden_field' },
  { prefix: 'f.hidden_field', body: '= f.hidden_field ${1:method}${2:, {\\}}', detail: 'form.hidden_field' },
  { prefix: 'hidden_field_tag', body: '= hidden_field_tag ${1:name}${2:, {\\}}', detail: 'hidden_field_tag' },
  { prefix: 'label', body: '= label ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'label' },
  { prefix: 'f.label', body: '= f.label ${1:method}, ${2:text}${3:, {\\}}', detail: 'form.label' },
  { prefix: 'label_block', body: '= label ${1:method}${2:, {\\}} do\n  $3', detail: 'label block' },
  { prefix: 'f.label_block', body: '= f.label ${1:method}${2:, {\\}} do\n  $3', detail: 'form.label block' },
  { prefix: 'label_tag', body: '= label_tag ${1:name}${2:, {\\}}', detail: 'label_tag' },
  { prefix: 'radio_button', body: '= radio_button ${1:object_name}, ${2:method}, ${3:tag_value}${4:, {\\}}', detail: 'radio_button' },
  { prefix: 'f.radio_button', body: '= f.radio_button ${1:method}, ${2:tag_value}${3:, {\\}}', detail: 'form.radio_button' },
  { prefix: 'radio_button_tag', body: '= radio_button_tag ${1:name}, ${2:value}${3:, {\\}}', detail: 'radio_button_tag' },
  { prefix: 'select', body: '= select ${1:object}, ${2:method}${3:, {\\}}', detail: 'select' },
  { prefix: 'select_block', body: '= select ${1:object}, ${2:method}${3:, {\\}} do\n  $4', detail: 'select block' },
  { prefix: 'f.select', body: '= f.select ${1:method}, ${2:choices}${3:, {\\}}', detail: 'form.select' },
  { prefix: 'f.select_block', body: '= f.select ${1:method}, ${2:choices}${3:, {\\}} do\n  $4', detail: 'form.select block' },
  { prefix: 'select_tag', body: '= select_tag ${1:name}${2:, {\\}}', detail: 'select_tag' },
  { prefix: 'submit', body: '= submit${1: ${2:value}${3:, {\\}}}', detail: 'submit' },
  { prefix: 'f.submit', body: '= f.submit${1: ${2:value}${3:, {\\}}}', detail: 'form.submit' },
  { prefix: 'submit_tag', body: '= submit_tag ${1:value}${2:, {\\}}', detail: 'submit_tag' },
  { prefix: 'f.time_select', body: '= f.time_select ${1:method}${2:, {\\}}', detail: 'form.time_select' },
  { prefix: 'f.time_zone_select', body: '= f.time_zone_select ${1:method}${2:, {\\}}', detail: 'form.time_zone_select' },
  { prefix: 'color_field', body: '= color_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'color_field' },
  { prefix: 'f.color_field', body: '= f.color_field ${1:method}${2:, {\\}}', detail: 'form.color_field' },
  { prefix: 'color_field_tag', body: '= color_field_tag ${1:name}${2:, {\\}}', detail: 'color_field_tag' },
  { prefix: 'date_field', body: '= date_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'date_field' },
  { prefix: 'f.date_field', body: '= f.date_field ${1:method}${2:, {\\}}', detail: 'form.date_field' },
  { prefix: 'date_field_tag', body: '= date_field_tag ${1:name}${2:, {\\}}', detail: 'date_field_tag' },
  { prefix: 'datetime_field', body: '= datetime_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'datetime_field' },
  { prefix: 'f.datetime_field', body: '= f.datetime_field ${1:method}${2:, {\\}}', detail: 'form.datetime_field' },
  { prefix: 'datetime_field_tag', body: '= datetime_field_tag ${1:name}${2:, {\\}}', detail: 'datetime_field_tag' },
  { prefix: 'datetime_local_field', body: '= datetime_local_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'datetime_local_field' },
  { prefix: 'datetime_local_field_tag', body: '= datetime_local_field_tag ${1:name}${2:, {\\}}', detail: 'datetime_local_field_tag' },
  { prefix: 'f.datetime_local_field', body: '= f.datetime_local_field ${1:method}${2:, {\\}}', detail: 'form.datetime_local_field' },
  { prefix: 'email_field', body: '= email_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'email_field' },
  { prefix: 'f.email_field', body: '= f.email_field ${1:method}${2:, {\\}}', detail: 'form.email_field' },
  { prefix: 'email_field_tag', body: '= email_field_tag ${1:name}${2:, {\\}}', detail: 'email_field_tag' },
  { prefix: 'form_for', body: '= form_for $1 do |$2|\n  $3', detail: 'form_for' },
  { prefix: 'form_tag', body: '= form_tag $1 do\n  $2', detail: 'form_tag' },
  { prefix: 'month_field', body: '= month_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'month_field' },
  { prefix: 'f.month_field', body: '= f.month_field ${1:method}${2:, {\\}}', detail: 'form.month_field' },
  { prefix: 'month_field_tag', body: '= month_field_tag ${1:name}${2:, {\\}}', detail: 'month_field_tag' },
  { prefix: 'number_field', body: '= number_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'number_field' },
  { prefix: 'f.number_field', body: '= f.number_field ${1:method}${2:, {\\}}', detail: 'form.number_field' },
  { prefix: 'number_field_tag', body: '= number_field_tag ${1:name}${2:, {\\}}', detail: 'number_field_tag' },
  { prefix: 'password_field', body: '= password_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'password_field' },
  { prefix: 'f.password_field', body: '= f.password_field ${1:method}${2:, {\\}}', detail: 'form.password_field' },
  { prefix: 'password_field_tag', body: '= password_field_tag ${1:name}${2:, {\\}}', detail: 'password_field_tag' },
  { prefix: 'phone_field', body: '= phone_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'phone_field' },
  { prefix: 'f.phone_field', body: '= f.phone_field ${1:method}${2:, {\\}}', detail: 'form.phone_field' },
  { prefix: 'phone_field_tag', body: '= phone_field_tag ${1:name}${2:, {\\}}', detail: 'phone_field_tag' },
  { prefix: 'range_field', body: '= range_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'range_field' },
  { prefix: 'f.range_field', body: '= f.range_field ${1:method}${2:, {\\}}', detail: 'form.range_field' },
  { prefix: 'range_field_tag', body: '= range_field_tag ${1:name}${2:, {\\}}', detail: 'range_field_tag' },
  { prefix: 'search_field', body: '= search_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'search_field' },
  { prefix: 'f.search_field', body: '= f.search_field ${1:method}${2:, {\\}}', detail: 'form.search_field' },
  { prefix: 'search_field_tag', body: '= search_field_tag ${1:name}${2:, {\\}}', detail: 'search_field_tag' },
  { prefix: 'telephone_field', body: '= telephone_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'telephone_field' },
  { prefix: 'f.telephone_field', body: '= f.telephone_field ${1:method}${2:, {\\}}', detail: 'form.telephone_field' },
  { prefix: 'telephone_field_tag', body: '= telephone_field_tag ${1:name}${2:, {\\}}', detail: 'telephone_field_tag' },
  { prefix: 'text_area', body: '= text_area ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'text_area' },
  { prefix: 'f.text_area', body: '= f.text_area ${1:method}${2:, {\\}}', detail: 'form.text_area' },
  { prefix: 'text_area_tag', body: '= text_area_tag ${1:name}${2:, {\\}}', detail: 'text_area_tag' },
  { prefix: 'text_field', body: '= text_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'text_field' },
  { prefix: 'f.text_field', body: '= f.text_field ${1:method}${2:, {\\}}', detail: 'form.text_field' },
  { prefix: 'text_field_tag', body: '= text_field_tag ${1:name}${2:, {\\}}', detail: 'text_field_tag' },
  { prefix: 'time_field', body: '= time_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'time_field' },
  { prefix: 'f.time_field', body: '= f.time_field ${1:method}${2:, {\\}}', detail: 'form.time_field' },
  { prefix: 'time_field_tag', body: '= time_field_tag ${1:name}${2:, {\\}}', detail: 'time_field_tag' },
  { prefix: 'url_field', body: '= url_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'url_field' },
  { prefix: 'f.url_field', body: '= f.url_field ${1:method}${2:, {\\}}', detail: 'form.url_field' },
  { prefix: 'url_field_tag', body: '= url_field_tag ${1:name}${2:, {\\}}', detail: 'url_field_tag' },
  { prefix: 'week_field', body: '= week_field ${1:object_name}, ${2:method}${3:, {\\}}', detail: 'week_field' },
  { prefix: 'f.week_field', body: '= f.week_field ${1:method}${2:, {\\}}', detail: 'form.week_field' },
  { prefix: 'week_field_tag', body: '= week_field_tag ${1:name}${2:, {\\}}', detail: 'week_field_tag' },
  { prefix: 'field_set_tag', body: '= field_set_tag $1 do\n  $2', detail: 'field_set_tag' },
  { prefix: 'image_submit_tag', body: '= image_submit_tag ${1:source}${2:, {\\}}', detail: 'image_submit_tag' },
  { prefix: 'utf8_enforcer_tag', body: '= utf8_enforcer_tag', detail: 'utf8_enforcer_tag' },
  {
    prefix: 'collection_check_boxes',
    body: '= collection_check_boxes ${1:object}, ${2:method}, ${3:collection}, ${4:value_method}, ${5:text_method}${6:, {\\}}',
    detail: 'collection_check_boxes'
  },
  {
    prefix: 'f.collection_check_boxes',
    body: '= f.collection_check_boxes ${1:method}, ${2:collection}, ${3:value_method}, ${4:text_method}${5:, {\\}}',
    detail: 'form.collection_check_boxes'
  },
  {
    prefix: 'collection_check_boxes_block',
    body: '= collection_check_boxes ${1:object}, ${2:method}, ${3:collection}, ${4:value_method}, ${5:text_method}${6:, {\\}} do\n  $7',
    detail: 'collection_check_boxes block'
  },
  {
    prefix: 'collection_radio_buttons',
    body: '= collection_radio_buttons ${1:object}, ${2:method}, ${3:collection}, ${4:value_method}, ${5:text_method}${6:, {\\}}',
    detail: 'collection_radio_buttons'
  },
  {
    prefix: 'f.collection_radio_buttons',
    body: '= f.collection_radio_buttons ${1:method}, ${2:collection}, ${3:value_method}, ${4:text_method}${5:, {\\}}',
    detail: 'form.collection_radio_buttons'
  },
  {
    prefix: 'collection_radio_buttons_block',
    body: '= collection_radio_buttons ${1:object}, ${2:method}, ${3:collection}, ${4:value_method}, ${5:text_method}${6:, {\\}} do\n  $7',
    detail: 'collection_radio_buttons block'
  },
  {
    prefix: 'f.collection_select',
    body: '= f.collection_select ${1:method}, ${2:collection}, ${3:value_method}, ${4:text_method}${5:, {\\}}',
    detail: 'form.collection_select'
  },
  {
    prefix: 'collection_select',
    body: '= collection_select ${1:object}, ${2:method}, ${3:collection}, ${4:value_method}, ${6:text_method}${7:, {\\}}',
    detail: 'collection_select'
  },
  {
    prefix: 'grouped_collection_select',
    body: '= grouped_collection_select ${1:object}, ${2:method}, ${3:collection}, ${4:group_method}, ${5:group_label_method}, ${6:option_key_method}, ${7:option_value_method}${8:, {\\}}',
    detail: 'grouped_collection_select'
  },
  {
    prefix: 'grouped_options_for_select',
    body: '= grouped_options_for_select ${1:grouped_options}${2:, {\\}}',
    detail: 'grouped_options_for_select'
  },
  {
    prefix: 'option_groups_from_collection_for_select',
    body: '= option_groups_from_collection_for_select ${1:collection}, ${2:group_method}, ${3:group_label_method}, ${4:option_key_method}, ${5:option_value_method}${6:, {\\}}',
    detail: 'option_groups_from_collection_for_select'
  },
  { prefix: 'options_for_select', body: '= options_for_select ${1:container}${2:, {\\}}', detail: 'options_for_select' },
  {
    prefix: 'options_from_collection_for_select',
    body: '= options_from_collection_for_select ${1:collection}, ${2:value_method}, ${3:text_method}${4:, {\\}}',
    detail: 'options_from_collection_for_select'
  },
  { prefix: 'time_zone_options_for_select', body: '= time_zone_options_for_select $1', detail: 'time_zone_options_for_select' },
  { prefix: 'time_zone_select', body: '= time_zone_select ${1:object}, ${2:method}${3:, {\\}}', detail: 'time_zone_select' },
  { prefix: 'escape_javascript', body: '= escape_javascript $1', detail: 'escape_javascript' },
  { prefix: 'j', body: '= j $1', detail: 'j' },
  { prefix: 'javascript_tag', body: '= javascript_tag $1', detail: 'javascript_tag' },
  { prefix: 'javascript_tag_block', body: '= javascript_tag do\n  $1', detail: 'javascript_tag block' },
  { prefix: 'number_to_currency', body: '= number_to_currency(${1:number}${2:, {\\}})', detail: 'number_to_currency' },
  { prefix: 'number_to_human', body: '= number_to_human(${1:number}${2:, {\\}})', detail: 'number_to_human' },
  { prefix: 'number_to_human_size', body: '= number_to_human_size(${1:number}${2:, {\\}})', detail: 'number_to_human_size' },
  { prefix: 'number_to_percentage', body: '= number_to_percentage(${1:number}${2:, {\\}})', detail: 'number_to_percentage' },
  { prefix: 'number_to_phone', body: '= number_to_phone(${1:number}${2:, {\\}})', detail: 'number_to_phone' },
  { prefix: 'number_with_delimiter', body: '= number_with_delimiter(${1:number}${2:, {\\}})', detail: 'number_with_delimiter' },
  { prefix: 'number_with_precision', body: '= number_with_precision(${1:number}${2:, {\\}})', detail: 'number_with_precision' },
  { prefix: 'raw', body: '= raw $1', detail: 'raw' },
  { prefix: 'safe_join', body: '= safe_join $1', detail: 'safe_join' },
  { prefix: 'to_sentence', body: '= to_sentence $1', detail: 'to_sentence' },
  { prefix: 'content_tag_for', body: '= content_tag_for($1) do\n  $2', detail: 'content_tag_for' },
  { prefix: 'div_for', body: '= div_for($1) do\n  $2', detail: 'div_for' },
  {
    prefix: 'render_partial_local',
    body: "= render partial: '${1:src}', locals: { ${2:key}: ${3:as} }${4:, layout: $5}",
    detail: 'render partial with locals'
  },
  {
    prefix: 'render_partial_collection',
    body: "= render partial: '${1:src}', collection: ${2:collection}${3:, as: ${4:as}}${5:, spacer_template: $6}${7:, layout: $8}",
    detail: 'render partial with collection'
  },
  { prefix: 'render_partial_only', body: "= render partial: '${1:partial}'", detail: 'render partial only' },
  { prefix: 'render', body: "= render '${1:object}'", detail: 'render only' },
  { prefix: 'sanitize', body: '= sanitize ${1:object}${2:, tags: %w($3)}${4:, attributes: %w($5)}${6:, scrubber: $7}', detail: 'sanitize' },
  { prefix: 'strip_links', body: 'strip_links(${1:object})', detail: 'strip_links' },
  { prefix: 'strip_tags', body: 'strip_tags(${1:object})', detail: 'strip_tags' },
  { prefix: 'cdata_section', body: 'cdata_section(${1:object})', detail: 'cdata_section' },
  { prefix: 'content_tag', body: '= content_tag(${1:tag}, ${2:body}${3:, class: $4})', detail: 'content_tag' },
  { prefix: 'content_tag_block', body: '= content_tag ${1:tag}${2:, class: $3} do\n  $4', detail: 'content_tag block' },
  { prefix: 'escape_once', body: "= escape_once('${1:body}')", detail: 'escape_once' },
  { prefix: 'tag', body: '= tag($1)', detail: 'tag' },
  { prefix: 'concat', body: '= concat($1)', detail: 'concat' },
  { prefix: 'cycle', body: '= cycle(${1:first}${2:, name: $3})', detail: 'cycle' },
  { prefix: 'current_cycle', body: "= current_cycle${1:('$2')}", detail: 'current_cycle' },
  { prefix: 'excerpt', body: "= excerpt('${1:text}', '${2:phrase}'${3:, {\\}})", detail: 'excerpt' },
  { prefix: 'highlight', body: "= highlight('${1:text}', '${2:phrase}'${3:, {\\}})", detail: 'highlight' },
  { prefix: 'pluralize', body: "= pluralize(${1:number}, '${2:phrase}'${3:, {\\}})", detail: 'pluralize' },
  { prefix: 'reset_cycle', body: "- reset_cycle${1:('$2')}", detail: 'reset_cycle' },
  { prefix: 'safe_concat', body: '= safe_concat($1)', detail: 'safe_concat' },
  { prefix: 'simple_format', body: "= simple_format('${1:text}'${2:, {\\}})", detail: 'simple_format' },
  { prefix: 'truncate', body: "= truncate('${1:text}'${2:, {\\}})", detail: 'truncate' },
  { prefix: 'word_wrap', body: "= word_wrap('${1:text}'${2:, line_width: $3}${4:, break_sequence: $5})", detail: 'word_wrap' },
  { prefix: 'l', body: "= l('${1:text}'${2:, {\\}})", detail: 'l' },
  { prefix: 'localize', body: "= localize('${1:text}'${2:, {\\}})", detail: 'localize' },
  { prefix: 't', body: "= t('${1:text}'${2:, {\\}})", detail: 't' },
  { prefix: 'translate', body: "= translate('${1:text}'${2:, {\\}})", detail: 'translate' },
  { prefix: 'button_to', body: "= button_to('${1:name}'${2:, {\\}})", detail: 'button_to' },
  { prefix: 'button_to_block', body: '= button_to $1 do\n  $2', detail: 'button_to block' },
  { prefix: 'current_page?', body: 'current_page?($1)', detail: 'current_page?' },
  { prefix: 'link_to', body: "= link_to('${1:name}'${2:, {\\}})", detail: 'link_to' },
  { prefix: 'link_to_block', body: '= link_to $1 do\n  $2', detail: 'link_to block' },
  { prefix: 'link_to_if', body: "= link_to_if(${1:condition}, '${2:name}'${3:, {\\}})", detail: 'link_to_if' },
  { prefix: 'link_to_if_block', body: "= link_to_if(${1:condition}, '${2:name}'${3:, {\\}}) do\n  $4", detail: 'link_to_if block' },
  { prefix: 'link_to_unless', body: "= link_to_unless(${1:condition}, '${2:name}'${3:, {\\}})", detail: 'link_to_unless' },
  { prefix: 'link_to_unless_block', body: "= link_to_unless(${1:condition}, '${2:name}'${3:, {\\}}) do\n  $4", detail: 'link_to_unless block' },
  { prefix: 'link_to_unless_current', body: '= link_to_unless_current(${1:name}${2:, {\\}})', detail: 'link_to_unless_current' },
  { prefix: 'link_to_unless_current_block', body: '= link_to_unless_current(${1:name}${2:, {\\}}) do\n  $3', detail: 'link_to_unless_current block' },
  { prefix: 'mail_to', body: "= mail_to('${1:address}'${2:, {\\}})", detail: 'mail_to' },
  { prefix: 'mail_to_block', body: "= mail_to('${1:address}'${2:, {\\}}) do\n  $3", detail: 'mail_to block' }
];
