'use strict';
/*
 * B站装扮工作室 —— Surge 侧脚本的 mock 测试
 * 覆盖：通信桥（set/get/clear/gallery/…）、应用装扮、HTML 注入
 */
const fs = require('fs');
const path = require('path');
const { runSurgeScript, assert } = require(
  'C:/Users/VOS-User/.workbuddy-ai/skills/surge-scripting/scripts/surge_mock.js'
);

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'dist', 'bili_skin.js'), 'utf8');

const BRIDGE_URL = 'https://app.bilibili.com/x/surge-skin/';
const SKIN_URL = 'https://app.bilibili.com/x/resource/show/skin?access_key=x&build=8000000';
const MALL_URL = 'https://www.bilibili.com/h5/mall/suit/detail?id=67790&navhide=1';

const EQUIP = {
  id: 67790,
  name: '2024愚人节·小会员',
  preview: 'https://i0.hdslb.com/bfs/garb/item/cover.jpg',
  ver: 1711761021,
  package_url: 'https://i0.hdslb.com/bfs/garb/zip/2a2dfa59.zip',
  package_md5: '8dd1d048a8d3377674f89ba4f8dc68e9',
  data: {
    color_mode: 'dark',
    color: '#ffffff',
    color_second_page: '#1c1c1c',
    tail_color: '#ffffff',
    tail_color_selected: '#40f368',
    tail_icon_ani: true,
    tail_icon_ani_mode: 'once',
    tail_icon_mode: 'img'
  }
};

const SKIN_RESP = {
  code: 0,
  message: '0',
  ttl: 1,
  data: {
    user_equip: {
      id: 1111,
      name: '原本的装扮',
      preview: 'http://i0.hdslb.com/orig.jpg',
      ver: 1598600025,
      package_url: 'http://i0.hdslb.com/orig.zip',
      package_md5: 'aaa',
      data: { color_mode: 'light', color: '#000000' }
    },
    skin_colors: [{ id: 2, name: '少女粉', is_free: true }],
    load_equip: { id: 2531, name: '初音未来13周年' }
  }
};

const HTML_PAGE =
  '<!DOCTYPE html><html><head><title>t</title></head>' +
  '<body><div id="major-app"></div></body></html>';

/* ---------- 构造器 ---------- */

/* 桥请求：cfg 直接作为 runSurgeScript 的第二个参数 */
function req(name, over) {
  return Object.assign(
    {
      type: 'http-request',
      request: { url: BRIDGE_URL + name, method: 'GET', headers: {}, body: undefined }
    },
    over
  );
}

function post(name, obj, over) {
  return req(
    name,
    Object.assign(
      {
        request: {
          url: BRIDGE_URL + name,
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(obj)
        }
      },
      over
    )
  );
}

function resp(url, body, over) {
  return Object.assign(
    {
      type: 'http-response',
      request: { url: url, method: 'GET', headers: {} },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: body }
    },
    over
  );
}

/* 桥的返回值在 result.response.body */
function rb(r) {
  assert(r.result && r.result.response, 'bridge must return a synthetic response');
  return JSON.parse(r.result.response.body);
}

function stored(r, key) {
  const w = r.storeWrites.filter(function (x) {
    return x.key === key;
  });
  return w.length ? w[w.length - 1].data : undefined;
}

/* ---------- 测试 ---------- */

const tests = [];
function t(name, fn) {
  tests.push({ name: name, fn: fn });
}

/* ===== 桥 ===== */

t('桥/未知路径兜底 -> code 0', async function () {
  const r = await runSurgeScript(SRC, req('ping'));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  assert(rb(r).code === 0, 'code 0');
});

t('桥/set 合法配置 -> 写入并回 id', async function () {
  const r = await runSurgeScript(SRC, post('set', EQUIP));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const out = rb(r);
  assert(out.code === 0, 'code 0, got ' + JSON.stringify(out));
  assert(out.data.id === 67790, 'echo id');
  const raw = stored(r, 'BiliSkinEquip');
  assert(raw !== undefined, 'store written');
  assert(/zip/.test(JSON.parse(raw).package_url), 'stored payload intact');
});

t('桥/set 请求体为空 -> 报错', async function () {
  const r = await runSurgeScript(
    SRC,
    req('set', {
      request: { url: BRIDGE_URL + 'set', method: 'POST', headers: {}, body: undefined }
    })
  );
  const out = rb(r);
  assert(out.code === -1, 'code -1');
  assert(/requires-body/.test(out.msg), 'msg hints requires-body: ' + out.msg);
});

t('桥/set 非法 JSON -> 报错', async function () {
  const r = await runSurgeScript(
    SRC,
    req('set', {
      request: { url: BRIDGE_URL + 'set', method: 'POST', headers: {}, body: '{oops' }
    })
  );
  assert(rb(r).code === -1, 'code -1');
});

t('桥/set 缺 package_url -> 报错', async function () {
  const bad = Object.assign({}, EQUIP);
  delete bad.package_url;
  const r = await runSurgeScript(SRC, post('set', bad));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/set package_url 非 http -> 报错', async function () {
  const bad = Object.assign({}, EQUIP, { package_url: 'javascript:alert(1)' });
  const r = await runSurgeScript(SRC, post('set', bad));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/get 空 -> data null', async function () {
  const r = await runSurgeScript(SRC, req('get'));
  assert(r.done, 'must call $done');
  assert(rb(r).data === null, 'null when unset');
});

t('桥/get 有值 -> 返回配置', async function () {
  const r = await runSurgeScript(
    SRC,
    req('get', { store: { BiliSkinEquip: JSON.stringify(EQUIP) } })
  );
  const out = rb(r);
  assert(out.code === 0 && out.data.id === 67790, 'returns stored equip');
});

t('桥/clear -> 清空', async function () {
  const r = await runSurgeScript(
    SRC,
    req('clear', { store: { BiliSkinEquip: JSON.stringify(EQUIP) } })
  );
  assert(r.done, 'must call $done');
  assert(stored(r, 'BiliSkinEquip') === '', 'cleared');
});

t('桥/gallery 空 -> []', async function () {
  const r = await runSurgeScript(SRC, req('gallery'));
  const out = rb(r);
  assert(Array.isArray(out.data), 'array');
  assert(out.data.length === 0, 'empty');
});

t('桥/gallery/add 新增 -> count 1', async function () {
  const r = await runSurgeScript(SRC, post('gallery/add', EQUIP));
  const out = rb(r);
  assert(out.code === 0, 'code 0');
  assert(
    out.data.count === 1 && out.data.added === true,
    'added, count 1: ' + JSON.stringify(out.data)
  );
});

t('桥/gallery/add 同 id -> 覆盖不重复', async function () {
  const r = await runSurgeScript(
    SRC,
    post('gallery/add', Object.assign({}, EQUIP, { name: '改过名' }), {
      store: { BiliSkinGallery: JSON.stringify([EQUIP]) }
    })
  );
  const out = rb(r);
  assert(out.data.count === 1, 'still 1, got ' + out.data.count);
  assert(out.data.added === false, 'replaced not added');
});

t('桥/gallery/add 非法 -> 报错', async function () {
  const r = await runSurgeScript(SRC, post('gallery/add', { id: 1 }));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/gallery/remove -> 移除', async function () {
  const other = Object.assign({}, EQUIP, { id: 999 });
  const r = await runSurgeScript(
    SRC,
    req('gallery/remove?id=999', { store: { BiliSkinGallery: JSON.stringify([EQUIP, other]) } })
  );
  const out = rb(r);
  assert(out.code === 0, 'code 0');
  assert(out.data.count === 1, 'one left, got ' + out.data.count);
});

t('桥/OPTIONS 预检 -> code 0 + CORS', async function () {
  const r = await runSurgeScript(
    SRC,
    req('set', { request: { url: BRIDGE_URL + 'set', method: 'OPTIONS', headers: {} } })
  );
  assert(r.done, 'must call $done');
  assert(rb(r).code === 0, 'code 0');
  assert(
    r.result.response.headers['Access-Control-Allow-Origin'] === '*',
    'CORS header present'
  );
  assert(r.result.response.headers['Access-Control-Allow-Methods'], 'methods header present');
});

t('桥/响应都是假响应 -> 不发网络请求', async function () {
  const r = await runSurgeScript(SRC, post('set', EQUIP));
  assert(r.requests.length === 0, 'no upstream request, got ' + r.requests.length);
  assert(r.result.response, 'returned a synthetic response');
});

/* ===== 应用装扮 ===== */

t('应用/未注入 -> 原样放行', async function () {
  const r = await runSurgeScript(SRC, resp(SKIN_URL, JSON.stringify(SKIN_RESP)));
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('应用/已注入 -> 替换且保留其它字段', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP) }
    })
  );
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const out = JSON.parse(r.result.body);
  assert(out.data.user_equip.id === 67790, 'equipped replaced');
  assert(out.data.user_equip.data.tail_color_selected === '#40f368', 'colors carried');
  assert(out.data.skin_colors.length === 1, 'skin_colors preserved');
  assert(out.data.load_equip.id === 2531, 'load_equip preserved');
  assert(out.code === 0 && out.ttl === 1, 'envelope preserved');
});

t('应用/存储损坏 -> 放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), { store: { BiliSkinEquip: '{{not json' } })
  );
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('应用/存储缺 package_url -> 放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), {
      store: { BiliSkinEquip: JSON.stringify({ id: 1, name: 'x' }) }
    })
  );
  assert(r.result.body === undefined, 'body untouched');
});

t('应用/响应非 JSON -> 放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, '<html>WAF</html>', { store: { BiliSkinEquip: JSON.stringify(EQUIP) } })
  );
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('应用/code!=0 -> 放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify({ code: -101, message: 'not login' }), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP) }
    })
  );
  assert(r.result.body === undefined, 'body untouched');
});

/* ===== 注入 ===== */

t('注入/HTML -> 在 </body> 前插入脚本', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(MALL_URL, HTML_PAGE, {
      response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: HTML_PAGE }
    })
  );
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const html = r.result.body;
  assert(html.indexOf('__BSS_LOADED__') >= 0, 'payload injected');
  assert(html.indexOf('__BSS_LOADED__') < html.lastIndexOf('</body>'), 'injected before </body>');
  assert(html.indexOf('</head>') < html.indexOf('__BSS_LOADED__'), 'after head');
  assert((html.match(/<script/g) || []).length === 1, 'exactly one script tag');
});

t('注入/无 </body> -> 追加到末尾', async function () {
  const page = '<!DOCTYPE html><html><head></head><body><div id="major-app"></div>';
  const r = await runSurgeScript(
    SRC,
    resp(MALL_URL, page, {
      response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: page }
    })
  );
  assert(r.done, 'must call $done');
  assert(r.result.body.indexOf('__BSS_LOADED__') > page.length - 40, 'appended at end');
});

t('注入/响应不是 HTML -> 放行', async function () {
  const r = await runSurgeScript(SRC, resp(MALL_URL, JSON.stringify({ code: 0, data: 1 })));
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('注入/已注入过 -> 不重复注入', async function () {
  const once = HTML_PAGE.replace('</body>', '<script>window.__BSS_LOADED__=1;</script></body>');
  const r = await runSurgeScript(
    SRC,
    resp(MALL_URL, once, {
      response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: once }
    })
  );
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched (idempotent)');
});

t('注入/空响应 -> 放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(MALL_URL, '', { response: { status: 200, headers: {}, body: '' } })
  );
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('分派/skin 接口不会被当成 HTML 注入', async function () {
  const r = await runSurgeScript(SRC, resp(SKIN_URL, JSON.stringify(SKIN_RESP)));
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'apply path taken (no equip -> passthrough)');
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
