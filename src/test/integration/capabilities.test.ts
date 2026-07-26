import * as assert from 'node:assert';
import { CapabilityCache, type VersionProbe } from '../../capabilities';
import type { Invocation } from '../../hamlLint/executable';
import { Logger } from '../../logger';
import { config, INVOCATION } from '../support/doubles';
import { openView } from '../support/host';
import { wait } from '../support/timing';

function countingProbe(): VersionProbe & { probes: number } {
  const probe = {
    probes: 0,
    resolve: (): Invocation => INVOCATION,
    async probeVersion() {
      probe.probes++;
      return [0, 76, 0] as const;
    }
  };
  return probe;
}

suite('capabilities Test Suite', () => {
  suite('prime', () => {
    // Regression: prime() used to probe unconditionally, so opening a .haml file spawned
    // `haml-lint --version` - and under bundler evaluated the workspace Gemfile as Ruby - even for a
    // user who had set formatter to none and lint.run to off to get highlighting only.
    test('should not spawn anything when formatting is disabled', async () => {
      const probe = countingProbe();
      const logger = new Logger();
      const cache = new CapabilityCache(probe, logger);
      const document = await openView('clean.haml');

      cache.prime(document, config({ formatter: 'none', lintRun: 'off' }));
      await wait(50);

      assert.strictEqual(probe.probes, 0, 'highlighting-only configuration must never spawn a process');
      cache.dispose();
      logger.dispose();
    });

    test('should not spawn when the mode is chosen explicitly', async () => {
      const probe = countingProbe();
      const logger = new Logger();
      const cache = new CapabilityCache(probe, logger);
      const document = await openView('clean.haml');

      cache.prime(document, config({ formatter: 'safe' }));
      cache.prime(document, config({ formatter: 'all' }));
      await wait(50);

      assert.strictEqual(probe.probes, 0);
      cache.dispose();
      logger.dispose();
    });

    test('should probe once for auto and cache the result', async () => {
      const probe = countingProbe();
      const logger = new Logger();
      const cache = new CapabilityCache(probe, logger);
      const document = await openView('clean.haml');

      cache.prime(document, config());
      cache.prime(document, config());
      await wait(50);

      assert.strictEqual(probe.probes, 1);
      cache.dispose();
      logger.dispose();
    });
  });
});
