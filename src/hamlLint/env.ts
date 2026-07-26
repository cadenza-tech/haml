// Environment for the haml-lint child process. Pure; no vscode imports.

export const FALLBACK_LOCALE = 'C.UTF-8';
export const RUBY_ENCODING_OPTION = '-EUTF-8:UTF-8';

export interface EnvOptions {
  /** Pinned when Bundler is used so a monorepo cannot resolve a different Gemfile from cwd. */
  readonly bundleGemfile?: string;
}

function presentOrUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Builds the child environment.
 *
 * The extension host frequently runs without LANG (desktop launchers, containers, remote hosts).
 * Ruby then sets Encoding.default_external to US-ASCII and haml-lint dies with
 * "invalid byte sequence in US-ASCII" (exit 70) on any .haml containing non-ASCII text.
 *
 * RUBYOPT is appended to, never replaced: `bundle exec` injects `-rbundler/setup` through it, and
 * overwriting the variable breaks the entire Bundler path.
 *
 * C.UTF-8 is the fallback rather than en_US.UTF-8 because minimal Linux images ship the former.
 */
export function buildEnv(base: NodeJS.ProcessEnv, options: EnvOptions = {}): NodeJS.ProcessEnv {
  const lang = presentOrUndefined(base.LANG) ?? FALLBACK_LOCALE;
  const env: NodeJS.ProcessEnv = {
    ...base,
    LANG: lang,
    LC_ALL: presentOrUndefined(base.LC_ALL) ?? lang,
    RUBYOPT: [presentOrUndefined(base.RUBYOPT), RUBY_ENCODING_OPTION].filter((part): part is string => part !== undefined).join(' ')
  };

  if (options.bundleGemfile !== undefined) {
    env.BUNDLE_GEMFILE = options.bundleGemfile;
  }
  return env;
}
