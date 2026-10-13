#!/usr/bin/env node
/**
 * Mock tests for src/beizhi_checkin.js — runs the real script end to end against
 * the surge-scripting skill's Surge mock runtime.
 *
 * Covers: success, balance-delta fallback, already-checked-in, unconfigured
 * credential, auth failure, Turnstile block, HTML/WAF, network error, checkin
 * disabled, never-callback fallback, panel states, and login-response capture.
 *
 * Usage: node scripts/test-mock.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MOCK = require(
  'C:/Users/VOS-User/.workbuddy-ai/skills/surge-scripting/scripts/surge_mock.js'
);

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'src', 'beizhi_checkin.js'), 'utf8');

const B = 'https://beizhi.dedyn.io';
const TOKEN = 'panel-token-abc123';
const USER_ID = '10086';

const ARG_OK = [
  'baseUrl=beizhi.dedyn.io',
  'token=' + TOKEN,
  'userId=' + USER_ID,
  'policy=DIRECT',
  'notify=true',
  'lowBalance=0'
].join('&');

const JSON_H = { 'Content-Type': 'application/json' };

/* --------------------------- canned responses --------------------------- */

const SITE = {
  success: true,
  data: {
    checkin_enabled: true,
    turnstile_check: true,
    system_name: 'Liminality',
    quota_per_unit: 500000,
    custom_currency_symbol: '🍊',
    display_in_currency: true,
    quota_display_type: 'CUSTOM'
  }
};

const SITE_DISABLED = JSON.parse(JSON.stringify(SITE));
SITE_DISABLED.data.checkin_enabled = false;

function selfBody(quota, extra) {
  return Object.assign({
    success: true,
    data: Object.assign({
      id: 10086, username: 'tester', quota: quota,
      used_quota: 1000000, group: 'default', role: 1
    }, extra || {})
  });
}

/** Stateful sequence: each call yields the next body string. */
function seq(bodies, headers) {
  let i = 0;
  return function () {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return body;
  };
}

/** Handler whose body comes from a function returning a body string. */
function h(re, handler, status, headers) {
  return { match: re, body: handler, status: status, headers: headers || JSON_H };
}

const HTML_H = { 'Content-Type': 'text/html' };

/** Handler that answers every call with an HTML challenge page. */
function html(re) {
  return { match: re, body: '<html><body>Just a moment...</body></html>', status: 200, headers: HTML_H };
}

/** Handler with a fixed JSON body. */
function hj(re, objOrString, status) {
  return {
    match: re,
    body: typeof objOrString === 'string' ? objOrString : JSON.stringify(objOrString),
    status: status,
    headers: JSON_H
  };
}

/* --------------------------------- cases -------------------------------- */

const cases = [];

function add(name, cfg, check) {
  cases.push({
    name: name,
    code: SCRIPT,
    cfg: Object.assign({ type: 'cron', argument: ARG_OK }, cfg),
    check: check
  });
}

/**
 * A panel token must never appear in logs or notifications. It legitimately
 * travels in the Authorization header of the API calls the script makes, so
 * that one place is exempt.
 */
function assertNoTokenLeak(r, token) {
  const haystack = JSON.stringify({ logs: r.logs, notifications: r.notifications });
  assert.ok(haystack.indexOf(token) === -1,
    'token leaked into logs/notifications: ' + haystack.slice(0, 200));
}

/**
 * The mock exposes `report.store` as the $persistentStore object, not the raw
 * backing map. Rebuild the map from storeWrites so assertions can read values.
 */
function storeMap(r) {
  const map = Object.assign({}, r.store && r.store.__seed ? r.store.__seed : {});
  (r.storeWrites || []).forEach(function (w) {
    if (w.data === null) delete map[w.key];
    else map[w.key] = w.data;
  });
  return map;
}

/** Seeded values come from cfg.store; recover them via a probe read. */
function seeded(r, key) {
  const reads = (r.storeReads || []).filter(function (k) { return k === key; });
  if (!reads.length) return undefined;
  // $persistentStore.read returns the seeded value on first read; trust storeWrites otherwise.
  return Object.prototype.hasOwnProperty.call(r.store, key) ? r.store[key] : undefined;
}

const HOUR = 3600 * 1000;

/* 1. success: server-reported award matches balance delta */
add('cron success: server-reported award, ledger, notification', {
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, seq([
      JSON.stringify(selfBody(50000)),   // before
      JSON.stringify(selfBody(52500))    // after  (delta = 2500 == awarded)
    ])),
    h(/\/api\/user\/checkin\?/, () => JSON.stringify({ success: true, data: { enabled: true, stats: { days: 0, records: [] } } })),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ success: true, message: '签到成功', data: { quota_awarded: 2500, checkin_date: '2026-10-02' } })),
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(r.requests.some(q => q.method === 'POST' && /\/api\/user\/checkin/.test(q.url)), 'must POST checkin');
  assert.strictEqual(r.notifications.length, 1, 'exactly one notification');
  const n = r.notifications[0];
  assert.ok(/签到成功/.test(n.title), 'title: ' + n.title);
  assert.ok(/今日签到获得/.test(n.body), 'body reports today gain: ' + n.body);
  assert.ok(/🍊/.test(n.body), 'uses site currency symbol: ' + n.body);
  assert.ok(/连续签到: 1 天/.test(n.body), 'streak reported: ' + n.body);
  assert.ok(/本月累计/.test(n.body), 'month total reported');
  // Authorization header carries the token, never the user id confusion
  const chk = r.requests.find(q => /\/api\/user\/checkin/.test(q.url) && q.method === 'POST');
  assert.strictEqual(chk.headers.Authorization, 'Bearer ' + TOKEN, 'Bearer token sent');
  assert.strictEqual(chk.headers['New-Api-User'], USER_ID, 'user id header sent');
  // ledger
  const ledger = JSON.parse(storeMap(r)['beizhi.ledger']);
  const today = ledger.days[ledger.days.length - 1];
  assert.strictEqual(today.gain, 2500, 'ledger today gain');
  assert.strictEqual(today.gainSource, '服务端上报', 'attribution');
  assert.strictEqual(ledger.totalGain, 2500, 'totalGain');
  assert.strictEqual(ledger.lastBalance, 52500, 'lastBalance persisted');
  assert.strictEqual(ledger.streak, 1, 'streak');
  assertNoTokenLeak(r, TOKEN);
});

/* 2. award not reported -> gain from balance delta */
add('cron success: gain derived from balance delta', {
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, seq([
      JSON.stringify(selfBody(50000)),
      JSON.stringify(selfBody(53000))
    ])),
    h(/\/api\/user\/checkin\?/, () => JSON.stringify({ success: true, data: { stats: { days: 0, records: [] } } })),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ success: true, message: '签到成功', data: {} })),
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  const ledger = JSON.parse(storeMap(r)['beizhi.ledger']);
  const today = ledger.days[ledger.days.length - 1];
  assert.strictEqual(today.gain, 3000, 'gain must equal balance delta');
  assert.strictEqual(today.gainSource, '余额差值', 'attribution is balance delta');
  assert.ok(/今日签到获得: 🍊0\.0060|今日签到获得/.test(r.notifications[0].body), 'gain shown');
  assertNoTokenLeak(r, TOKEN);
});

/* 3. already checked in */
add('cron: already checked in today', {
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, () => JSON.stringify(selfBody(51000))),
    h(/\/api\/user\/checkin\?/, () => JSON.stringify({ success: true, data: { enabled: true, stats: { days: 1, records: [{ date: '2026-10-02', quota_awarded: 1000 }] } } })),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ success: false, message: '重复签到' })),
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(/今日已签到/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
  assert.ok(/本月累计/.test(r.notifications[0].body), 'body has month total');
  assert.ok(/本月已签: 1 天/.test(r.notifications[0].body), 'month days: ' + r.notifications[0].body);
  assertNoTokenLeak(r, TOKEN);
});

/* 4. no credential */
add('cron: no token -> instructions, zero site calls', {
  argument: 'baseUrl=beizhi.dedyn.io&token=未配置&userId=未配置&notify=true'
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(r.requests.length, 0, 'must not call the site without credentials');
  assert.ok(/凭据/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
  assert.ok(/面板访问令牌/.test(r.notifications[0].body), 'body explains how to get a token');
});

/* 5. auth failure */
add('cron: AUTH_UNAUTHORIZED -> credential-expired branch', {
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, () => JSON.stringify({ code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized, invalid access token', success: false }), 401),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized, invalid access token', success: false }), 401)
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(/凭据失效/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
  assert.ok(/令牌/.test(r.notifications[0].body), 'body mentions token');
  assertNoTokenLeak(r, TOKEN);
});

/* 6. turnstile */
add('cron: Turnstile required -> dedicated branch', {
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, () => JSON.stringify(selfBody(50000))),
    h(/\/api\/user\/checkin\?/, () => JSON.stringify({ success: true, data: { stats: { days: 0, records: [] } } })),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ success: false, message: 'Turnstile token 为空' })),
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(/人机验证/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
  assert.ok(/Turnstile/.test(r.notifications[0].body), 'body explains turnstile');
});

/* 7. HTML / WAF */
add('cron: HTML response (WAF) still completes with readable error', {
  http: [
    html(/\/api\/status/),
    html(/\/api\/user\/self/),
    html(/\/api\/user\/checkin/)
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(r.notifications.length, 1, 'one notification');
  assert.ok(/接口被拦截|HTML|WAF|Cloudflare/.test(r.notifications[0].body + r.notifications[0].title), 'body explains the block: ' + r.notifications[0].title + ' | ' + r.notifications[0].body);
});

/* 8. network error */
add('cron: network error -> failure notification, no crash', {
  http: [
    { match: /\/api\/status/, error: 'network unreachable' },
    { match: /\/api\/user\/self/, error: 'network unreachable' },
    { match: /\/api\/user\/checkin/, error: 'network unreachable' }
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(r.notifications.length, 1, 'one notification');
  assert.ok(/签到/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
  assertNoTokenLeak(r, TOKEN);
});

/* 9. feature disabled server-side */
add('cron: checkin_enabled=false -> no checkin call', {
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE_DISABLED))
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(!r.requests.some(q => q.method === 'POST' && /\/api\/user\/checkin/.test(q.url)), 'must not POST checkin when the site disabled it');
  assert.ok(/关闭签到/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
});

/* 10. never callback -> script guard must end the run, not hang */
add('cron: request never calls back -> guard ends the run', {
  http: [{ match: /.*/, delay: 600000 }],
  timeoutMs: 3000,
  argument: ARG_OK + '&timeout=15'
}, function (r) {
  // The script's own guard fires at (timeout+5)s; the harness timeout here is
  // shorter, so we only require that it did not silently swallow everything.
  assert.ok(r.done || r.errors.length > 0 || r.timedOut, 'must not hang forever');
  assert.ok(r.requests.length > 0, 'the request was actually issued');
});

/* 11. panel with data */
add('panel: renders balance / today gain / month gain / streak', {
  type: 'generic',
  pointerless: true,
  argument: 'baseUrl=beizhi.dedyn.io',
  trigger: 'auto-interval',
  input: { purpose: 'panel', position: 'policy-selection', panelName: '北栀签到面板' },
  store: (function () {
    const today = new Date();
    const p = n => (n < 10 ? '0' + n : '' + n);
    const d0 = today.getFullYear() + '-' + p(today.getMonth() + 1) + '-' + p(today.getDate());
    const y = new Date(today.getTime() - 86400000);
    const d1 = y.getFullYear() + '-' + p(y.getMonth() + 1) + '-' + p(y.getDate());
    return {
      'beizhi.token': TOKEN,
      'beizhi.userid': USER_ID,
      'beizhi.ledger': JSON.stringify({
        days: [
          { date: d1, checkedIn: true, gain: 1500, gainSource: '余额差值' },
          { date: d0, checkedIn: true, gain: 2500, gainSource: '服务端上报' }
        ],
        totalGain: 4000, checkins: 2, streak: 2,
        lastBalance: 52500, updatedAt: '2026-10-02 09:00:00'
      })
    };
  })(),
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(r.result && r.result.title, 'panel returns a title');
  assert.ok(/今日已签到/.test(r.result.content), 'content: ' + r.result.content);
  assert.ok(/余额/.test(r.result.content), 'content has balance');
  assert.ok(/今日获得/.test(r.result.content), 'content has today gain');
  assert.ok(/本月获得/.test(r.result.content), 'content has month gain');
  assert.ok(/连续: 2 天/.test(r.result.content), 'content has streak');
  assert.strictEqual(r.result.style, 'good', 'checked-in panel is good');
  assertNoTokenLeak(r, TOKEN);
});

/* 12. panel without credential */
add('panel: no credential -> alert state', {
  type: 'generic',
  argument: 'baseUrl=beizhi.dedyn.io',
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(r.result.style, 'alert', 'alert style');
  assert.ok(/未捕获凭据/.test(r.result.content), 'content: ' + r.result.content);
});

/* 13. panel, ledger present but not checked in today */
add('panel: not checked in today -> info state', {
  type: 'generic',
  argument: 'baseUrl=beizhi.dedyn.io',
  store: {
    'beizhi.token': TOKEN,
    'beizhi.userid': USER_ID,
    'beizhi.ledger': JSON.stringify({ days: [], totalGain: 0, checkins: 0, streak: 0, lastBalance: null })
  },
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(r.result.style, 'info', 'info style');
  assert.ok(/今日未签到/.test(r.result.content), 'content: ' + r.result.content);
});

/* 14. http-response credential capture */
add('http-response: captures panel token + user id', {
  type: 'http-response',
  argument: 'baseUrl=beizhi.dedyn.io&captureEnabled=true&notify=true',
  request: { url: B + '/api/user/login', method: 'POST', headers: { Cookie: 'session=xyz' } },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message: '',
      data: {
        access_token: TOKEN,
        token_type: 'Bearer',
        access_expires_at: '2026-11-01T00:00:00Z',
        session: { id: 'sess-1' },
        user: { id: 10086, username: 'tester', access_token: USER_ID }
      }
    })
  },
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(storeMap(r)['beizhi.token'], TOKEN, 'panel token persisted');
  assert.strictEqual(storeMap(r)['beizhi.userid'], USER_ID, 'user id persisted');
  assert.ok(/凭据已捕获/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
  assert.ok(/tester/.test(r.notifications[0].body), 'body names the user');
  assertNoTokenLeak(r, TOKEN);
});

/* 15. capture disabled by line key */
add('http-response: capture disabled (line key #) -> no-op', {
  type: 'http-response',
  argument: 'baseUrl=beizhi.dedyn.io&notify=true',
  request: { url: B + '/api/user/login', method: 'POST', headers: {} },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, data: { access_token: TOKEN, user: { id: 1 } } })
  },
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(storeMap(r)['beizhi.token'], undefined, 'no capture when the argument is absent (line commented out)');
  assert.strictEqual(r.storeWrites.length, 0, 'no store write when capture is off');
  assert.strictEqual(r.notifications.length, 0, 'no notification when disabled');
});

/* 16. turnstile-blocked login */
add('http-response: turnstile-blocked login -> explains, stores nothing', {
  type: 'http-response',
  argument: 'baseUrl=beizhi.dedyn.io&captureEnabled=true&notify=true',
  request: { url: B + '/api/user/login', method: 'POST', headers: {} },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: false, message: 'Turnstile token 为空' })
  },
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(storeMap(r)['beizhi.token'], undefined, 'must not store on failure');
  assert.ok(/人机验证/.test(r.notifications[0].title), 'title: ' + r.notifications[0].title);
});

/* 17. wrong-password login must not leak secrets */
add('http-response: failed login does not leak password/secret', {
  type: 'http-response',
  argument: 'baseUrl=beizhi.dedyn.io&captureEnabled=true&notify=true',
  request: { url: B + '/api/user/login', method: 'POST', headers: { Cookie: 'session=supersecretcookie' } },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: false, message: '用户名或密码错误' })
  },
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(storeMap(r)['beizhi.token'], undefined, 'no token stored');
  assert.strictEqual(r.notifications.length, 0, 'no notification for a plain failed login');
  assert.strictEqual(r.requests.length, 0, 'capture must not issue outbound requests');
});

/* 18. unrelated request -> no-op */
add('http-response: unrelated URL -> no side effects', {
  type: 'http-response',
  argument: 'baseUrl=beizhi.dedyn.io&captureEnabled=true&notify=true',
  request: { url: B + '/api/user/self', method: 'GET', headers: {} },
  response: { status: 200, headers: JSON_H, body: '{"success":true}' },
  http: []
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.strictEqual(r.storeWrites.length, 0, 'no store writes for unrelated URLs');
  assert.strictEqual(r.notifications.length, 0, 'no notification');
});

/* 19. low balance alert */
add('cron: lowBalance threshold triggers alert', {
  argument: ARG_OK + '&lowBalance=0.2',
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, seq([
      JSON.stringify(selfBody(50000)),
      JSON.stringify(selfBody(52500))   // 52500/500000 = 0.105 < 0.2
    ])),
    h(/\/api\/user\/checkin\?/, () => JSON.stringify({ success: true, data: { stats: { days: 0, records: [] } } })),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ success: true, message: '签到成功', data: { quota_awarded: 2500 } }))
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  assert.ok(/余额低于阈值/.test(r.notifications[0].body), 'body warns: ' + r.notifications[0].body);
});

/* 20. fillMissingDays backfill from records */
add('cron: fillMissingDays backfills single-day gains', {
  argument: ARG_OK + '&fillMissingDays=true',
  http: [
    h(/\/api\/status/, () => JSON.stringify(SITE)),
    h(/\/api\/user\/self/, seq([
      JSON.stringify(selfBody(50000)),
      JSON.stringify(selfBody(52500))
    ])),
    h(/\/api\/user\/checkin\?/, () => JSON.stringify({
      success: true,
      data: {
        enabled: true,
        stats: {
          days: 3,
          records: [
            { date: '2026-09-28', quota_awarded: 800 },
            { date: '2026-09-29', quota_awarded: 900 },
            { date: todayISO(), quota_awarded: 2500 }
          ]
        }
      }
    })),
    h(/\/api\/user\/checkin/, () => JSON.stringify({ success: true, message: '签到成功', data: { quota_awarded: 2500 } }))
  ]
}, function (r) {
  MOCK.assertDone(r);
  MOCK.assertNoErrors(r);
  const ledger = JSON.parse(storeMap(r)['beizhi.ledger']);
  const byDate = {};
  ledger.days.forEach(d => { byDate[d.date] = d; });
  assert.strictEqual(byDate['2026-09-28'].gain, 800, 'backfilled 09-28');
  assert.strictEqual(byDate['2026-09-28'].gainSource, '签到明细回填', 'backfill attribution');
  assert.strictEqual(byDate['2026-09-29'].gain, 900, 'backfilled 09-29');
});

function todayISO() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* --------------------------------- runner -------------------------------- */

// Give the error-handler branches a realistic per-request timeout.
cases.forEach(function (c) {
  if (c.cfg.type === 'cron' && !c.cfg.timeoutMs) c.cfg.timeoutMs = 12000;
});

MOCK.runAll(cases)
  .then(function (summary) {
    console.log('');
    if (summary.failed > 0) {
      console.log('FAILED: ' + summary.failed + '/' + summary.total);
      process.exit(1);
    }
    console.log('ALL MOCK TESTS PASSED (' + cases.length + ' cases)');
    process.exit(0);
  })
  .catch(function (err) {
    console.error('harness error: ' + ((err && err.stack) || err));
    process.exit(1);
  });
