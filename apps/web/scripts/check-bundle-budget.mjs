#!/usr/bin/env node
/**
 * Fails when the JavaScript a page loads up front grows past its budget.
 *
 * The repo had no bundle check at all, which is how a single 783 KB gzipped
 * chunk — containing the admin CMS editor, the charting library and the
 * dashboard grid — ended up on every marketing page. Route splitting fixed
 * that, but nothing stopped it from coming back the next time a component is
 * imported at the top of App.tsx instead of lazily.
 *
 * What is measured: the <script src> chunks referenced by the prerendered HTML
 * of representative routes, gzipped, which is what a visitor downloads before
 * the page can hydrate. Route-specific chunks fetched afterwards are excluded
 * on purpose — those are the thing splitting is supposed to defer.
 *
 * Run after `next build`. Set BUNDLE_BUDGET_KB to override the limit.
 */

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = join(webRoot, ".next");

// Budget is set above the current measurement with room for ordinary growth,
// not at it — a gate that trips on every dependency bump gets disabled.
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 260);

// One marketing page and one app page: they should share the same entry
// chunks, and a regression in either is worth failing on.
const PAGES = ["finance.html", "index.html"];

function chunkBytes(html) {
  const refs = new Set(
    [...html.matchAll(/\/_next\/(static\/chunks\/[^"']+?\.js)/g)].map((m) => m[1]),
  );
  let total = 0;
  let counted = 0;
  for (const ref of refs) {
    const file = join(nextDir, ref);
    if (!existsSync(file)) continue;
    total += gzipSync(readFileSync(file)).length;
    counted += 1;
  }
  return { total, counted };
}

if (!existsSync(nextDir)) {
  console.error("check-bundle-budget: no .next directory — run `next build` first.");
  process.exit(1);
}

let worst = 0;
let failed = false;

for (const page of PAGES) {
  const file = join(nextDir, "server", "app", page);
  if (!existsSync(file)) {
    console.error(`check-bundle-budget: expected prerendered page missing: ${page}`);
    process.exit(1);
  }

  const { total, counted } = chunkBytes(readFileSync(file, "utf8"));
  const kb = total / 1024;
  worst = Math.max(worst, kb);

  const verdict = kb > BUDGET_KB ? "OVER" : "ok";
  console.log(
    `  ${page.padEnd(16)} ${kb.toFixed(0).padStart(5)} KB gzip  ` +
      `(${counted} chunks)  ${verdict}`,
  );
  if (kb > BUDGET_KB) failed = true;
}

if (failed) {
  console.error(
    `\ncheck-bundle-budget: initial JS is ${worst.toFixed(0)} KB gzip, over the ` +
      `${BUDGET_KB} KB budget.\n` +
      "Something is probably imported eagerly that should be lazy. Compare the\n" +
      "chunk list against the previous build, and check App.tsx for a new\n" +
      "top-level page import that should be wrapped in lazy().",
  );
  process.exit(1);
}

console.log(`\ncheck-bundle-budget: ${worst.toFixed(0)} KB gzip, within ${BUDGET_KB} KB.`);
