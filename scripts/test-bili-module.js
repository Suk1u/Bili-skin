'use strict';
/*
 * B站装扮工作室 —— .sgmodule 与脚本的一致性测试
 *
 * 这个文件存在的唯一理由：前面两个测试都直接按 URL 调 handler，
 * **绕过了 [Script] 的 pattern**，所以下面两类 bug 它们永远抓不到：
 *   1) pattern 写错（多一个 /、少一个转义）→ 规则根本不触发，功能整条静默失效；
 *   2) pattern 放宽了但 main() 里的分派没跟上 → 规则命中了，脚本却掉进
 *      handleCandidates 把 HTML 当 JSON 解析，同样静默失效。
 * 2026-10-18 两类都真实踩过（splash 的 `splash\//`、注入页放宽到 /h5/garb/*）。
 *
 * 这里做的是「静态 + 行为」双向校验：
 *   - 静态：每条规则必须能命中一条真实样例 URL；MITM 必须覆盖规则能碰的主机。
 *   - 行为：把样例 URL 喂给构建产物，确认脚本真的走到了预期分支。
 */
const fs = require('fs');
const path = require('path');
const { runSurgeScript, assert } = require(
  'C:/Users/VOS-User/.workbuddy-ai/skills/surge-scripting/scripts/surge_mock.js'
);

const ROOT = path.resolve(__dirname, '..');
const MODULE = fs.readFileSync(path.join(ROOT, 'BiliSkinStudio.sgmodule'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'bili_skin.js'), 'utf8');

/* ---------- 解析 [Script] 与 [MITM] ---------- */

function parseRules(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let section = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section !== 'Script') continue;
    const m = /^(\S+)\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const opts = {};
    m[2].split(',').forEach(function (kv) {
      const i = kv.indexOf('=');
      if (i < 0) return;
      opts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    out.push({ name: m[1], type: opts.type, pattern: opts.pattern, opts: opts });
  }
  return out;
}

function parseMitmHosts(text) {
  const m = /^hostname\s*=\s*(.+)$/m.exec(text);
  if (!m) return [];
  return m[1]
    .replace(/%APPEND%/i, '')
    .split(',')
    .map(function (s) {
      return s.trim().toLowerCase();
    })
    .filter(Boolean);
}

const RULES = parseRules(MODULE);
const MITM = parseMitmHosts(MODULE);

/* MITM 主机是否覆盖某个具体主机名（支持 *.suffix 通配） */
function mitmCovers(host) {
  const h = String(host).toLowerCase();
  for (const rule of MITM) {
    if (rule === h) return true;
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1); /* .hdslb.com */
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    }
  }
  return false;
}

/* ---------- 每条规则的样例 URL / 能碰到的主机 ---------- */

const CASES = [
  {
    rule: 'BiliSkinBridge',
    sample: 'https://app.bilibili.com/x/surge-skin/set',
    hosts: ['app.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinApply',
    sample: 'https://app.bilibili.com/x/resource/show/skin?vmid=1',
    hosts: ['app.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinInject',
    sample: 'https://www.bilibili.com/h5/mall/home',
    hosts: ['www.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinSniff',
    sample: 'https://api.bilibili.com/x/garb/mall/suit/all',
    hosts: ['api.bilibili.com', 'app.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinCard',
    sample: 'https://api.bilibili.com/x/v2/reply/wbi/main?oid=1',
    hosts: ['api.bilibili.com', 'app.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinSplash',
    sample: 'https://app.bilibili.com/x/v2/splash/brand/list',
    hosts: ['app.bilibili.com', 'api.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinChronos',
    sample: 'https://app.bilibili.com/x/chronos/package/obtain?service_key=splash',
    hosts: ['app.bilibili.com', 'api.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinSpace',
    sample: 'https://app.bilibili.com/x/v2/account/mine?build=1',
    hosts: ['app.bilibili.com', 'api.bilibili.com'],
    binary: false
  },
  {
    rule: 'BiliSkinGrpc',
    sample:
      'https://grpc.biliapi.net/bilibili.vas.garb.service.BAPIVasGarbService/SailingEquipMulti',
    hosts: ['grpc.biliapi.net'],
    binary: true
  },
  {
    rule: 'BiliSkinCache',
    sample: 'https://queue.package.bfcchronos.bilibili.com/abc.cron',
    hosts: ['queue.package.bfcchronos.bilibili.com', 'i0.hdslb.com'],
    binary: true
  }
];

function ruleByName(name) {
  const r = RULES.find(function (x) {
    return x.name === name;
  });
  assert(r, '模块里找不到规则 ' + name);
  return r;
}

/* ---------- 注入页：模块规则 与 脚本分派 必须一致 ---------- */

const INJECT_CORPUS = [
  /* 应该注入 */
  ['https://www.bilibili.com/h5/mall/home', true],
  ['https://www.bilibili.com/h5/mall/suit/detail?id=1', true],
  ['https://www.bilibili.com/h5/garb/draw-card', true],
  ['https://www.bilibili.com/h5/garb/digital-card', true],
  ['https://www.bilibili.com/blackboard/fe/suit-preview.html?item_id=1', true],
  ['https://www.bilibili.com/blackboard/fe/act-2026.html', true],
  ['https://www.bilibili.com/garb/collection-hall/', true],
  ['https://www.bilibili.com/garb/detail/123', true],
  /* 不该注入 */
  ['https://www.bilibili.com/video/BV1xx411c7mD', false],
  ['https://www.bilibili.com/', false],
  ['https://www.bilibili.com/read/cv123', false]
];

const HTML = '<!DOCTYPE html><html><head><title>t</title></head><body>app</body></html>';

async function injects(url) {
  const r = await runSurgeScript(SRC, {
    type: 'http-response',
    request: { url: url, method: 'GET', headers: {} },
    response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: HTML }
  });
  assert(!r.errors.length, url + ' 抛错：' + r.errors.join('|'));
  return !!(r.result && typeof r.result.body === 'string' && r.result.body.indexOf('__BSS_LOADED__') >= 0);
}

/* ---------- 用例 ---------- */

const tests = [];
function t(name, fn) {
  tests.push({ name: name, fn: fn });
}

t('模块/十条 [Script] 行且 script-path 一致', function () {
  assert(RULES.length === 10, '预期 10 条规则，实际 ' + RULES.length);
  const urls = new Set(
    RULES.map(function (r) {
      return r.opts['script-path'];
    })
  );
  assert(urls.size === 1, 'script-path 不一致：' + Array.from(urls).join(' | '));
  assert(!MODULE.includes('REPLACE_ME'), '模块里还残留 REPLACE_ME 占位符');
  const url = Array.from(urls)[0];
  assert(/^https:\/\//.test(url) && /\.js$/.test(url), 'script-path 不是 https 的 .js：' + url);
});

t('模块/每条 pattern 都能命中一条真实 URL（防拼写错误）', function () {
  for (const c of CASES) {
    const r = ruleByName(c.rule);
    assert(r.pattern, c.rule + ' 没有 pattern');
    let re;
    try {
      re = new RegExp(r.pattern);
    } catch (e) {
      throw new Error(c.rule + ' 的 pattern 不是合法正则：' + e.message);
    }
    assert(re.test(c.sample), c.rule + ' 命中不了样例 URL：' + c.sample + '\n        pattern=' + r.pattern);
  }
});

t('模块/pattern 里没有多余的连续斜杠（曾经把 splash 整条打死）', function () {
  for (const r of RULES) {
    /* 协议头的 `:\/\/` 是合法的，先剥掉再看剩下的部分有没有 `\/` + `/` */
    const body = r.pattern.replace(/^\^?https\?:\\\/\\\//, '');
    assert(!/\\\/\//.test(body), r.name + ' 的 pattern 里有连续斜杠：' + r.pattern);
  }
});

t('模块/规则类型与 requires-body 正确', function () {
  for (const c of CASES) {
    const r = ruleByName(c.rule);
    assert(r.type === 'http-response' || r.type === 'http-request', c.rule + ' type 不对：' + r.type);
    assert(r.opts['requires-body'] === 'true', c.rule + ' 少了 requires-body=true');
    if (c.binary) {
      assert(r.opts['binary-body-mode'] === 'true', c.rule + ' 少了 binary-body-mode=true');
    }
  }
  assert(ruleByName('BiliSkinBridge').type === 'http-request', '桥必须是 http-request');
});

t('模块/MITM 覆盖每条规则能碰的主机', function () {
  for (const c of CASES) {
    for (const h of c.hosts) {
      assert(mitmCovers(h), c.rule + ' 会碰 ' + h + '，但 MITM hostname 没覆盖它');
    }
  }
});

t('模块/桥的 max-size 放得下整份导出', function () {
  const r = ruleByName('BiliSkinBridge');
  const size = Number(r.opts['max-size']);
  assert(size >= 2 * 1024 * 1024, '桥 max-size=' + size + '，整份导出（藏馆 300 套）会被截断');
});

t('模块/桥的 timeout 盖得住内部网络等待', function () {
  const r = ruleByName('BiliSkinBridge');
  const timeout = Number(r.opts.timeout);
  /* splash/set 拉图算 md5 用 20s，chronos/set 拉包用 30s */
  assert(timeout >= 30, '桥 timeout=' + timeout + 's，小于脚本内部的 30s 包下载，会提前掐断');
});

t('分派/注入页：模块命中 ⇔ 脚本真的注入', async function () {
  const injectRule = ruleByName('BiliSkinInject');
  const re = new RegExp(injectRule.pattern);
  for (const [url, want] of INJECT_CORPUS) {
    const moduleHit = re.test(url);
    const got = await injects(url);
    assert(
      moduleHit === got,
      url + '\n        模块规则命中=' + moduleHit + '，脚本实际注入=' + got +
        (moduleHit && !got ? '\n        → 规则放宽了但 main() 里的 INJECT_RE 没跟上' : '')
    );
    assert(got === want, url + ' 预期注入=' + want + '，实际=' + got);
  }
});

t('分派/每条规则都不抛错且会调 $done', async function () {
  const body = JSON.stringify({ code: 0, data: { list: [], items: [] } });
  for (const c of CASES) {
    const r = await runSurgeScript(SRC, {
      type: c.rule === 'BiliSkinBridge' ? 'http-request' : 'http-response',
      request: { url: c.sample, method: c.rule === 'BiliSkinBridge' ? 'GET' : 'GET', headers: {} },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: body }
    });
    assert(!r.errors.length, c.rule + ' 抛错：' + r.errors.join('|'));
    assert(r.done, c.rule + ' 没有调用 $done（Surge 会等超时）');
  }
});

/* ---------- 运行 ---------- */

(async function () {
  let pass = 0;
  const fails = [];
  for (const c of tests) {
    try {
      await c.fn();
      pass += 1;
      console.log('  PASS  ' + c.name);
    } catch (e) {
      fails.push(c.name + ' :: ' + e.message);
      console.log('  FAIL  ' + c.name + '\n        ' + e.message);
    }
  }
  console.log('\n' + pass + '/' + tests.length + ' passed');
  if (fails.length) {
    console.log('\nFailures:');
    fails.forEach(function (f) {
      console.log('  - ' + f);
    });
    process.exit(1);
  }
})();
