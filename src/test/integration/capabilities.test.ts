import * as assert from 'node:assert';
import { CapabilityCache, type VersionProbe } from '../../capabilities';
import type { Invocation } from '../../hamlLint/executable';
import type { SemVerTriple } from '../../hamlLint/version';
import { Logger } from '../../logger';
import { config, INVOCATION } from '../support/doubles';
import { openView } from '../support/host';
import { wait } from '../support/timing';

function countingProbe(): VersionProbe & { probes: number } {
  const probe = {
    probes: 0,
    canProbe: () => true,
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

  suite('version', () => {
    // Regression: a probe failing after invalidate() deleted whatever entry sat under its key,
    // evicting the fresh probe started for the new settings - which then had to be spawned again.
    // The delete is guarded the same way as HamlLintClient.run's settle handler.
    test('should not let a stale failed probe evict the one started after invalidate', async () => {
      let failFirst: ((version: SemVerTriple | null) => void) | undefined;
      const probe = {
        probes: 0,
        canProbe: () => true,
        resolve: (): Invocation => INVOCATION,
        probeVersion(): Promise<SemVerTriple | null> {
          probe.probes++;
          if (probe.probes === 1) {
            return new Promise<SemVerTriple | null>((resolve) => {
              failFirst = resolve;
            });
          }
          return Promise.resolve<SemVerTriple | null>([0, 76, 0] as const);
        }
      };
      const logger = new Logger();
      const cache = new CapabilityCache(probe, logger);
      const document = await openView('clean.haml');

      const first = cache.version(document, config());
      cache.invalidate();
      void cache.version(document, config());
      failFirst?.(null);
      await first;
      void cache.version(document, config());

      assert.strictEqual(probe.probes, 2, 'the fresh probe must stay cached when the stale one fails');
      cache.dispose();
      logger.dispose();
    });

    // Two packages under one root .haml-lint.yml resolve to the same `bundle` and the same cwd, but
    // each has its own Gemfile.lock, which can pin a haml_lint on the other side of the 0.74.0 floor.
    test('should probe again for a bundle that differs only in its Gemfile', async () => {
      let bundleGemfile = '/repo/packages/a/Gemfile';
      const probe = {
        probes: 0,
        canProbe: () => true,
        resolve: (): Invocation => ({ ...INVOCATION, usesBundler: true, bundleGemfile }),
        async probeVersion(): Promise<SemVerTriple | null> {
          probe.probes++;
          return [0, 76, 0] as const;
        }
      };
      const logger = new Logger();
      const cache = new CapabilityCache(probe, logger);
      const document = await openView('clean.haml');

      await cache.version(document, config());
      bundleGemfile = '/repo/packages/b/Gemfile';
      await cache.version(document, config());

      assert.strictEqual(probe.probes, 2, "one package's version must not answer for the other");
      cache.dispose();
      logger.dispose();
    });
  });
});
