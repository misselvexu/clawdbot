#!/usr/bin/env node
/**
 * scripts/check-runtime-alias-files.mjs
 *
 * Sanity check: ensure every `<base>.runtime-HASH.js` chunk in dist/ has a
 * matching `<base>.runtime.js` stable alias file alongside it.
 *
 * Background (private fork patch, pending upstream PR):
 * `pruneInstalledPackageDist` in scripts/postinstall-bundled-plugins.mjs uses
 * an import-closure expansion that does NOT pair runtime aliases with their
 * hashed siblings. Orphan aliases get pruned on every `pnpm install` /
 * `npm install`, which crashes channel dispatch on first message.
 *
 * Fix A (in scripts/lib/package-dist-imports.mjs) prevents the deletion at
 * the closure layer. This script is the defensive net: if an alias ever
 * goes missing again (different deletion path, partial build, etc.), this
 * fails build / loud-warns install before the channel breakage hits users.
 *
 * Usage:
 *   node scripts/check-runtime-alias-files.mjs            # build-time gate (exits 1 on missing)
 *   node scripts/check-runtime-alias-files.mjs --warn-only  # postinstall soft warning (exits 0)
 *
 * See docs/multi-user-architecture/UPGRADE-v2026.5.7.md Part IX.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_HASHED_RE = /^(?<base>[^/]+)\.runtime-[A-Za-z0-9_-]+\.js$/;
const RUNTIME_ALIAS_RE = /^(?<base>[^/]+)\.runtime\.js$/;

function isMainModule() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

export function findMissingRuntimeAliases({ distDir, fsImpl = fs }) {
  if (!fsImpl.existsSync(distDir) || !fsImpl.statSync(distDir).isDirectory()) {
    return { missing: [], scanned: 0, distDirExists: false };
  }
  const entries = fsImpl.readdirSync(distDir);
  const hashedBases = new Set();
  const aliasBases = new Set();
  for (const entry of entries) {
    const hashedMatch = entry.match(RUNTIME_HASHED_RE);
    if (hashedMatch?.groups) {
      hashedBases.add(hashedMatch.groups.base);
      continue;
    }
    const aliasMatch = entry.match(RUNTIME_ALIAS_RE);
    if (aliasMatch?.groups) {
      aliasBases.add(aliasMatch.groups.base);
    }
  }
  const missing = [];
  for (const base of hashedBases) {
    if (!aliasBases.has(base)) {
      missing.push(`${base}.runtime.js`);
    }
  }
  missing.sort();
  return { missing, scanned: hashedBases.size, distDirExists: true };
}

export function formatErrorMessage(missing, distDir) {
  const lines = [
    "ERROR: dispatch runtime alias files missing under dist/",
    `  dist directory: ${distDir}`,
    `  missing aliases (${missing.length}):`,
    ...missing.map((file) => `    - dist/${file}`),
    "",
    "This means pruneInstalledPackageDist (in scripts/postinstall-bundled-plugins.mjs)",
    "deleted them, OR runtime-postbuild's writeStableRootRuntimeAliases skipped them.",
    "",
    "Fix:",
    "  1. Re-run `pnpm build` to regenerate, OR",
    "  2. Restore from a known-good dist (e.g. trial worktree), OR",
    "  3. Verify scripts/lib/package-dist-imports.mjs has the alias-pair preservation patch.",
    "",
    "Without these aliases, channel message dispatch will crash with:",
    "  ERR_MODULE_NOT_FOUND: Cannot find module '/path/to/dist/<base>.runtime.js'",
    "",
    "See docs/multi-user-architecture/UPGRADE-v2026.5.7.md Part IX for full root cause.",
  ];
  return lines.join("\n");
}

export function runCheck({
  distDir = path.resolve(process.cwd(), "dist"),
  warnOnly = false,
  out = console,
} = {}) {
  const result = findMissingRuntimeAliases({ distDir });
  if (!result.distDirExists) {
    out.log(
      `[check-runtime-alias-files] skipped: dist/ not found at ${distDir} (likely pre-build)`,
    );
    return { exitCode: 0, ...result };
  }
  if (result.missing.length === 0) {
    out.log(
      `[check-runtime-alias-files] OK: ${result.scanned} runtime alias pair(s) intact under dist/`,
    );
    return { exitCode: 0, ...result };
  }
  const errorMessage = formatErrorMessage(result.missing, distDir);
  if (warnOnly) {
    out.warn(`WARN: ${errorMessage}`);
    return { exitCode: 0, ...result };
  }
  out.error(errorMessage);
  return { exitCode: 1, ...result };
}

if (isMainModule()) {
  const warnOnly = process.argv.includes("--warn-only");
  const { exitCode } = runCheck({ warnOnly });
  process.exit(exitCode);
}
