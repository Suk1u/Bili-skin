'use strict';
/*
 * B站装扮工作室 —— H5 注入脚本的测试
 *
 * src/bili_h5.js 是跑在 B 站 H5 页面里的浏览器脚本，本地没有真 DOM，
 * 这里用最小桩把 window/document/location 顶起来，只测纯逻辑：
 *   URL 解析、详情响应 -> user_equip 组装、目录扁平化、藏馆合并。
 * 另外验证 dist 产物里的内联副本与 src 完全一致（防构建漂移）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const H5_SRC = fs.readFileSync(path.join(ROOT, 'src', 'bili_h5.js'), 'utf8');
const BUILT = fs.readFileSync(path.join(ROOT, 'dist', 'bili_skin.js'), 'utf8');

/* ---------- 最小 DOM 桩 ---------- */

function makeNode() {
  const n = {
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    offsetWidth: 60,
    offsetHeight: 30,
    setAttribute: function () {},
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
      return { left: 0, top: 0, width: 60, height: 30 };
    }
  };
  return n;
}

function makeEnv(url) {
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
    location: { pathname: '/', search: '', hash: '', href: url || 'https://www.bilibili.com/' },
    history: {
      pushState: function () {},
      replaceState: function () {}
    },
    document: {
      createElement: function () {
        return makeNode();
      },
      addEventListener: function () {},
      body: makeNode()
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

/* ---------- 样例数据 ---------- */

const DETAIL = {
  code: 0,
  message: '0',
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

const CATALOG = {
  code: 0,
  data: {
    category: [
      { name: '娱乐', suits: null },
      { name: '其他', suits: [] },
      {
        name: '小电视',
        suits: [
          {
            item_id: 67790,
            name: '2024愚人节·小会员',
            state: 'active',
            properties: { image_cover: 'https://i0.hdslb.com/a.jpg', sale_bp_forever_raw: '0' }
          },
          {
            item_id: 60640,
            name: 'WBG·2023LPL出征',
            state: 'active',
            properties: { image_cover: 'https://i0.hdslb.com/b.jpg', sale_bp_forever_raw: '500' }
          }
        ]
      }
    ]
  }
};

/* ---------- 测试 ---------- */

const tests = [];
function t(name, fn) {
  tests.push({ name: name, fn: fn });
}

t('qid/从 ?id= 取', function () {
  const env = makeEnv();
  env.location = { pathname: '/h5/mall/suit/detail', search: '?id=67790&navhide=1', hash: '' };
  eq(env.__BSS_API__.qid(), '67790', 'query id');
});

t('qid/从 ?item_id= 取', function () {
  const env = makeEnv();
  env.location = { pathname: '/h5/mall/suit/detail', search: '?item_id=42193', hash: '' };
  eq(env.__BSS_API__.qid(), '42193', 'item_id');
});

t('qid/从 hash 路由取', function () {
  const env = makeEnv();
  env.location = { pathname: '/h5/mall', search: '', hash: '#/suit/detail?id=1234' };
  eq(env.__BSS_API__.qid(), '1234', 'hash id');
});

t('qid/没有 id -> 空串', function () {
  const env = makeEnv();
  env.location = { pathname: '/h5/mall/home', search: '', hash: '' };
  eq(env.__BSS_API__.qid(), '', 'empty');
});

t('page/详情页', function () {
  const env = makeEnv();
  env.location = { pathname: '/h5/mall/suit/detail', search: '?id=1', hash: '' };
  eq(env.__BSS_API__.page(), 'detail', 'detail');
});

t('page/商城页', function () {
  const env = makeEnv();
  env.location = { pathname: '/h5/mall/home', search: '', hash: '' };
  eq(env.__BSS_API__.page(), 'mall', 'mall');
});

t('page/无关页', function () {
  const env = makeEnv();
  env.location = { pathname: '/video/BV1xx', search: '', hash: '' };
  eq(env.__BSS_API__.page(), 'other', 'other');
});

t('toEquip/完整字段 1:1 映射', function () {
  const e = API.toEquip(DETAIL);
  assert(e, 'should build equip');
  eq(e.id, 67790, 'id 取 item.item_id');
  eq(e.name, '2024愚人节·小会员', 'name');
  eq(e.preview, 'https://i0.hdslb.com/preview.jpg', 'preview 优先 image_preview');
  eq(e.ver, 1711761021, 'ver 取自 properties.ver');
  eq(e.package_url, 'https://i0.hdslb.com/bfs/garb/zip/2a2dfa59.zip', 'package_url');
  eq(e.package_md5, '8dd1d048a8d3377674f89ba4f8dc68e9', 'package_md5');
  eq(e.data.color, '#ffffff', 'color');
  eq(e.data.color_mode, 'dark', 'color_mode');
  eq(e.data.color_second_page, '#1c1c1c', 'color_second_page');
  eq(e.data.tail_color, '#ffffff', 'tail_color');
  eq(e.data.tail_color_selected, '#40f368', 'tail_color_selected');
  eq(e.data.tail_icon_ani, true, "tail_icon_ani 'true' -> true");
  eq(e.data.tail_icon_ani_mode, 'loop', 'ani mode');
  eq(e.data.tail_icon_mode, 'img', 'icon mode');
});

t('toEquip/无 skin 子项 -> null', function () {
  const d = JSON.parse(JSON.stringify(DETAIL));
  d.data.suit_items.skin = [];
  eq(API.toEquip(d), null, 'null');
});

t('toEquip/无 package_url -> null', function () {
  const d = JSON.parse(JSON.stringify(DETAIL));
  delete d.data.suit_items.skin[0].properties.package_url;
  eq(API.toEquip(d), null, 'null');
});

t('toEquip/无 data -> null', function () {
  eq(API.toEquip({ code: -400 }), null, 'null');
  eq(API.toEquip(null), null, 'null for null');
});

t('toEquip/缺配色字段 -> 走默认值', function () {
  const d = JSON.parse(JSON.stringify(DETAIL));
  const p = d.data.suit_items.skin[0].properties;
  delete p.color;
  delete p.color_mode;
  delete p.color_second_page;
  delete p.tail_color;
  delete p.tail_color_selected;
  delete p.tail_icon_ani_mode;
  delete p.image_preview;
  const e = API.toEquip(d);
  eq(e.data.color, '#212121', 'default color');
  eq(e.data.color_mode, 'light', 'default mode');
  eq(e.data.color_second_page, '#ffffff', 'default second page');
  eq(e.data.tail_color, '#996c00', 'default tail');
  eq(e.data.tail_color_selected, '#0d6872', 'default selected');
  eq(e.data.tail_icon_ani_mode, 'once', 'default ani mode');
  eq(e.preview, 'https://i0.hdslb.com/cover.jpg', 'preview 回退到 image_cover');
});

t('toEquip/缺 ver -> 固定版本号', function () {
  const d = JSON.parse(JSON.stringify(DETAIL));
  delete d.data.suit_items.skin[0].properties.ver;
  eq(API.toEquip(d).ver, 1700000000, 'fixed ver');
});

t('mapCatalog/扁平化并跳过空分类', function () {
  const list = API.mapCatalog(CATALOG);
  eq(list.length, 2, 'two items');
  eq(list[0].id, 67790, 'first id');
  eq(list[0].cat, '小电视', 'category carried');
  eq(list[0].live, true, 'live flag');
  eq(list[1].id, 60640, 'second id');
});

t('mapCatalog/付费标记', function () {
  const list = API.mapCatalog(CATALOG);
  eq(list[0].paid, false, 'sale_bp 0 -> 免费');
  eq(list[1].paid, true, 'sale_bp 500 -> 付费');
});

t('mapCatalog/空数据不炸', function () {
  eq(API.mapCatalog(null).length, 0, 'null safe');
  eq(API.mapCatalog({}).length, 0, 'empty safe');
  eq(API.mapCatalog({ data: { category: [{ name: 'x', suits: null }] } }).length, 0, 'null suits');
});

t('mergeGallery/并入绝版装扮', function () {
  const list = API.mapCatalog(CATALOG);
  const g = [{ id: 999, name: '绝版装扮', preview: 'https://i0.hdslb.com/g.jpg' }];
  API.mergeGallery(list, g);
  eq(list.length, 3, 'merged');
  const hit = list.filter(function (x) {
    return x.id === 999;
  })[0];
  eq(hit.live, false, 'marked not live');
  eq(hit.cat, '藏馆', 'category 藏馆');
  eq(hit.equip.id, 999, 'raw equip attached');
});

t('mergeGallery/同 id 不重复', function () {
  const list = API.mapCatalog(CATALOG);
  API.mergeGallery(list, [{ id: 67790, name: '重复' }]);
  eq(list.length, 2, 'still 2');
});

t('mergeGallery/空藏馆安全', function () {
  const list = API.mapCatalog(CATALOG);
  API.mergeGallery(list, null);
  eq(list.length, 2, 'unchanged');
});

/* ---------- 构建一致性 ---------- */

t('构建/dist 内联副本与 src 一致', function () {
  const captured = { body: null };
  const sandbox = {
    $script: { type: 'http-response' },
    $request: {
      url: 'https://www.bilibili.com/h5/mall/suit/detail?id=1&navhide=1',
      method: 'GET',
      headers: {}
    },
    $response: {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: '<!DOCTYPE html><html><head></head><body></body></html>'
    },
    $persistentStore: {
      read: function () {
        return null;
      },
      write: function () {}
    },
    $done: function (o) {
      captured.body = o.body;
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(BUILT, sandbox, { filename: 'bili_skin.js' });

  const html = captured.body;
  assert(html, 'injection produced a body');
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert(m, 'found injected script tag');

  // 注入到 HTML 时 </script 被转义成 <\/script，比对前先还原
  const injected = m[1].replace(/<\\\/script/gi, '</script');
  const expect = H5_SRC.replace(/<\/script/gi, '<\\/script').replace(/<\\\/script/gi, '</script');
  eq(injected === expect, true, 'dist 内联的 payload 与 src/bili_h5.js 完全一致');
});

t('构建/注入的 payload 可独立执行', function () {
  const captured = { body: null };
  const sandbox = {
    $script: { type: 'http-response' },
    $request: {
      url: 'https://www.bilibili.com/h5/mall/home',
      method: 'GET',
      headers: {}
    },
    $response: {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: '<!DOCTYPE html><html><head></head><body></body></html>'
    },
    $persistentStore: {
      read: function () {
        return null;
      },
      write: function () {}
    },
    $done: function (o) {
      captured.body = o.body;
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(BUILT, sandbox, { filename: 'bili_skin.js' });

  const payload = /<script>([\s\S]*?)<\/script>/.exec(captured.body)[1];
  const env = makeEnv();
  env.document = {
    createElement: function () {
      return makeNode();
    },
    addEventListener: function () {},
    body: makeNode()
  };
  vm.createContext(env);
  vm.runInContext(payload, env, { filename: 'injected.js' });
  assert(env.__BSS_LOADED__, 'payload self-executed and set its guard flag');
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
