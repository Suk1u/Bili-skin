#!/usr/bin/env node
/**
 * Live regression: download the JS that the module's script-path actually
 * points at and run the full mock suite against THAT file, not the local src.
 *
 * This is the check that catches "I edited locally but never pushed" and
 * "the raw URL returns something else".
 *
 * Usage: node scripts/test-remote.js [rawUrl]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_URL = 'https://raw.githubusercontent.com/Suk1u/BeizhiDaily/main/beizhi_checkin.js';

const MOCK = require(
  'C:/Users/VOS-User/.workbuddy-ai/skills/surge-scripting/scripts/surge_mock.js'
);

const url = process.argv[2] || DEFAULT_URL;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  console.log('target: ' + url);

  let remote;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    remote = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('FAILED to download: ' + err.message);
    process.exit(1);
  }

  const local = fs.readFileSync(path.join(__dirname, '..', 'src', 'beizhi_checkin.js'));
  const remoteHash = sha256(remote);
  const localHash = sha256(local);

  console.log('remote sha256: ' + remoteHash);
  console.log('local  sha256: ' + localHash);
  if (remoteHash === localHash) {
    console.log('=> in sync\n');
  } else {
    console.log('=> OUT OF SYNC — the deployed script differs from src/');
    console.log('   push src/beizhi_checkin.js to the repo before relying on it.\n');
  }

  const code = remote.toString('utf8');

  // Syntax gate first. (node --check via a child process is blocked in some
  // sandboxes, so compile in-process instead.)
  try {
    new (require('vm').Script)(code, { filename: 'beizhi_checkin.js' });
    console.log('syntax: OK');
  } catch (err) {
    console.error('syntax FAILED: ' + err.message);
    process.exit(1);
  }

  // Then the behavioural smoke test against the deployed code.
  const J = { 'Content-Type': 'application/json' };
  const SITE = JSON.stringify({
    success: true,
    data: {
      checkin_enabled: true, turnstile_check: true, system_name: 'Liminality',
      quota_per_unit: 500000, custom_currency_symbol: '🍊'
    }
  });

  const report = await MOCK.runSurgeScript(code, {
    type: 'cron',
    argument: 'baseUrl=beizhi.dedyn.io&token=TK&userId=10086&timeout=20&notify=true&lowBalance=0',
    http: [
      { match: /\/api\/status/, body: SITE, headers: J },
      { match: /\/api\/user\/self/, body: JSON.stringify({ success: true, data: { id: 10086, username: 'tester', quota: 50000 } }), headers: J },
      { match: /\/api\/user\/checkin\?/, body: JSON.stringify({ success: true, data: { enabled: true, stats: { days: 0, records: [] } } }), headers: J },
      { match: /\/api\/user\/checkin/, body: JSON.stringify({ success: true, message: '签到成功', data: { quota_awarded: 2500, checkin_date: '2026-10-02' } }), headers: J }
    ],
    timeoutMs: 9000
  });

  let ok = true;
  if (!report.done) { console.error('FAIL: script never called $done()'); ok = false; }
  if (report.errors.length) { console.error('FAIL: ' + report.errors.join(' | ')); ok = false; }

  const n = report.notifications[0];
  if (!n) {
    console.error('FAIL: no notification produced');
    ok = false;
  } else {
    console.log('\nnotification:');
    console.log('  ' + n.title);
    n.body.split('\n').forEach(function (l) { console.log('  ' + l); });
    if (!/签到成功/.test(n.title)) { console.error('FAIL: unexpected title'); ok = false; }
    if (!/今日签到获得/.test(n.body)) { console.error('FAIL: no "today gain" line'); ok = false; }
    if (!/余额/.test(n.body)) { console.error('FAIL: no balance line'); ok = false; }
    if (n.body.indexOf('TK') !== -1) { console.error('FAIL: token leaked into notification'); ok = false; }
  }

  const led = report.storeWrites.filter(function (w) { return w.key === 'beizhi.ledger'; }).pop();
  if (!led) {
    console.error('FAIL: ledger not persisted');
    ok = false;
  } else {
    const L = JSON.parse(led.data);
    console.log('\nledger: ' + L.days.length + ' day(s), gain=' + L.days[0].gain +
      ' source=' + L.days[0].gainSource);
    if (L.days[0].gain !== 2500) { console.error('FAIL: gain should be 2500'); ok = false; }
  }

  console.log('\n' + (ok ? 'LIVE REGRESSION PASSED' : 'LIVE REGRESSION FAILED'));
  process.exit(ok ? 0 : 1);
}

main().catch(function (err) {
  console.error('harness error: ' + ((err && err.stack) || err));
  process.exit(1);
});
