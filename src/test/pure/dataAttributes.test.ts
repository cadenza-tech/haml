import * as assert from 'node:assert';
import { DATA_ATTRIBUTE_COMPLETIONS, DATA_ATTRIBUTES } from '../../pure/dataAttributes';
import type { AttributeSyntax, DataAttributeCompletion } from '../../types';

function find(syntax: AttributeSyntax, label: string): DataAttributeCompletion | undefined {
  return DATA_ATTRIBUTE_COMPLETIONS[syntax].find((completion) => completion.label === label);
}

function labels(syntax: AttributeSyntax): string[] {
  return DATA_ATTRIBUTE_COMPLETIONS[syntax].map((completion) => completion.label);
}

suite('pure/dataAttributes Test Suite', () => {
  suite('DATA_ATTRIBUTES', () => {
    test('should hold lowercase dashed names that all start with data-', () => {
      for (const attribute of DATA_ATTRIBUTES) {
        assert.ok(attribute.name.startsWith('data-'), attribute.name);
        assert.strictEqual(attribute.name, attribute.name.toLowerCase(), attribute.name);
        assert.ok(/^[a-z-]+$/.test(attribute.name), attribute.name);
      }
    });

    test('should hold no duplicates', () => {
      const names = DATA_ATTRIBUTES.map((attribute) => attribute.name);
      assert.strictEqual(new Set(names).size, names.length);
    });

    test('should describe every attribute', () => {
      for (const attribute of DATA_ATTRIBUTES) {
        assert.ok(attribute.description.length > 0, attribute.name);
      }
    });

    // Stimulus target, value, class and outlet names are per controller, so a pattern label would
    // never fuzzy-match what the user types. Only the two fixed names are offered.
    test('should offer only the two fixed Stimulus attributes', () => {
      const stimulus = DATA_ATTRIBUTES.filter((attribute) => attribute.source === 'Stimulus').map((attribute) => attribute.name);
      assert.deepStrictEqual(stimulus, ['data-action', 'data-controller']);
    });
  });

  suite('DATA_ATTRIBUTE_COMPLETIONS', () => {
    test('should render an attribute that takes a value in all three notations', () => {
      assert.strictEqual(find('htmlAttributes', 'data-turbo-frame')?.body, 'data-turbo-frame="$1"');
      assert.strictEqual(find('rubyHash', 'data-turbo-frame')?.body, "'data-turbo-frame': '$1'");
      assert.strictEqual(find('rubyDataHash', 'turbo_frame')?.body, "turbo_frame: '$1'");
    });

    // Presence is the value, so inserting `="$1"` would invite a meaningless one.
    test('should render a valueless attribute without a value placeholder', () => {
      assert.strictEqual(find('htmlAttributes', 'data-turbo-permanent')?.body, 'data-turbo-permanent');
      assert.strictEqual(find('rubyHash', 'data-turbo-permanent')?.body, "'data-turbo-permanent': true");
      assert.strictEqual(find('rubyDataHash', 'turbo_permanent')?.body, 'turbo_permanent: true');
    });

    // Haml converts an underscore in a nested data: hash key to a dash, so the key is written that way.
    test('should underscore the name inside a nested data hash and drop the prefix', () => {
      assert.ok(labels('rubyDataHash').includes('controller'), labels('rubyDataHash').join(' '));
      assert.ok(labels('rubyDataHash').includes('disable_with'), labels('rubyDataHash').join(' '));
      assert.ok(!labels('rubyDataHash').some((label) => label.includes('-')), labels('rubyDataHash').join(' '));
    });

    test('should always quote a Ruby hash key with single quotes', () => {
      for (const completion of DATA_ATTRIBUTE_COMPLETIONS.rubyHash) {
        assert.ok(completion.body.startsWith("'"), completion.body);
        assert.ok(!completion.body.includes('"'), completion.body);
      }
    });

    // The generic entry teaches the notation itself; inside a data: hash any key is already free-form,
    // so there is nothing to teach there.
    test('should offer a generic data-* entry outside a data hash only', () => {
      assert.strictEqual(find('htmlAttributes', 'data-')?.body, 'data-${1:name}="$2"');
      assert.strictEqual(find('rubyHash', 'data-')?.body, "'data-${1:name}': '$2'");
      assert.strictEqual(find('rubyDataHash', 'data-'), undefined);
    });

    test('should render every attribute in every notation', () => {
      assert.strictEqual(DATA_ATTRIBUTE_COMPLETIONS.rubyDataHash.length, DATA_ATTRIBUTES.length);
      assert.strictEqual(DATA_ATTRIBUTE_COMPLETIONS.rubyHash.length, DATA_ATTRIBUTES.length + 1);
      assert.strictEqual(DATA_ATTRIBUTE_COMPLETIONS.htmlAttributes.length, DATA_ATTRIBUTES.length + 1);
    });

    test('should carry the source as the detail and the description as documentation', () => {
      const frame = find('htmlAttributes', 'data-turbo-frame');
      assert.strictEqual(frame?.detail, 'Turbo');
      assert.ok((frame?.documentation.length ?? 0) > 0);
    });
  });
});
