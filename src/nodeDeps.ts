// The real filesystem behind the pure resolvers. Shared by the haml-lint client and the Rails
// snippet detector, so neither reaches for node:fs itself.

import * as fs from 'node:fs';
import type { ResolveDeps } from './hamlLint/executable';

export function nodeResolveDeps(): ResolveDeps {
  return {
    fileExists: (target) => {
      try {
        return fs.existsSync(target);
      } catch {
        return false;
      }
    },
    readFile: (target) => {
      try {
        return fs.readFileSync(target, 'utf8');
      } catch {
        return null;
      }
    },
    readDirectory: (target) => {
      try {
        return fs.readdirSync(target);
      } catch {
        return null;
      }
    },
    platform: process.platform,
    env: process.env
  };
}
