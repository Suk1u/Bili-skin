'use strict';
/*
 * B站装扮工作室 —— H5 注入脚本的测试
 *
 * src/bili_h5.js 跑在 B 站 H5 页面里，本地没有真 DOM，
 * 这里用最小桩顶起 window/document/location，只测纯逻辑：
 *   URL/DOM 扫描、装扮对象提取、递归查找、候选去重、卡片 HTML。
 * 另外验证 dist 产物里的内联副本与 src 完全一致（防构建漂移）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const H5_SRC = fs.readFileSync(path.join(ROOT, 'src', 'bili_h5.js'), 'utf8');
const BUILT = fs.readFileSync(path.join(ROOT, 'bili_skin.js'), 'utf8');

/* ---------- 最小 DOM 桩 ---------- */

function makeNode() {
  return {
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    offsetWidth: 72,
    offsetHeight: 30,
    setAttribute: function () {},
    getAttribute: function () {
      return null;
    },
    appendChild: function () {},
    remove: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () {
      return makeNode();
    },
    querySelectorAll: function () {
      return [];
    },
    closest: function () {
      return null;
    },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: 72, height: 30 };
    }
  };
}

function link(href) {
  const n = makeNode();
  n.getAttribute = function (k) {
    return k === 'href' ? href : null;
  };
  return n;
}

function makeEnv(opts) {
  opts = opts || {};
  const store = {};
  const sandbox = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    setTimeout: function () {
      return 0;
    },
    clearTimeout: function () {},
    setInterval: function () {
      return 0;
    },
    clearInterval: function () {},
    Promise: Promise,
    JSON: JSON,
    Math: Math,
    Date: Date,
    Number: Number,
    String: String,
    Object: Object,
    Array: Array,
    RegExp: RegExp,
    Error: Error,
    fetch: function () {
      return Promise.reject(new Error('no network in test'));
    },
    localStorage: {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: function (k, v) {
        store[k] = String(v);
      },
      removeItem: function (k) {
        delete store[k];
      }
    },
    location: Object.assign(
      { pathname: '/', search: '', hash: '', href: 'https://www.bilibili.com/' },
      opts.location || {}
    ),
    history: { pushState: function () {}, replaceState: function () {} },
    document: {
      createElement: function () {
        return makeNode();
      },
      addEventListener: function () {},
      body: makeNode(),
      querySelectorAll: function (sel) {
        return /a\[href\]/.test(sel) ? opts.links || [] : [];
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = function () {};
  sandbox.window.innerWidth = 390;
  sandbox.window.innerHeight = 844;
  vm.createContext(sandbox);
  vm.runInContext(H5_SRC, sandbox, { filename: 'bili_h5.js' });
  return sandbox;
}

const API = makeEnv().__BSS_API__;

/* ---------- 断言 ---------- */

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), msg + '  (got ' + JSON.stringify(a) + ')');
}

/* ---------- 样例 ---------- */

const DETAIL = {
  code: 0,
  data: {
    item: { item_id: 67790, name: '2024愚人节·小会员', state: 'active' },
    suit_items: {
      skin: [
        {
          item_id: 67791,
          name: '2024愚人节·小会员',
          properties: {
            package_url: 'https://i0.hdslb.com/bfs/garb/zip/2a2dfa59.zip',
            package_md5: '8dd1d048a8d3377674f89ba4f8dc68e9',
            ver: 1711761021,
            image_cover: 'https://i0.hdslb.com/cover.jpg',
            image_preview: 'https://i0.hdslb.com/preview.jpg',
            color: '#ffffff',
            color_mode: 'dark',
            color_second_page: '#1c1c1c',
            tail_color: '#ffffff',
            tail_color_selected: '#40f368',
            tail_icon_ani: 'true',
            tail_icon_ani_mode: 'loop',
            tail_icon_mode: 'img'
          }
        }
      ]
    }
  }
};

const tests = [];
function t(name, fn) {
  tests.push({ name: name, fn: fn });
}

/* ===== URL / 工具 ===== */

t('idFrom/各参数名', function () {
  eq(API.idFrom('?id=67790'), '67790', 'id');
  eq(API.idFrom('?item_id=42193'), '42193', 'item_id');
  eq(API.idFrom('?suit_id=123'), '123', 'suit_id');
  eq(API.idFrom('?act_id=113353'), '113353', 'act_id');
  eq(API.idFrom('/h5/mall/home'), '', '无参数');
  eq(API.idFrom(null), '', 'null 安全');
});

t('thumb/只给 B站图加缩略图参数', function () {
  eq(API.thumb('https://i0.hdslb.com/x.jpg'), 'https://i0.hdslb.com/x.jpg@360w_360h_1c.webp', '加后缀');
  eq(API.thumb('https://other.com/x.jpg'), 'https://other.com/x.jpg', '外站不加');
  eq(API.thumb(''), '', '空串');
  eq(API.thumb(null), '', 'null');
});

/* ===== 装扮对象提取 ===== */

t('equipFrom/完整字段 1:1 映射', function () {
  const e = API.equipFrom(DETAIL.data, DETAIL.data.suit_items.skin[0]);
  assert(e, 'should build');
  eq(e.id, 67790, 'id 取 item.item_id');
  eq(e.name, '2024愚人节·小会员', 'name');
  eq(e.preview, 'https://i0.hdslb.com/preview.jpg', 'preview 优先 image_preview');
  eq(e.ver, 1711761021, 'ver');
  eq(e.package_url, 'https://i0.hdslb.com/bfs/garb/zip/2a2dfa59.zip', 'package_url');
  eq(e.package_md5, '8dd1d048a8d3377674f89ba4f8dc68e9', 'package_md5');
  eq(e.data.color, '#ffffff', 'color');
  eq(e.data.color_mode, 'dark', 'color_mode');
  eq(e.data.color_second_page, '#1c1c1c', 'color_second_page');
  eq(e.data.tail_color_selected, '#40f368', 'tail_color_selected');
  eq(e.data.tail_icon_ani, true, "tail_icon_ani 'true' -> true");
  eq(e.data.tail_icon_ani_mode, 'loop', 'ani mode');
});

t('equipFrom/无 package_url -> null', function () {
  eq(API.equipFrom({}, { properties: {} }), null, 'null');
  eq(API.equipFrom(null, null), null, 'null safe');
});

t('equipFrom/缺配色字段走默认值', function () {
  const skin = { item_id: 9, name: 'x', properties: { package_url: 'https://a/b.zip' } };
  const e = API.equipFrom({ item: { item_id: 8, name: 'y' } }, skin);
  eq(e.id, 8, 'id 优先 item');
  eq(e.name, 'y', 'name 优先 item');
  eq(e.data.color, '#212121', 'default color');
  eq(e.data.color_mode, 'light', 'default mode');
  eq(e.data.tail_color, '#996c00', 'default tail');
  eq(e.data.tail_icon_ani, false, 'default ani');
  eq(e.data.tail_icon_ani_mode, 'once', 'default ani mode');
});

t('equipFrom/item 缺失时回落到 skin', function () {
  const skin = { item_id: 9, name: '来自 skin', properties: { package_url: 'https://a/b.zip' } };
  const e = API.equipFrom({}, skin);
  eq(e.id, 9, 'id 回落');
  eq(e.name, '来自 skin', 'name 回落');
});

t('toEquip/详情响应', function () {
  eq(API.toEquip(DETAIL).id, 67790, 'id');
  eq(API.toEquip({ code: -400 }), null, '无 data');
  eq(API.toEquip(null), null, 'null');
  const empty = JSON.parse(JSON.stringify(DETAIL));
  empty.data.suit_items.skin = [];
  eq(API.toEquip(empty), null, '无 skin 子项');
});

/* ===== 递归查找 ===== */

t('harvest/深层嵌套也能找到', function () {
  const out = [];
  API.harvest({ a: { b: [{ c: DETAIL.data }] } }, out, 0);
  eq(out.length, 1, 'found one');
  eq(out[0].id, 67790, 'id');
});

t('harvest/多个装扮全部找到', function () {
  const d2 = JSON.parse(JSON.stringify(DETAIL.data));
  d2.item.item_id = 111;
  d2.suit_items.skin[0].properties.package_url = 'https://a/2.zip';
  const out = [];
  API.harvest([DETAIL.data, d2], out, 0);
  eq(out.length, 2, 'found two');
  eq([out[0].id, out[1].id], [67790, 111], 'both ids');
});

t('harvest/无 suit_items 不产生结果', function () {
  const out = [];
  API.harvest({ data: { category: [{ suits: [{ item_id: 1, name: 'x' }] }] } }, out, 0);
  eq(out.length, 0, 'suit/all 这类目录不该被当成候选');
});

t('harvest/深度上限保护', function () {
  let deep = DETAIL.data;
  for (let i = 0; i < 20; i++) deep = { n: deep };
  const out = [];
  API.harvest(deep, out, 0);
  eq(out.length, 0, '超深不递归');
});

t('harvest/空值安全', function () {
  const out = [];
  API.harvest(null, out, 0);
  API.harvest(undefined, out, 0);
  API.harvest('str', out, 0);
  API.harvest(42, out, 0);
  eq(out.length, 0, 'no crash');
});

t('scanState/从 __INITIAL_MIRROR__ 里捞', function () {
  const win = { __INITIAL_MIRROR__: { page: { detail: DETAIL.data } } };
  const out = API.scanState(win);
  eq(out.length, 1, 'found');
  eq(out[0].id, 67790, 'id');
});

t('scanState/多个全局对象都扫', function () {
  const win = {
    __INITIAL_MIRROR__: { x: DETAIL.data },
    __NUXT__: { y: JSON.parse(JSON.stringify(DETAIL.data)) }
  };
  eq(API.scanState(win).length, 2, 'two hits');
});

t('scanState/无全局对象返回空', function () {
  eq(API.scanState({}).length, 0, 'empty');
});

/* ===== URL / DOM 扫描 ===== */

t('collectIds/URL 参数', function () {
  const ids = API.collectIds({ querySelectorAll: () => [] }, { search: '?id=67790&navhide=1', hash: '' });
  eq(ids, ['67790'], 'from search');
});

t('collectIds/hash 路由', function () {
  const ids = API.collectIds({ querySelectorAll: () => [] }, { search: '', hash: '#/suit/detail?id=1234' });
  eq(ids, ['1234'], 'from hash');
});

t('collectIds/DOM 链接', function () {
  const doc = { querySelectorAll: () => [link('/h5/mall/suit/detail?id=555'), link('/video/BV1')] };
  const ids = API.collectIds(doc, { search: '', hash: '' });
  eq(ids, ['555'], 'only mall links');
});

t('collectIds/去重且限制数量', function () {
  const many = [];
  for (let i = 0; i < 20; i++) many.push(link('/h5/mall/suit/detail?id=' + (1000 + i)));
  const doc = { querySelectorAll: () => many };
  const ids = API.collectIds(doc, { search: '?id=1000', hash: '' });
  eq(ids.length, 8, 'capped at 8');
  eq(ids[0], '1000', 'url id first');
});

t('collectIds/过滤过短 id', function () {
  const doc = { querySelectorAll: () => [link('/h5/mall/suit/detail?id=12')] };
  eq(API.collectIds(doc, { search: '', hash: '' }), [], 'id 太短丢弃');
});

t('collectIds/DOM 抛异常不炸', function () {
  const doc = {
    querySelectorAll: function () {
      throw new Error('boom');
    }
  };
  eq(API.collectIds(doc, { search: '?id=777', hash: '' }), ['777'], '仍返回 URL 里的');
});

/* ===== 合并 ===== */

t('mergeById/跨来源去重', function () {
  const a = [API.toEquip(DETAIL)];
  const b = [API.toEquip(DETAIL), { id: 222, package_url: 'https://a/2.zip', name: 'b' }];
  const out = API.mergeById(a, b);
  eq(out.length, 2, 'deduped');
  eq([out[0].id, out[1].id], [67790, 222], 'order preserved');
});

t('mergeById/丢弃不完整条目', function () {
  const out = API.mergeById([{ id: 1 }, null, { id: 2, package_url: 'https://a/2.zip' }, { package_url: 'x' }]);
  eq(out.length, 1, 'only valid');
  eq(out[0].id, 2, 'id 2');
});

t('mergeById/空入参', function () {
  eq(API.mergeById().length, 0, 'no args');
  eq(API.mergeById(null, undefined, []).length, 0, 'nulls');
});

/* ===== 卡片渲染 ===== */

t('cardHtml/用 aspect-ratio 不用 padding-top 撑高', function () {
  const html = API.cardHtml({ id: 1, name: '测试', preview: 'https://i0.hdslb.com/a.jpg' });
  assert(html.indexOf('aspect-ratio:1/1') >= 0, 'has aspect-ratio');
  assert(html.indexOf('padding-top:100%') < 0, '不再用 padding-top 撑高');
  assert(html.indexOf('position:absolute') < 0, '图片不再绝对定位');
});

t('cardHtml/图片走 360 缩略图', function () {
  const html = API.cardHtml({ id: 1, name: 'x', preview: 'https://i0.hdslb.com/a.jpg' });
  assert(html.indexOf('@360w_360h_1c.webp') >= 0, 'thumb suffix applied');
});

t('cardHtml/带 data-id 与 data-apply', function () {
  const html = API.cardHtml({ id: 67790, name: 'x', preview: '' });
  assert(html.indexOf('data-id="67790"') >= 0, 'data-id');
  assert(html.indexOf('data-apply="67790"') >= 0, 'data-apply');
});

t('cardHtml/转义名称防注入', function () {
  const html = API.cardHtml({ id: 1, name: '<img onerror=alert(1)>', preview: '' });
  assert(html.indexOf('<img onerror') < 0, 'escaped');
  assert(html.indexOf('&lt;img') >= 0, 'entity used');
});

/* ===== 时间戳 ===== */

t('markEnter/刷新进入时间', function () {
  const env = makeEnv();
  const before = env.__BSS_API__.enterTs();
  const t0 = Date.now();
  env.__BSS_API__.markEnter();
  const after = env.__BSS_API__.enterTs();
  assert(after >= before, 'monotonic');
  assert(after >= t0 - 5 && after <= Date.now() + 5, 'updated to now');
});

/* ===== 构建一致性 ===== */

function injectInto(html) {
  const captured = { body: null };
  const sandbox = {
    $script: { type: 'http-response' },
    $request: { url: 'https://www.bilibili.com/h5/mall/suit/detail?id=1', method: 'GET', headers: {} },
    $response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: html },
    $persistentStore: { read: () => null, write: () => {} },
    $done: function (o) {
      captured.body = o.body;
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(BUILT, sandbox, { filename: 'bili_skin.js' });
  return captured.body;
}

t('构建/dist 内联副本与 src 一致', function () {
  const html = injectInto('<!DOCTYPE html><html><head></head><body></body></html>');
  assert(html, 'injection produced a body');
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert(m, 'found injected script tag');
  const injected = m[1].replace(/<\\\/script/gi, '</script');
  const expect = H5_SRC.replace(/<\/script/gi, '<\\/script').replace(/<\\\/script/gi, '</script');
  eq(injected === expect, true, 'dist 内联的 payload 与 src/bili_h5.js 完全一致');
});

t('构建/注入的 payload 可独立执行', function () {
  const html = injectInto('<!DOCTYPE html><html><head></head><body></body></html>');
  const payload = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const env = makeEnv();
  vm.createContext(env);
  vm.runInContext(payload, env, { filename: 'injected.js' });
  assert(env.__BSS_LOADED__, 'payload self-executed');
  assert(env.__BSS_API__ && typeof env.__BSS_API__.toEquip === 'function', 'API exposed');
  eq(env.__BSS_API__.toEquip(DETAIL).id, 67790, 'works after round-trip through dist');
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
