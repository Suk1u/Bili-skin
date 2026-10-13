#!/usr/bin/env node
/**
 * Build step: stamp the real raw script URL into the module and emit the
 * distributable script into dist/.
 *
 * The canonical module ships with a REPLACE_ME placeholder so the repository
 * stays host-agnostic; this script bakes in your own raw URL so Surge can
 * download the JS.
 *
 * Usage:
 *   npm run build                                  # uses the URL configured below
 *   node scripts/build.js --repo user/repo
 *   node scripts/build.js --url https://cdn.jsdelivr.net/gh/user/repo@main/beizhi_checkin.js
 *   node scripts/build.js --check                  # verify module and script agree
 *
 * Environment override: BEIZHI_RAW_URL, BEIZHI_REPO
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_JS = path.join(ROOT, 'src', 'beizhi_checkin.js');
const SRC_MODULE = path.join(ROOT, 'BeizhiCheckin.sgmodule');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_JS = path.join(DIST_DIR, 'beizhi_checkin.js');
const DIST_MODULE = path.join(DIST_DIR, 'BeizhiCheckin.sgmodule');

const PLACEHOLDER = 'REPLACE_ME/surge-beizhi-checkin/main';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i += 1; }
      else out[key] = true;
    }
  }
  return out;
}

function rawUrlFor(repo) {
  return 'https://raw.githubusercontent.com/' + repo + '/beizhi_checkin.js';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const script = fs.readFileSync(SRC_JS, 'utf8');
  let module = fs.readFileSync(SRC_MODULE, 'utf8');

  if (args.check) {
    const embedded = module.match(/script-path=(https?:\/\/\S+?\.js)/);
    const hash = require('crypto').createHash('sha256').update(script).digest('hex').slice(0, 12);
    console.log('module script-path : ' + (embedded ? embedded[1] : '(none)'));
    console.log('local script sha256: ' + hash);
    if (module.indexOf(PLACEHOLDER) !== -1) {
      console.log('\nThe module still carries the REPLACE_ME placeholder.');
      console.log('Run `npm run build -- --repo <user>/<repo>` (or set BEIZHI_REPO) first.');
      process.exit(2);
    }
    console.log('\nModule carries a real URL. Remember: editing the local JS has no effect');
    console.log('in Surge until the same file is pushed to that URL (+script-update-interval).');
    return;
  }

  const explicit = args.url || process.env.BEIZHI_RAW_URL;
  const repo = args.repo || process.env.BEIZHI_REPO;
  const rawUrl = explicit || (repo ? rawUrlFor(repo) : null);

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST_JS, script, 'utf8');

  if (rawUrl) {
    module = module.split(PLACEHOLDER).join(
      rawUrl.replace(/^https:\/\/raw\.githubusercontent\.com\//, '').replace(/\/beizhi_checkin\.js$/, '')
    );
    // Simpler and more robust: replace every script-path value wholesale.
    module = module.replace(/script-path=https?:\/\/\S+?\.js/g,
      'script-path=' + rawUrl);
  }

  fs.writeFileSync(DIST_MODULE, module, 'utf8');

  console.log('wrote ' + path.relative(ROOT, DIST_JS));
  console.log('wrote ' + path.relative(ROOT, DIST_MODULE));
  if (rawUrl) {
    console.log('script-path  -> ' + rawUrl);
    console.log('\nPublish ' + path.relative(ROOT, DIST_JS) + ' at exactly that URL,');
    console.log('then install ' + path.relative(ROOT, DIST_MODULE) + ' in Surge.');
  } else {
    console.log('\nNo --repo / --url given: the module still contains the REPLACE_ME');
    console.log('placeholder. Re-run with `--repo <user>/<repo>` to bake in your raw URL.');
  }
}

main();
