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
/* 构建产物在仓库根目录（Surge 就从这里的 raw URL 下载） */
const SRC = fs.readFileSync(path.join(ROOT, 'bili_skin.js'), 'utf8');

/* runSurgeScript 只接受 (code, cfg) 两个参数。
   传第三个参数会被**静默忽略**（store 就丢了），这个坑踩过两次，
   所以包一层，多传就立刻报错。 */
function runSurge(cfg) {
  if (arguments.length > 1) {
    throw new Error('runSurge 只接受一个 cfg 参数；store/argument 等要放进 cfg 里');
  }
  return runSurgeScript.call(null, SRC, cfg);
}

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

/* 装扮详情响应：嗅探测试用 */
const DETAIL_RESP = {
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
            color: '#ffffff',
            color_mode: 'dark',
            tail_color: '#ffffff',
            tail_color_selected: '#40f368',
            tail_icon_ani: 'true'
          }
        }
      ]
    }
  }
};

const SNIFF_URL = 'https://api.bilibili.com/x/garb/mall/item/suit/v2?part=suit&item_id=67790';
const SNIFF_VAS_URL = 'https://api.bilibili.com/x/vas/dlc_act/lottery_home_detail?act_id=1';

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
  const r = await runSurge(req('ping'));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  assert(rb(r).code === 0, 'code 0');
});

t('桥/set 合法配置 -> 写入并回 id', async function () {
  const r = await runSurge(post('set', EQUIP));
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
  const r = await runSurge(post('set', bad));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/set package_url 非 http -> 报错', async function () {
  const bad = Object.assign({}, EQUIP, { package_url: 'javascript:alert(1)' });
  const r = await runSurge(post('set', bad));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/get 空 -> data null', async function () {
  const r = await runSurge(req('get'));
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
  const r = await runSurge(req('gallery'));
  const out = rb(r);
  assert(Array.isArray(out.data), 'array');
  assert(out.data.length === 0, 'empty');
});

t('桥/gallery/add 新增 -> count 1', async function () {
  const r = await runSurge(post('gallery/add', EQUIP));
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
  const r = await runSurge(post('gallery/add', { id: 1 }));
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
  const r = await runSurge(post('set', EQUIP));
  assert(r.requests.length === 0, 'no upstream request, got ' + r.requests.length);
  assert(r.result.response, 'returned a synthetic response');
});

/* ===== 应用装扮 ===== */

t('应用/未注入 -> 原样放行', async function () {
  const r = await runSurge(resp(SKIN_URL, JSON.stringify(SKIN_RESP)));
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

t('注入/HTML -> 在 </head> 前插入脚本', async function () {
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
  assert(
    html.indexOf('__BSS_LOADED__') < html.lastIndexOf('</head>'),
    '必须注入到 </head> 之前，否则首屏接口响应会早于 enterTs'
  );
  assert(html.indexOf('<body>') > html.indexOf('__BSS_LOADED__'), 'injected before body');
  assert((html.match(/<script/g) || []).length === 1, 'exactly one script tag');
});

t('注入/无 </head> -> 回落到 </body> 前', async function () {
  const page = '<!DOCTYPE html><html><body><div id="major-app"></div></body></html>';
  const r = await runSurgeScript(
    SRC,
    resp(MALL_URL, page, {
      response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: page }
    })
  );
  assert(r.done, 'must call $done');
  const html = r.result.body;
  assert(html.indexOf('__BSS_LOADED__') >= 0, 'injected');
  assert(html.indexOf('__BSS_LOADED__') < html.lastIndexOf('</body>'), 'before </body>');
});

t('注入/既无 </head> 也无 </body> -> 追加到末尾', async function () {
  const page = '<!DOCTYPE html><html><div id="major-app"></div>';
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
  const r = await runSurge(resp(MALL_URL, JSON.stringify({ code: 0, data: 1 })));
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

t('注入/收藏集的主题套装预览页也注入', async function () {
  const url = 'https://www.bilibili.com/blackboard/fe/suit-preview.html?navhide=1&id=37670';
  const r = await runSurge(
    resp(url, HTML_PAGE, {
      response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: HTML_PAGE }
    })
  );
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const html = r.result.body;
  assert(html && html.indexOf('__BSS_LOADED__') >= 0, 'payload injected');
  assert(html.indexOf('__BSS_LOADED__') < html.lastIndexOf('</head>'), 'before </head>');
});

t('注入/预览页响应不是 HTML 时放行', async function () {
  const url = 'https://www.bilibili.com/blackboard/fe/suit-preview.html?navhide=1';
  const r = await runSurge(resp(url, JSON.stringify({ code: 0 })));
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('注入/无关的 blackboard 页面不注入', async function () {
  const url = 'https://www.bilibili.com/blackboard/activity-abc.html';
  const r = await runSurge(
    resp(url, HTML_PAGE, {
      response: { status: 200, headers: { 'Content-Type': 'text/html' }, body: HTML_PAGE }
    })
  );
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'body untouched');
});

t('分派/skin 接口不会被当成 HTML 注入', async function () {
  const r = await runSurge(resp(SKIN_URL, JSON.stringify(SKIN_RESP)));
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'apply path taken (no equip -> passthrough)');
});

/* ===== 嗅探 ===== */

t('嗅探/含装扮的响应 -> 写入 seen 且放行', async function () {
  const r = await runSurge(resp(SNIFF_URL, JSON.stringify(DETAIL_RESP)));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const raw = stored(r, 'BiliSkinSeen');
  assert(raw !== undefined, 'seen written');
  const list = JSON.parse(raw);
  assert(list.length === 1, 'one candidate, got ' + list.length);
  assert(list[0].equip.id === 67790, 'candidate id');
  assert(list[0].equip.package_url.indexOf('zip') >= 0, 'package_url kept');
  assert(list[0].equip.data.tail_color_selected === '#40f368', 'colors mapped');
  assert(list[0].ts > 0, 'timestamped');
  assert(r.result.body === undefined, '响应原样放行，不改 body');
});

t('嗅探/vas 收藏集接口也走同一条路', async function () {
  const r = await runSurge(resp(SNIFF_VAS_URL, JSON.stringify(DETAIL_RESP)));
  assert(r.done, 'must call $done');
  assert(JSON.parse(stored(r, 'BiliSkinSeen')).length === 1, 'captured');
});

t('嗅探/不含 suit_items -> 不写 seen', async function () {
  const body = JSON.stringify({ code: 0, data: { category: [{ suits: [{ item_id: 1 }] }] } });
  const r = await runSurge(resp(SNIFF_URL, body));
  assert(r.done, 'must call $done');
  assert(stored(r, 'BiliSkinSeen') === undefined, 'suit/all 这类目录不产生候选');
});

t('嗅探/非 JSON -> 放行且不写', async function () {
  const r = await runSurge(resp(SNIFF_URL, '<html>WAF</html>'));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  assert(stored(r, 'BiliSkinSeen') === undefined, 'no write');
});

t('嗅探/同 id 去重且置顶', async function () {
  const old = { ts: Date.now() - 1000, equip: Object.assign({}, EQUIP, { name: '旧名' }) };
  const other = { ts: Date.now() - 2000, equip: Object.assign({}, EQUIP, { id: 999 }) };
  const r = await runSurge(
    resp(SNIFF_URL, JSON.stringify(DETAIL_RESP), {
      store: { BiliSkinSeen: JSON.stringify([other, old]) }
    })
  );
  const list = JSON.parse(stored(r, 'BiliSkinSeen'));
  assert(list.length === 2, 'still 2, got ' + list.length);
  assert(list[0].equip.id === 67790, 'newest first');
  assert(list[1].equip.id === 999, 'other kept');
});

t('嗅探/过期条目被清掉', async function () {
  const stale = { ts: Date.now() - 9999999, equip: Object.assign({}, EQUIP, { id: 888 }) };
  const r = await runSurge(
    resp(SNIFF_URL, JSON.stringify(DETAIL_RESP), {
      store: { BiliSkinSeen: JSON.stringify([stale]) }
    })
  );
  const list = JSON.parse(stored(r, 'BiliSkinSeen'));
  assert(list.length === 1, 'stale dropped, got ' + list.length);
  assert(list[0].equip.id === 67790, 'only fresh one');
});

/* ===== 桥 · seen ===== */

t('桥/seen 空 -> []', async function () {
  const r = await runSurge(req('seen?since=0'));
  const out = rb(r);
  assert(Array.isArray(out.data), 'array');
  assert(out.data.length === 0, 'empty');
});

t('桥/seen 返回装备本体', async function () {
  const r = await runSurge(req('seen?since=0', {
    store: { BiliSkinSeen: JSON.stringify([{ ts: Date.now(), equip: EQUIP }]) }
  }));
  const out = rb(r);
  assert(out.data.length === 1, 'one');
  assert(out.data[0].id === 67790, 'returns equip not wrapper');
});

t('桥/seen 按 since 过滤本页之前的', async function () {
  const now = Date.now();
  const store = {
    BiliSkinSeen: JSON.stringify([
      { ts: now - 60000, equip: Object.assign({}, EQUIP, { id: 111 }) },
      { ts: now - 1000, equip: Object.assign({}, EQUIP, { id: 222 }) }
    ])
  };
  const r = await runSurge(req('seen?since=' + (now - 5000), { store: store }));
  const out = rb(r);
  assert(out.data.length === 1, 'only current page, got ' + out.data.length);
  assert(out.data[0].id === 222, 'the fresh one');
});

t('桥/seen 丢弃过期条目', async function () {
  const r = await runSurge(req('seen?since=0', {
    store: { BiliSkinSeen: JSON.stringify([{ ts: Date.now() - 9999999, equip: EQUIP }]) }
  }));
  assert(rb(r).data.length === 0, 'expired filtered');
});

t('桥/seen 跳过损坏条目', async function () {
  const r = await runSurge(req('seen?since=0', {
    store: { BiliSkinSeen: JSON.stringify([null, { ts: Date.now() }, { ts: Date.now(), equip: { id: 1 } }]) }
  }));
  assert(rb(r).data.length === 0, 'invalid entries skipped');
});

t('桥/seen/clear -> 清空', async function () {
  const r = await runSurge(req('seen/clear', {
    store: { BiliSkinSeen: JSON.stringify([{ ts: Date.now(), equip: EQUIP }]) }
  }));
  assert(rb(r).code === 0, 'code 0');
  assert(stored(r, 'BiliSkinSeen') === '', 'cleared');
});

/* ===== 新增：整套装扮（多组件） ===== */

const EQUIP_FULL = {
  id: 67790,
  name: '2024愚人节·小会员',
  preview: 'https://i0.hdslb.com/bfs/garb/item/cover.jpg',
  ver: 1711761021,
  package_url: 'https://i0.hdslb.com/bfs/garb/zip/2a2dfa59.zip',
  package_md5: '8dd1d048a8d3377674f89ba4f8dc68e9',
  data: { color_mode: 'dark', color: '#ffffff', tail_color: '#ffffff' },
  components: {
    skin: {
      kind: 'skin',
      id: 67791,
      package_url: 'https://i0.hdslb.com/bfs/garb/zip/2a2dfa59.zip',
      package_md5: '8dd1d048a8d3377674f89ba4f8dc68e9'
    },
    loading: {
      kind: 'loading',
      id: 67792,
      name: '加载动画',
      ver: 1711761022,
      loading_url: 'https://i0.hdslb.com/bfs/garb/item/load.webp',
      url: 'https://i0.hdslb.com/bfs/garb/item/load.webp'
    },
    card_bg: {
      kind: 'card_bg',
      id: 67793,
      name: '评论装扮',
      image: 'https://i0.hdslb.com/bfs/garb/item/card.png',
      url: 'https://i0.hdslb.com/bfs/garb/item/card.png'
    },
    card: { kind: 'card', id: 67794, name: '动态卡片', image: 'https://i0.hdslb.com/bfs/garb/item/card.png' },
    pendant: { kind: 'pendant', id: 67795, name: '挂件', image: 'https://i0.hdslb.com/bfs/garb/item/pend.png' }
  }
};

const REPLY_URL = 'https://api.bilibili.com/x/v2/reply/main?oid=1&type=1';
const SPLASH_URL = 'https://app.bilibili.com/x/v2/splash/brand/list?appkey=x&ts=0&sign=y';
const SPLASH_RESP = {
  code: 0,
  data: {
    pull_interval: 1800,
    forcibly: false,
    list: [{ id: 1, thumb: 'https://i0.hdslb.com/a.jpg', logo_url: '' }],
    show: [{ id: 1, begin_time: 0, end_time: 0, probability: 0, duration: 3000 }]
  }
};

t('应用/整套装扮 -> 主题 + 加载动画一起换', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), { store: { BiliSkinEquip: JSON.stringify(EQUIP_FULL) } })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const out = JSON.parse(r.result.body);
  assert(out.data.user_equip.id === 67790, '主题被替换');
  assert(out.data.load_equip.id === 67792, '加载动画被替换');
  assert(out.data.load_equip.loading_url.indexOf('load.webp') >= 0, 'loading_url 写入');
  assert(out.data.skin_colors.length === 1, '其它字段保留');
});

t('应用/只有加载动画也能注入（保留原主题）', async function () {
  const onlyLoad = {
    id: 1,
    name: '只有加载动画',
    components: { loading: { id: 2, name: 'L', loading_url: 'https://i0.hdslb.com/a.webp' } }
  };
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), { store: { BiliSkinEquip: JSON.stringify(onlyLoad) } })
  );
  const out = JSON.parse(r.result.body);
  assert(out.data.user_equip.id === 1111, '原主题不动');
  assert(out.data.load_equip.id === 2, '加载动画注入');
});

t('应用/common_equip 也一起换（否则切到动态/我的会闪一下掉回默认）', async function () {
  const body = {
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
      /* BFCMultiTheme 的第二份装备：多主题 / 跟随系统时用这份重新上色 */
      common_equip: {
        id: 2222,
        name: '默认主题',
        preview: 'http://i0.hdslb.com/common.jpg',
        ver: 1598600001,
        package_url: 'http://i0.hdslb.com/common.zip',
        package_md5: 'bbb',
        data: { color_mode: 'light', color: '#212121' },
        keep_me: 'untouched'
      }
    }
  };
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(body), { store: { BiliSkinEquip: JSON.stringify(EQUIP_FULL) } })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(r.result.body).data;
  assert(d.user_equip.id === 67790, 'user_equip 换了');
  assert(d.common_equip.id === 67790, 'common_equip 也换了');
  assert(
    d.common_equip.package_url === d.user_equip.package_url,
    '两份装备指向同一个包，切页不会掉回默认'
  );
  assert(d.common_equip.keep_me === 'untouched', '原有其它字段保留');
});

t('应用/响应里没有 common_equip 时不硬塞', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), { store: { BiliSkinEquip: JSON.stringify(EQUIP_FULL) } })
  );
  const d = JSON.parse(r.result.body).data;
  assert(d.common_equip === undefined, '不该凭空造 common_equip');
});

t('我的页/响应里带主题装备时一起换（进 tab 不再被默认主题覆盖）', async function () {
  const body = {
    code: 0,
    data: {
      mid: 12345,
      pendantUrl: '',
      user_equip: {
        id: 1111,
        name: '默认主题',
        preview: 'https://i0.hdslb.com/default.jpg',
        ver: 1,
        package_url: 'https://i0.hdslb.com/default.zip',
        package_md5: 'zzz',
        data: { color_mode: 'light', color: '#212121' }
      }
    }
  };
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify(body), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.user_equip.id === EQUIP_ALL.id, '我的页的 user_equip 被换成注入的主题，实际：' + d.user_equip.id);
});

t('评论装扮/只改自己的 member，别人的不动', async function () {
  const body = JSON.stringify({
    code: 0,
    data: {
      replies: [
        { member: { mid: 100, user_sailing_v2: { card_bg: { id: 1, image: 'https://old/1.png' } } } },
        { member: { mid: 200, user_sailing_v2: { card_bg: { id: 2, image: 'https://old/2.png' } } } }
      ]
    }
  });
  const r = await runSurgeScript(
    SRC,
    resp(REPLY_URL, body, {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_FULL),
        BiliSkinSelf: JSON.stringify({ mid: '100' })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const out = JSON.parse(r.result.body);
  assert(
    out.data.replies[0].member.user_sailing_v2.card_bg.image.indexOf('card.png') >= 0,
    '自己的评论装扮被替换'
  );
  assert(
    out.data.replies[1].member.user_sailing_v2.card_bg.image === 'https://old/2.png',
    '别人的不动'
  );
});

t('评论装扮/没有 selfMid -> 原样放行', async function () {
  const body = JSON.stringify({
    code: 0,
    data: { replies: [{ member: { mid: 100, user_sailing_v2: { card_bg: { image: 'https://old/1.png' } } } }] }
  });
  const r = await runSurgeScript(
    SRC,
    resp(REPLY_URL, body, { store: { BiliSkinEquip: JSON.stringify(EQUIP_FULL) } })
  );
  assert(r.result.body === undefined, '不知道是谁就不动');
});

t('评论装扮/响应里没有 member -> 放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(REPLY_URL, JSON.stringify({ code: 0, data: { cursor: 1 } }), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_FULL), BiliSkinSelf: JSON.stringify({ mid: '100' }) }
    })
  );
  assert(r.result.body === undefined, 'untouched');
});

t('开屏/记录候选 + 注入选中的', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SPLASH_URL, JSON.stringify(SPLASH_RESP), {
      store: { BiliSkinSplash: JSON.stringify({ id: 999, thumb: 'https://i0.hdslb.com/mine.jpg' }) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const out = JSON.parse(r.result.body);
  assert(out.data.list[0].id === 999, '选中的开屏排最前');
  assert(out.data.show[0].id === 999, 'show 也指向它');
  const rec = JSON.parse(stored(r, 'BiliSkinSplashList'));
  assert(rec.length === 1 && rec[0].thumb.indexOf('a.jpg') >= 0, '候选已记录');
});

t('开屏/没选 -> 只记录候选，不改 body', async function () {
  const r = await runSurge(resp(SPLASH_URL, JSON.stringify(SPLASH_RESP)));
  assert(r.result.body === undefined, 'untouched');
  assert(JSON.parse(stored(r, 'BiliSkinSplashList')).length === 1, 'recorded');
});

t('开屏/非列表响应 -> 放行', async function () {
  const r = await runSurge(resp(SPLASH_URL, JSON.stringify({ code: 0, data: { foo: 1 } })));
  assert(r.result.body === undefined, 'untouched');
});

t('桥/selfmid -> 记住当前用户', async function () {
  const r = await runSurge(post('selfmid', { mid: 12345 }));
  assert(rb(r).code === 0, 'code 0');
  assert(JSON.parse(stored(r, 'BiliSkinSelf')).mid === '12345', 'stored');
});

t('桥/selfmid 缺 mid -> 报错', async function () {
  const r = await runSurge(post('selfmid', {}));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/splash/set -> 记住开屏', async function () {
  const r = await runSurge(post('splash/set', { id: 9, thumb: 'https://i0.hdslb.com/s.jpg' }));
  assert(rb(r).code === 0, 'code 0');
  assert(JSON.parse(stored(r, 'BiliSkinSplash')).id === 9, 'stored');
});

t('桥/splash/set 缺 thumb -> 报错', async function () {
  const r = await runSurge(post('splash/set', { id: 9 }));
  assert(rb(r).code === -1, 'code -1');
});

t('桥/splash/list 空 -> []', async function () {
  const r = await runSurge(req('splash/list'));
  assert(Array.isArray(rb(r).data), 'array');
  assert(rb(r).data.length === 0, 'empty');
});

t('嗅探/整套 suit_items 都收进 components', async function () {
  const detail = {
    code: 0,
    data: {
      item: { item_id: 67790, name: 'x' },
      suit_items: {
        skin: [{ item_id: 1, name: 'x', properties: { package_url: 'https://a/s.zip', package_md5: 'm', color: '#fff' } }],
        loading: [{ item_id: 2, name: 'x', properties: { loading_url: 'https://a/l.webp', ver: 5 } }],
        card: [{ item_id: 3, name: 'x', properties: { image: 'https://a/c.png' } }],
        thumbup: [{ item_id: 4, name: 'x', properties: { image_ani: 'https://a/t.png' } }]
      }
    }
  };
  const r = await runSurge(resp(SNIFF_URL, JSON.stringify(detail)));
  const list = JSON.parse(stored(r, 'BiliSkinSeen'));
  const eq = list[0].equip;
  assert(eq.components.loading.loading_url === 'https://a/l.webp', 'loading 收录');
  assert(eq.components.card.image === 'https://a/c.png', 'card 收录');
  assert(eq.components.thumbup.image_ani === 'https://a/t.png', 'thumbup 收录');
});

t('分派/reply 走评论装扮而不是嗅探', async function () {
  const body = JSON.stringify({ code: 0, data: { replies: [{ member: { mid: 1 } }] } });
  const r = await runSurgeScript(
    SRC,
    resp(REPLY_URL, body, {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_FULL), BiliSkinSelf: JSON.stringify({ mid: '1' }) }
    })
  );
  assert(r.done, 'must call $done');
  assert(stored(r, 'BiliSkinSeen') === undefined, '没走嗅探');
});

/* ===== 活动开屏 + md5 ===== */

const EVENT_URL = 'https://app.bilibili.com/x/v2/splash/event/list2?appkey=x';
const EVENT_RESP = {
  code: 0,
  data: {
    list: [
      {
        id: 11,
        front_image_url: 'https://i0.hdslb.com/front.jpg',
        front_image_md5: 'aaa',
        back_image_url: 'https://i0.hdslb.com/back.jpg',
        back_image_md5: 'bbb',
        video_url: 'https://upos/front.mp4',
        video_hash: 'hhh',
        stroke_color: '#66FFFFFF',
        scratch_percent: 40
      }
    ]
  }
};

t('活动开屏/记录候选（没选就不动 body）', async function () {
  const r = await runSurge(resp(EVENT_URL, JSON.stringify(EVENT_RESP)));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  assert(r.result.body === undefined, 'untouched');
  const rec = JSON.parse(stored(r, 'BiliSkinSplashList'));
  assert(rec.length === 1, 'one candidate');
  assert(rec[0].kind === 'event', 'kind=event');
  assert(rec[0].thumb.indexOf('front.jpg') >= 0, 'front as thumb');
});

t('活动开屏/选中的图铺到元素上并清掉视频', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(EVENT_URL, JSON.stringify(EVENT_RESP), {
      store: {
        BiliSkinSplash: JSON.stringify({
          kind: 'event',
          id: 1,
          thumb: 'https://i0.hdslb.com/mine.jpg',
          md5: 'mymd5'
        })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const el = JSON.parse(r.result.body).data.list[0];
  assert(el.front_image_url === 'https://i0.hdslb.com/mine.jpg', 'front swapped');
  assert(el.front_image_md5 === 'mymd5', 'front md5');
  assert(el.back_image_url === 'https://i0.hdslb.com/mine.jpg', 'back swapped');
  assert(el.back_image_md5 === 'mymd5', 'back md5');
  assert(el.video_url === '', 'video cleared');
  assert(el.stroke_color === '#66FFFFFF', 'other fields kept');
});

t('开屏/品牌选中不动活动开屏', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(EVENT_URL, JSON.stringify(EVENT_RESP), {
      store: {
        BiliSkinSplash: JSON.stringify({ kind: 'brand', id: 1, thumb: 'https://i0.hdslb.com/b.jpg' })
      }
    })
  );
  assert(r.result.body === undefined, 'event untouched by brand pick');
});

t('桥/splash/set 顺手把图片 md5 算出来', async function () {
  const r = await runSurge(
    post(
      'splash/set',
      { kind: 'event', id: 5, thumb: 'https://i0.hdslb.com/x.jpg' },
      { http: [{ match: 'https://i0.hdslb.com/x.jpg', body: 'abc' }] }
    )
  );
  assert(rb(r).code === 0, 'code 0');
  const sp = JSON.parse(stored(r, 'BiliSkinSplash'));
  assert(
    sp.md5 === '900150983cd24fb0d6963f7d28e17f72',
    'md5("abc") 应为 900150983cd24fb0d6963f7d28e17f72，实际 ' + sp.md5
  );
});

t('桥/splash/set 拉不到图也不报错', async function () {
  const r = await runSurge(
    post('splash/set', { kind: 'brand', id: 6, thumb: 'https://i0.hdslb.com/y.jpg' })
  );
  assert(rb(r).code === 0, 'code 0');
  const sp = JSON.parse(stored(r, 'BiliSkinSplash'));
  assert(sp.id === 6 && !sp.md5, 'stored without md5');
});

/* ===== gRPC ===== */

function gv(n) {
  const o = [];
  n = Math.floor(n);
  while (n >= 0x80) {
    o.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  o.push(n);
  return o;
}
function gtag(f, w) {
  return gv(f * 8 + w);
}
function gld(f, bytes) {
  return gtag(f, 2).concat(gv(bytes.length), bytes);
}
function gvar(f, n) {
  return gtag(f, 0).concat(gv(n));
}
function gstr(s) {
  const o = [];
  for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 0xff);
  return o;
}
function gframe(msg) {
  const n = msg.length;
  return [0, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].concat(msg);
}
function gCardBG(id, img) {
  return gvar(1, id).concat(gld(3, gstr(img)));
}
function gSailing(pend, card) {
  return gld(1, gCardBG(1, pend)).concat(gld(2, gCardBG(2, card)));
}
function gEntry(mid, val) {
  return gvar(1, mid).concat(gld(2, val));
}
function gMap(entries) {
  let m = [];
  entries.forEach(function (e) {
    m = m.concat(gld(1, e));
  });
  return m;
}
function u8(arr) {
  return new Uint8Array(arr);
}
function bodyText(r) {
  assert(r.result && r.result.body, 'rewrote body');
  /* JSON 改写返回字符串；二进制改写（gRPC / 包体）返回 Uint8Array */
  if (typeof r.result.body === 'string') return r.result.body;
  const arr = r.result.body;
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return s;
}

const GRPC_SAIL = 'https://grpc.biliapi.net/bilibili.vas.garb.service.BAPIVasGarbService/SailingEquipMulti';
const GRPC_CARD = 'https://grpc.biliapi.net/bilibili.vas.garb.service.BAPIVasGarbService/UserCardMulti';

function grpcCfg(url, msg, store) {
  return {
    type: 'http-response',
    script: { binaryBodyMode: true },
    request: { url: url, method: 'POST', headers: {} },
    response: { status: 200, headers: { 'Content-Type': 'application/grpc' }, body: u8(gframe(msg)) },
    store: store
  };
}

t('gRPC/只改自己那条的卡片和挂件', async function () {
  const msg = gMap([
    gEntry(100, gSailing('https://old/p1.png', 'https://old/c1.png')),
    gEntry(200, gSailing('https://old/p2.png', 'https://old/c2.png'))
  ]);
  const r = await runSurgeScript(
    SRC,
    grpcCfg(GRPC_SAIL, msg, {
      BiliSkinEquip: JSON.stringify(EQUIP_FULL),
      BiliSkinSelf: JSON.stringify({ mid: '100' })
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const text = bodyText(r);
  assert(text.indexOf('garb/item/pend.png') >= 0, '自己的挂件换了');
  assert(text.indexOf('garb/item/card.png') >= 0, '自己的卡片换了');
  assert(text.indexOf('https://old/p1.png') < 0, '旧挂件没了');
  assert(text.indexOf('https://old/c1.png') < 0, '旧卡片没了');
  assert(text.indexOf('https://old/p2.png') >= 0, '别人的挂件没动');
  assert(text.indexOf('https://old/c2.png') >= 0, '别人的卡片没动');
});

t('gRPC/UserCardMulti 换 card_url 与 big_card_url', async function () {
  function gUserCard(cardUrl, bigUrl) {
    return gvar(1, 9).concat(gld(4, gstr(cardUrl))).concat(gld(5, gstr(bigUrl)));
  }
  const msg = gMap([gEntry(100, gUserCard('https://old/card.png', 'https://old/big.png'))]);
  const r = await runSurgeScript(
    SRC,
    grpcCfg(GRPC_CARD, msg, {
      BiliSkinEquip: JSON.stringify(EQUIP_FULL),
      BiliSkinSelf: JSON.stringify({ mid: '100' })
    })
  );
  const text = bodyText(r);
  assert(text.indexOf('garb/item/card.png') >= 0, 'card_url 换了');
  assert(text.indexOf('https://old/card.png') < 0, '旧 card_url 没了');
  assert(text.indexOf('https://old/big.png') < 0, '旧 big_card_url 没了');
});

t('gRPC/没有 selfMid -> 原样放行', async function () {
  const msg = gMap([gEntry(100, gSailing('https://old/p1.png', 'https://old/c1.png'))]);
  const r = await runSurgeScript(
    SRC,
    grpcCfg(GRPC_SAIL, msg, { BiliSkinEquip: JSON.stringify(EQUIP_FULL) })
  );
  assert(r.result.body === undefined, 'untouched');
});

t('gRPC/非装扮服务 -> 原样放行', async function () {
  const msg = gMap([gEntry(100, gSailing('https://old/p1.png', 'https://old/c1.png'))]);
  const r = await runSurgeScript(
    SRC,
    grpcCfg('https://grpc.biliapi.net/bilibili.app.feed.v1.Feed/Index', msg, {
      BiliSkinEquip: JSON.stringify(EQUIP_FULL),
      BiliSkinSelf: JSON.stringify({ mid: '100' })
    })
  );
  assert(r.result.body === undefined, 'untouched');
});

t('gRPC/帧长对不上 -> 原样放行', async function () {
  const r = await runSurgeScript(SRC, {
    type: 'http-response',
    script: { binaryBodyMode: true },
    request: { url: GRPC_SAIL, method: 'POST', headers: {} },
    response: { status: 200, headers: {}, body: u8([0, 0, 0, 0, 99, 1, 2]) },
    store: {
      BiliSkinEquip: JSON.stringify(EQUIP_FULL),
      BiliSkinSelf: JSON.stringify({ mid: '100' })
    }
  });
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'untouched');
});

/* ===== Chronos 开屏包（捕获 + 回放） ===== */

const CHRONOS_URL = 'https://app.bilibili.com/x/chronos/package/obtain?service_key=service_ad';
const CHRONOS_RESP = {
  code: 0,
  data: {
    url: 'https://queue.package.bfcchronos.bilibili.com/a.cron',
    md5: 'm1',
    sign: 's1'
  }
};

t('Chronos/捕获候选（没选就不动 body）', async function () {
  const r = await runSurge(resp(CHRONOS_URL, JSON.stringify(CHRONOS_RESP)));
  assert(r.done, 'must call $done');
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  assert(r.result.body === undefined, 'untouched');
  const rec = JSON.parse(stored(r, 'BiliSkinChronosList'));
  assert(rec.length === 1, 'one candidate');
  assert(rec[0].service_key === 'service_ad', 'service_key captured');
  assert(rec[0].sign === 's1', 'sign captured');
});

t('Chronos/回放选中的三件套', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(CHRONOS_URL, JSON.stringify(CHRONOS_RESP), {
      store: {
        BiliSkinChronos: JSON.stringify({
          service_key: 'service_ad',
          url: 'https://queue.package.bfcchronos.bilibili.com/mine.cron',
          md5: 'mm',
          sign: 'ss'
        })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(r.result.body).data;
  assert(d.url.indexOf('mine.cron') >= 0, 'url replayed');
  assert(d.md5 === 'mm', 'md5 replayed');
  assert(d.sign === 'ss', 'sign replayed');
});

t('Chronos/service_key 不匹配不回放', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(CHRONOS_URL, JSON.stringify(CHRONOS_RESP), {
      store: {
        BiliSkinChronos: JSON.stringify({
          service_key: 'service_special',
          url: 'https://queue.package.bfcchronos.bilibili.com/mine.cron',
          md5: 'mm',
          sign: 'ss'
        })
      }
    })
  );
  assert(r.result.body === undefined, 'untouched');
});

t('Chronos/响应没有包地址 -> 放行', async function () {
  const r = await runSurge(resp(CHRONOS_URL, JSON.stringify({ code: 0, data: { foo: 1 } })));
  assert(r.result.body === undefined, 'untouched');
});

t('Chronos/非 JSON -> 放行', async function () {
  const r = await runSurge(resp(CHRONOS_URL, '<html>WAF</html>'));
  assert(r.done, 'must call $done');
  assert(r.result.body === undefined, 'untouched');
});

t('桥/chronos/set -> 记住', async function () {
  const r = await runSurge(
    post('chronos/set', {
      service_key: 'service_ad',
      url: 'https://queue.package.bfcchronos.bilibili.com/a.cron',
      md5: 'm',
      sign: 's'
    })
  );
  assert(rb(r).code === 0, 'code 0');
  assert(JSON.parse(stored(r, 'BiliSkinChronos')).sign === 's', 'stored');
});

t('桥/chronos/set 缺 sign -> 报错', async function () {
  const r = await runSurge(
    post('chronos/set', { url: 'https://queue.package.bfcchronos.bilibili.com/a.cron', md5: 'm' })
  );
  assert(rb(r).code === -1, 'code -1');
});

t('桥/chronos/list 空 -> []', async function () {
  const r = await runSurge(req('chronos/list'));
  assert(Array.isArray(rb(r).data), 'array');
  assert(rb(r).data.length === 0, 'empty');
});

/* ===== 通用字段换图 + 设置 / 诊断 / 导出导入 / 多账号 / 提醒 ===== */

const EQUIP_ALL = {
  id: 67790,
  name: '全套',
  preview: 'https://i0.hdslb.com/cover.jpg',
  ver: 1711761021,
  package_url: 'https://i0.hdslb.com/bfs/garb/zip/x.zip',
  package_md5: 'm',
  data: { color: '#fff' },
  components: {
    skin: { kind: 'skin', package_url: 'https://i0.hdslb.com/bfs/garb/zip/x.zip' },
    loading: { kind: 'loading', id: 2, loading_url: 'https://i0.hdslb.com/l.webp' },
    card: { kind: 'card', image: 'https://i0.hdslb.com/card.png' },
    card_bg: { kind: 'card_bg', image: 'https://i0.hdslb.com/cardbg.png' },
    pendant: { kind: 'pendant', image: 'https://i0.hdslb.com/pend.png' },
    thumbup: { kind: 'thumbup', image_ani: 'https://i0.hdslb.com/ani.png' },
    play_icon: { kind: 'play_icon', static_icon_image: 'https://i0.hdslb.com/icon.png' },
    space_bg: { kind: 'space_bg', url: 'https://i0.hdslb.com/space.png' }
  }
};

const SPACE_URL = 'https://app.bilibili.com/x/v2/space/garb/detail?mid=1';
const SPACE_RESP = {
  code: 0,
  data: {
    garb: {
      id: 1,
      space_bg: { image1_portrait: 'https://i0.hdslb.com/old1.png' },
      thumbup: { url_image_ani_cut: 'https://i0.hdslb.com/old2.png' },
      play_icon: { static_icon_image: 'https://i0.hdslb.com/old3.png' },
      pendant: { image_enhance: 'https://i0.hdslb.com/old4.png' }
    }
  }
};

t('组件字段/按字段名把 space_bg·thumbup·play_icon·挂件都换掉', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SPACE_URL, JSON.stringify(SPACE_RESP), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(r.result.body).data.garb;
  assert(d.space_bg.image1_portrait === 'https://i0.hdslb.com/space.png', 'space_bg 换了');
  assert(d.thumbup.url_image_ani_cut === 'https://i0.hdslb.com/ani.png', 'thumbup 换了');
  assert(d.play_icon.static_icon_image === 'https://i0.hdslb.com/icon.png', 'play_icon 换了');
  assert(d.pendant.image_enhance === 'https://i0.hdslb.com/pend.png', '挂件动态形态换了');
});

t('组件字段/没有命中字段 -> 原样放行', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(SPACE_URL, JSON.stringify({ code: 0, data: { foo: 'https://i0.hdslb.com/x.png' } }), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  assert(r.result.body === undefined, 'untouched');
});

t('设置/默认值 + 改一项', async function () {
  const r1 = await runSurge(req('prefs'));
  const p1 = rb(r1).data;
  assert(p1.allMembers === false && p1.lang === 'zh', '默认值');
  const r2 = await runSurge(post('prefs/set', { allMembers: true, lang: 'en' }));
  assert(rb(r2).data.allMembers === true, '改成功');
  const r3 = await runSurge(req('prefs', { store: { BiliSkinPrefs: stored(r2, 'BiliSkinPrefs') } }));
  assert(rb(r3).data.allMembers === true && rb(r3).data.lang === 'en', '持久化');
  assert(rb(r3).data.notify === true, '没改的保留默认');
});

t('设置/allMembers 打开后别人的评论装扮也改', async function () {
  const body = JSON.stringify({
    code: 0,
    data: {
      replies: [
        { member: { mid: 100, user_sailing_v2: { card_bg: { image: 'https://old/1.png' } } } },
        { member: { mid: 200, user_sailing_v2: { card_bg: { image: 'https://old/2.png' } } } }
      ]
    }
  });
  const r = await runSurgeScript(
    SRC,
    resp(REPLY_URL, body, {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinPrefs: JSON.stringify({ allMembers: true })
      }
    })
  );
  const out = JSON.parse(r.result.body);
  assert(out.data.replies[0].member.user_sailing_v2.card_bg.image.indexOf('cardbg') >= 0, '自己换了');
  assert(out.data.replies[1].member.user_sailing_v2.card_bg.image.indexOf('cardbg') >= 0, '别人也换了');
});

t('诊断/返回关键状态', async function () {
  const r = await runSurgeScript(
    SRC,
    req('diag', {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinSelf: JSON.stringify({ mid: '42' })
      }
    })
  );
  const d = rb(r).data;
  assert(d.equip && d.equip.id === 67790, 'equip');
  assert(d.equip.hasSkin === true && d.equip.hasLoading === true, 'skin/loading 判定');
  assert(d.equip.components.indexOf('space_bg') >= 0, 'components 列表');
  assert(d.selfMid === '42', 'mid');
});

t('导出/导入 往返一致', async function () {
  const r1 = await runSurgeScript(
    SRC,
    req('export', {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinGallery: JSON.stringify([EQUIP_ALL])
      }
    })
  );
  const dump = rb(r1).data;
  assert(dump.v === 1 && dump.equip.id === 67790, '导出内容');
  const r2 = await runSurge(post('import', dump));
  assert(rb(r2).code === 0, 'code 0');
  assert(rb(r2).data.sections >= 2, '写入段数: ' + rb(r2).data.sections);
  assert(JSON.parse(stored(r2, 'BiliSkinEquip')).id === 67790, 'equip 落库');
});

t('导出/导入 非法数据报错', async function () {
  const r = await runSurgeScript(
    SRC,
    post('import', {}, { request: { url: BRIDGE_URL + 'import', method: 'POST', headers: {}, body: '{oops' } })
  );
  assert(rb(r).code === -1, 'code -1');
});

t('多账号/equips 列表 + 切换', async function () {
  const other = Object.assign({}, EQUIP_ALL, { id: 111, name: '另一个账号的' });
  const store = { BiliSkinEquips: JSON.stringify({ '1': EQUIP_ALL, '2': other }) };
  const r1 = await runSurgeScript(SRC, req('equips', { store: store }));
  assert(Object.keys(rb(r1).data).length === 2, '两个账号');
  const r2 = await runSurgeScript(SRC, req('equips/use?mid=2', { store: store }));
  assert(rb(r2).code === 0 && rb(r2).data.mid === '2', '切换成功');
  assert(JSON.parse(stored(r2, 'BiliSkinEquip')).id === 111, '落库');
});

t('多账号/切不存在的报错', async function () {
  const r = await runSurge(req('equips/use?mid=999'));
  assert(rb(r).code === -1, 'code -1');
});

t('提醒/新增与移除', async function () {
  const r1 = await runSurge(post('reminders/add', { id: 7, name: '灵魂潮汐', startAt: 1791891000 }));
  assert(rb(r1).code === 0, 'code 0');
  const r2 = await runSurge(req('reminders', { store: { BiliSkinReminders: stored(r1, 'BiliSkinReminders') } }));
  assert(rb(r2).data.length === 1, '一条');
  const r3 = await runSurge(req('reminders/remove?id=7', { store: { BiliSkinReminders: stored(r1, 'BiliSkinReminders') } }));
  assert(rb(r3).data.count === 0, '移除了');
});

t('提醒/到点自动发通知并摘掉', async function () {
  const past = { id: 1, name: '到点了', startAt: 1 };
  const r = await runSurgeScript(
    SRC,
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinReminders: JSON.stringify([past])
      }
    })
  );
  assert(r.notifications.length === 1, '发了一条通知');
  assert(r.notifications[0].subtitle.indexOf('开售') >= 0, '副标题对');
  assert(JSON.parse(stored(r, 'BiliSkinReminders')).length === 0, '摘掉了');
});

t('开屏/保留视频通道（设置里开）', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(EVENT_URL, JSON.stringify(EVENT_RESP), {
      store: {
        BiliSkinSplash: JSON.stringify({
          kind: 'event',
          thumb: 'https://i0.hdslb.com/mine.jpg',
          md5: 'mm'
        }),
        BiliSkinPrefs: JSON.stringify({ splashKeepVideo: true })
      }
    })
  );
  const el = JSON.parse(r.result.body).data.list[0];
  assert(el.front_image_url === 'https://i0.hdslb.com/mine.jpg', '图换了');
  assert(el.video_url === 'https://upos/front.mp4', '视频保留');
});

t('开屏/刮擦比例可调', async function () {
  const r = await runSurgeScript(
    SRC,
    resp(EVENT_URL, JSON.stringify(EVENT_RESP), {
      store: {
        BiliSkinSplash: JSON.stringify({
          kind: 'event',
          thumb: 'https://i0.hdslb.com/mine.jpg',
          md5: 'mm'
        }),
        BiliSkinPrefs: JSON.stringify({ splashScratch: 75 })
      }
    })
  );
  assert(JSON.parse(r.result.body).data.list[0].scratch_percent === 75, '刮擦比例改成 75');
});

t('gRPC/兜底模式：schema 不匹配也把 garb 图换掉', async function () {
  const msg = gMap([gEntry(100, gSailing('https://i0.hdslb.com/bfs/garb/item/old1.png', 'https://i0.hdslb.com/bfs/garb/item/old2.png'))]);
  const r = await runSurgeScript(SRC, {
    type: 'http-response',
    script: { binaryBodyMode: true },
    request: {
      url: 'https://grpc.biliapi.net/bilibili.vas.garb.service.BAPIVasGarbService/SomeOtherCall',
      method: 'POST',
      headers: {}
    },
    response: { status: 200, headers: {}, body: u8(gframe(msg)) },
    store: {
      BiliSkinEquip: JSON.stringify(EQUIP_ALL),
      BiliSkinPrefs: JSON.stringify({ grpcAll: true })
    }
  });
  const text = bodyText(r);
  assert(text.indexOf('cardbg.png') >= 0, '换成我们的图了');
  assert(text.indexOf('old1.png') < 0 && text.indexOf('old2.png') < 0, '旧的都没了');
});

t('gRPC/兜底模式默认关 -> 放行', async function () {
  const msg = gMap([gEntry(100, gSailing('https://i0.hdslb.com/bfs/garb/item/old1.png', 'https://i0.hdslb.com/bfs/garb/item/old2.png'))]);
  const r = await runSurgeScript(SRC, {
    type: 'http-response',
    script: { binaryBodyMode: true },
    request: {
      url: 'https://grpc.biliapi.net/bilibili.vas.garb.service.BAPIVasGarbService/SomeOtherCall',
      method: 'POST',
      headers: {}
    },
    response: { status: 200, headers: {}, body: u8(gframe(msg)) },
    store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
  });
  assert(r.result.body === undefined, 'untouched');
});

t('Chronos/包体缓存后不再出网', async function () {
  const payload = 'PK\u0003\u0004fake-cron-package-bytes';
  const r = await runSurgeScript(
    SRC,
    post('chronos/set', { service_key: 'service_ad', url: 'https://x.cdn/a.cron', md5: 'm', sign: 's' }, {
      http: [{ match: 'https://x.cdn/a.cron', body: payload }]
    })
  );
  assert(rb(r).code === 0, 'code 0');
  assert(rb(r).data.cached === true, '缓存成功');
  const blob = JSON.parse(stored(r, 'BiliSkinChronosBlob'));
  assert(blob.b64 && blob.size === payload.length, 'blob 落库');
});

t('Chronos/包请求命中本地缓存直接吐字节', async function () {
  const payload = 'PK\u0003\u0004cached';
  const blob = { url: 'https://x.cdn/a.cron', md5: 'm', size: payload.length, b64: null };
  // 用同一套编码逻辑先造出 b64（借脚本自身：先缓存一次）
  const r1 = await runSurgeScript(
    SRC,
    post('chronos/set', { url: 'https://x.cdn/a.cron', md5: 'm', sign: 's' }, {
      http: [{ match: 'https://x.cdn/a.cron', body: payload }]
    })
  );
  const storedBlob = stored(r1, 'BiliSkinChronosBlob');
  const r2 = await runSurgeScript(SRC, {
    type: 'http-response',
    script: { binaryBodyMode: true },
    request: { url: 'https://x.cdn/a.cron?sign=s', method: 'GET', headers: {} },
    response: { status: 200, headers: {}, body: u8([]) },
    store: { BiliSkinChronosBlob: storedBlob }
  });
  const out = r2.result.body;
  assert(out && out.length === payload.length, '长度一致: ' + (out && out.length));
  let s = '';
  for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
  assert(s === payload, '字节一致');
});

/* ---------- 头像挂件 / 我的页 / 空间页（实机反馈后修） ---------- */

const MINE_URL = 'https://app.bilibili.com/x/v2/account/mine?build=1';
const MINE_RESP = {
  code: 0,
  data: {
    mid: 12345,
    pendantUrl: 'https://i0.hdslb.com/bfs/garb/old_pendant.png',
    bCoinDesc: '1.2万',
    vip_space_label: ''
  }
};

t('我的页/换掉 pendantUrl 并学下 selfMid', async function () {
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify(MINE_RESP), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.pendantUrl === 'https://i0.hdslb.com/pend.png', 'pendantUrl 换成挂件图');
  const self = JSON.parse(stored(r, 'BiliSkinSelf'));
  assert(self && self.mid === '12345', '学到 selfMid');
});

const SPACE_OTHER_RESP = {
  code: 0,
  data: {
    mid: 999,
    card: { mid: 999, pendant: { image: 'https://i0.hdslb.com/bfs/other.png' } }
  }
};

t('空间页/别人的空间不动', async function () {
  const r = await runSurge(
    resp('https://app.bilibili.com/x/v2/space?mid=999', JSON.stringify(SPACE_OTHER_RESP), {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinSelf: JSON.stringify({ mid: '12345' })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  assert(!r.result || !r.result.body, '没改写（原样放行）');
});

const SPACE_SELF_RESP = {
  code: 0,
  data: {
    mid: 12345,
    card: { mid: 12345, pendant: { image: 'https://i0.hdslb.com/bfs/mine_old.png' } }
  }
};

t('空间页/自己的空间换挂件', async function () {
  const r = await runSurge(
    resp('https://app.bilibili.com/x/v2/space?mid=12345', JSON.stringify(SPACE_SELF_RESP), {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinSelf: JSON.stringify({ mid: '12345' })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.card.pendant.image === 'https://i0.hdslb.com/pend.png', '挂件换了');
});

t('接口日志/记录后可从 store 导出', async function () {
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify(MINE_RESP), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  const log = JSON.parse(stored(r, 'BiliSkinApiLog') || '[]');
  assert(log.length >= 1, '记了至少一条');
  assert(log[0].path.indexOf('/x/v2/account/mine') >= 0, 'path 对');
  assert(log[0].sample.indexOf('pendantUrl') >= 0, 'sample 带响应内容');
});

/* ---------- 开屏：新版 business list/show ---------- */

const BSPLASH_LIST_RESP = {
  code: 0,
  data: {
    creative_list: [
      { id: 111, image_url: 'https://i0.hdslb.com/bfs/splash/a.png', hash: 'h1' },
      { id: 222, image_url: 'https://i0.hdslb.com/bfs/splash/b.png', hash: 'h2' }
    ]
  }
};

t('开屏/新版 business list 记录候选', async function () {
  const r = await runSurge(
    resp('https://app.bilibili.com/x/v2/splash/list?type=hot', JSON.stringify(BSPLASH_LIST_RESP), {
      store: {}
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const list = JSON.parse(stored(r, 'BiliSkinSplashList') || '[]');
  assert(list.length === 2, '记了 2 个候选: ' + list.length);
  assert(list[0].thumb === 'https://i0.hdslb.com/bfs/splash/a.png', 'thumb 对');
});

t('开屏/business show 把创意图换成选中的', async function () {
  const body = {
    code: 0,
    data: { id: 111, image_url: 'https://i0.hdslb.com/bfs/splash/orig.png', hash: 'h' }
  };
  const r = await runSurge(
    resp('https://app.bilibili.com/x/v2/splash/show?id=111', JSON.stringify(body), {
      store: {
        BiliSkinSplash: JSON.stringify({
          kind: 'brand',
          id: 9001,
          thumb: 'https://i0.hdslb.com/bfs/garb/my_splash.png',
          duration: 3000
        })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.image_url === 'https://i0.hdslb.com/bfs/garb/my_splash.png', '创意图换了');
});

/* ---------- 收藏集 / 头像挂件 / 我的页加载动画（实机反馈后修） ---------- */

/* 真实响应取样：x/vas/dlc_act/lottery_home_detail?act_id=114713&lottery_id=114714
   注意 type 数字是 1001 / 3 / 1 —— 各活动不统一，所以只能按 redeem_item_type_name 认。 */
const COLLECT_URL =
  'https://api.bilibili.com/x/vas/dlc_act/lottery_home_detail?act_id=114713&lottery_id=114714';
const COLLECT_RESP = {
  code: 0,
  data: {
    lottery_id: 114714,
    name: '日光拾集',
    collect_list: {
      collect_infos: [
        {
          collect_id: 0,
          redeem_item_type: 1001,
          redeem_item_id: '',
          redeem_item_name: '小辞炒糍粑',
          redeem_item_image: 'https://i0.hdslb.com/bfs/garb/cardbg.png',
          redeem_item_type_name: '评论背景'
        },
        {
          collect_id: 114720,
          redeem_item_type: 3,
          redeem_item_id: '1790565160001',
          redeem_item_name: '日光拾集·头像挂件',
          redeem_item_image: 'https://i0.hdslb.com/bfs/garb/pendant.png',
          redeem_item_type_name: '头像挂件'
        },
        {
          collect_id: 114722,
          redeem_item_type: 1,
          redeem_item_id: '1790737537002',
          redeem_item_name: '典藏卡·无敌雷兹大王',
          redeem_item_image: 'https://i0.hdslb.com/bfs/garb/card.png',
          redeem_item_type_name: '典藏卡'
        }
      ]
    }
  }
};

t('收藏集/兑换物抓成候选：挂件与评论背景带组件，典藏卡只留 id', async function () {
  const r = await runSurge(resp(COLLECT_URL, JSON.stringify(COLLECT_RESP)));
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const seen = JSON.parse(stored(r, 'BiliSkinSeen') || '[]');
  assert(seen.length === 3, '抓到 3 条: ' + seen.length);

  const pend = seen.filter(function (x) {
    return x.equip.components && x.equip.components.pendant;
  })[0];
  assert(!!pend, '有头像挂件候选');
  assert(
    pend.equip.components.pendant.url === 'https://i0.hdslb.com/bfs/garb/pendant.png',
    '挂件图对: ' + JSON.stringify(pend.equip.components.pendant)
  );

  const cbg = seen.filter(function (x) {
    return x.equip.components && x.equip.components.card_bg;
  })[0];
  assert(!!cbg, '有评论背景候选');

  const need = seen.filter(function (x) {
    return x.equip.needResolve;
  })[0];
  assert(need && String(need.equip.id) === '1790737537002', '典藏卡只留 id 等面板解析');
});

t('收藏集/同时写 7 天有效的持久候选（逛完原生页回面板还看得到）', async function () {
  const r = await runSurge(resp(COLLECT_URL, JSON.stringify(COLLECT_RESP)));
  const found = JSON.parse(stored(r, 'BiliSkinFound') || '[]');
  assert(found.length === 3, '持久候选 3 条: ' + found.length);
});

t('收藏集/挂件候选能注入「我的」页的 pendantUrl', async function () {
  const equip = {
    id: 1790565160001,
    name: '日光拾集·头像挂件',
    preview: 'https://i0.hdslb.com/bfs/garb/pendant.png',
    partial: true,
    components: {
      pendant: {
        id: 1790565160001,
        name: '日光拾集·头像挂件',
        url: 'https://i0.hdslb.com/bfs/garb/pendant.png',
        image: 'https://i0.hdslb.com/bfs/garb/pendant.png'
      }
    }
  };
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify(MINE_RESP), { store: { BiliSkinEquip: JSON.stringify(equip) } })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.pendantUrl === 'https://i0.hdslb.com/bfs/garb/pendant.png', 'pendantUrl 换成挂件图');
});

t('桥/set 接受「只有挂件」的候选（收藏集来的没有 package_url）', async function () {
  const equip = {
    id: 9,
    name: '挂件',
    components: { pendant: { id: 9, url: 'https://i0.hdslb.com/p.png' } }
  };
  const r = await runSurge(post('set', equip));
  assert(rb(r).code === 0, 'code 0: ' + JSON.stringify(rb(r)));
});

t('我的页/loading_url 也按字段名换（加载动画不再只有视频页）', async function () {
  const body = JSON.stringify({
    code: 0,
    data: { mid: 12345, loading_url: 'https://i0.hdslb.com/bfs/garb/old.webp' }
  });
  const r = await runSurge(
    resp(MINE_URL, body, { store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) } })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.loading_url === 'https://i0.hdslb.com/l.webp', 'loading_url 换了: ' + d.loading_url);
});

t('空间海报/image8·image9 也换（实测 properties 一直排到 9）', async function () {
  const body = JSON.stringify({
    code: 0,
    data: {
      mid: 12345,
      space_bg: {
        image8_portrait: 'https://i0.hdslb.com/old8.png',
        image9_landscape: 'https://i0.hdslb.com/old9.png'
      }
    }
  });
  const r = await runSurge(
    resp(MINE_URL, body, { store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) } })
  );
  const d = JSON.parse(bodyText(r)).data;
  assert(d.space_bg.image8_portrait === 'https://i0.hdslb.com/space.png', 'image8 换了');
  assert(d.space_bg.image9_landscape === 'https://i0.hdslb.com/space.png', 'image9 换了');
});

t('动态信息流/x polymer web-dynamic 的 module_author.pendant 换掉', async function () {
  const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=all';
  const body = JSON.stringify({
    code: 0,
    data: {
      items: [
        {
          modules: {
            module_author: {
              mid: 12345,
              name: '我',
              pendant: { image: 'https://i0.hdslb.com/old_p.png' }
            }
          }
        }
      ]
    }
  });
  const r = await runSurge(
    resp(url, body, {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinSelf: JSON.stringify({ mid: '12345' })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(
    d.items[0].modules.module_author.pendant.image === 'https://i0.hdslb.com/pend.png',
    '挂件换了: ' + d.items[0].modules.module_author.pendant.image
  );
});

t('桥/found 返回持久候选', async function () {
  const equip = {
    id: 1,
    name: 'x',
    components: { pendant: { id: 1, url: 'https://i0.hdslb.com/p.png' } }
  };
  const r = await runSurge(
    req('found', { store: { BiliSkinFound: JSON.stringify([{ ts: Date.now(), equip: equip }]) } })
  );
  const list = rb(r).data;
  assert(list.length === 1 && list[0].id === 1, '返回候选');
});

t('桥/found 过滤过期条目', async function () {
  const equip = {
    id: 1,
    name: 'x',
    components: { pendant: { id: 1, url: 'https://i0.hdslb.com/p.png' } }
  };
  const r = await runSurge(
    req('found', {
      store: { BiliSkinFound: JSON.stringify([{ ts: Date.now() - 8 * 86400000, equip: equip }]) }
    })
  );
  assert(rb(r).data.length === 0, '过期的不返回');
});

t('我的页/用户原本没有挂件时依然能够成功注入挂件', async function () {
  const NO_PENDANT_RESP = {
    code: 0,
    data: {
      mid: 12345,
      pendantUrl: '',
      card: {
        mid: 12345,
        pendant: { pid: 0, name: '', image: '', expire: 0, image_enhance: '', image_enhance_frame: '' }
      }
    }
  };
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify(NO_PENDANT_RESP), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.pendantUrl === 'https://i0.hdslb.com/pend.png', 'pendantUrl 注入');
  assert(d.card.pendant.image === 'https://i0.hdslb.com/pend.png', 'pendant.image 注入');
  assert(d.card.pendant.pid > 0, 'pid 变为有效数字');
});

t('我的页/只有挂件候选不动顶栏背景（preview 是挂件小图，别拿来当 header_bg）', async function () {
  const PENDANT_ONLY = {
    id: 1790565160001,
    name: '收藏集挂件',
    preview: 'https://i0.hdslb.com/bfs/garb/item/pend.png',
    components: {
      pendant: {
        kind: 'pendant',
        id: 1790565160001,
        name: '收藏集挂件',
        image: 'https://i0.hdslb.com/bfs/garb/item/pend.png',
        url: 'https://i0.hdslb.com/bfs/garb/item/pend.png'
      }
    },
    from: 'collect',
    partial: true
  };
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify({
      code: 0,
      data: {
        mid: 12345,
        pendantUrl: '',
        header_bg: 'https://i0.hdslb.com/bfs/space/orig_header.jpg',
        vip_space_label: 'https://i0.hdslb.com/bfs/space/orig_label.png'
      }
    }), { store: { BiliSkinEquip: JSON.stringify(PENDANT_ONLY) } })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.pendantUrl.indexOf('pend.png') >= 0, '挂件照常注入');
  assert(
    d.header_bg === 'https://i0.hdslb.com/bfs/space/orig_header.jpg',
    '顶栏背景保持原样，实际：' + d.header_bg
  );
  assert(
    d.vip_space_label === 'https://i0.hdslb.com/bfs/space/orig_label.png',
    '顶栏标签图保持原样，实际：' + d.vip_space_label
  );
});

t('我的页/新版 avatar.layers 挂件图层成功注入', async function () {
  const MINE_AVATAR_RESP = {
    code: 0,
    data: {
      mid: 12345,
      avatar: {
        container_size: { width: 1.35, height: 1.35 },
        layers: [
          {
            is_critical_group: true,
            layers: [
              {
                visible: true,
                general_spec: { pos_spec: { coordinate_pos: 2, axis_x: 0.675, axis_y: 0.675 }, size_spec: { width: 1, height: 1 } },
                resource: { res_type: 3, res_image: { image_src: { remote: { url: 'https://i0.hdslb.com/bfs/face/member/noface.jpg' } } } }
              }
            ]
          }
        ]
      }
    }
  };
  const r = await runSurge(
    resp(MINE_URL, JSON.stringify(MINE_AVATAR_RESP), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.pendantUrl === 'https://i0.hdslb.com/pend.png', 'pendantUrl 注入');
  assert(d.pendant && d.pendant.image === 'https://i0.hdslb.com/pend.png', 'pendant 对象注入');
  const sublayers = d.avatar.layers[0].layers;
  const pLayer = sublayers.find(l => l.layer_config && l.layer_config.tags && l.layer_config.tags.PENDANT_LAYER);
  assert(pLayer, 'avatar.layers 注入了 PENDANT_LAYER');
  assert(pLayer.resource.res_image.image_src.remote.url === 'https://i0.hdslb.com/pend.png', '挂件图层 URL 注入正确');
});

t('评论装扮/用户原本没有 user_sailing 节点时依然能够成功注入', async function () {
  const NO_SAILING_RESP = {
    code: 0,
    data: {
      replies: [
        { member: { mid: 100 } }
      ]
    }
  };
  const r = await runSurge(
    resp(REPLY_URL, JSON.stringify(NO_SAILING_RESP), {
      store: {
        BiliSkinEquip: JSON.stringify(EQUIP_ALL),
        BiliSkinSelf: JSON.stringify({ mid: '100' })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const m = JSON.parse(bodyText(r)).data.replies[0].member;
  assert(m.user_sailing && m.user_sailing.pendant && m.user_sailing.pendant.image.indexOf('pend.png') >= 0, '注入了 pendant');
  /* 真实字段名是 cardbg（没有下划线），见 user_sailing 结构实测 */
  assert(m.user_sailing.cardbg && m.user_sailing.cardbg.image.indexOf('cardbg.png') >= 0, '注入了 cardbg');
  assert(m.user_sailing.card_bg === undefined, '不该再写 App 不认识的 card_bg');
  assert(m.user_sailing_v2 && m.user_sailing_v2.card_bg && m.user_sailing_v2.card_bg.image.indexOf('cardbg.png') >= 0, 'v2 也注入了');
});

/* 线上实测结构（aid=117451148822815）：v1 用 cardbg，v2 用 card_bg。
   以前只写 v2、把 v1 的 cardbg 留着 → App 把「原来的卡」和「我们的卡」都画出来，
   就是实机看到的「加载了两层、互相打架」。 */
t('评论装扮/v1 的 cardbg 与 v2 的 card_bg 一起换，不留旧图', async function () {
  const REAL_SHAPE = {
    code: 0,
    data: {
      replies: [
        {
          member: {
            mid: 100,
            user_sailing: {
              pendant: null,
              cardbg: {
                id: 35845,
                name: '凡人修仙传',
                image: 'https://i0.hdslb.com/bfs/garb/item/old_card.png',
                jump_url: 'https://www.bilibili.com/h5/mall/...',
                fan: { is_fan: 1, number: 598, color: '#0e8fd1', name: '凡人修仙传', num_desc: '000598' },
                type: 'suit',
                image_group: null
              },
              cardbg_with_focus: null
            },
            user_sailing_v2: {
              card_bg: {
                id: 35845,
                name: '凡人修仙传',
                image: 'https://i0.hdslb.com/bfs/garb/item/old_card.png',
                type: 'suit'
              }
            }
          }
        }
      ]
    }
  };
  const r = await runSurge(
    resp(REPLY_URL, JSON.stringify(REAL_SHAPE), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL), BiliSkinSelf: JSON.stringify({ mid: '100' }) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const m = JSON.parse(bodyText(r)).data.replies[0].member;
  assert(m.user_sailing.cardbg.image.indexOf('cardbg.png') >= 0, 'v1 cardbg 被换掉');
  assert(m.user_sailing_v2.card_bg.image.indexOf('cardbg.png') >= 0, 'v2 card_bg 被换掉');
  assert(m.user_sailing.cardbg.image === m.user_sailing_v2.card_bg.image, '两层是同一张图，不会互相打架');
  assert(m.user_sailing.cardbg.fan && m.user_sailing.cardbg.fan.number === 598, '粉丝牌字段保留');
  assert(m.user_sailing.cardbg.image_group === null, 'image_group 保留');
});

/* 卡片对象里 image_preview_small 是「先画的小预览」，挂件对象里 image_enhance 是
   「动态形态」—— 这两个不跟着换，就会先画旧图再叠新图，实机看着像两层。 */
t('评论装扮/预览图与挂件的动态形态一起换，不留旧图', async function () {
  const body = {
    code: 0,
    data: {
      replies: [
        {
          member: {
            mid: 100,
            user_sailing: {
              pendant: {
                pid: 9,
                name: '旧挂件',
                image: 'https://i0.hdslb.com/old_pend.png',
                image_enhance: 'https://i0.hdslb.com/old_pend_ani.png',
                image_enhance_frame: 'https://i0.hdslb.com/old_pend_frame.png',
                expire: 0
              },
              cardbg: {
                id: 1,
                name: '旧卡',
                image: 'https://i0.hdslb.com/old_card.png',
                image_preview_small: 'https://i0.hdslb.com/old_card_small.png',
                type: 'suit'
              }
            },
            user_sailing_v2: {
              card_bg: {
                id: 1,
                name: '旧卡',
                image: 'https://i0.hdslb.com/old_card.png',
                image_preview_small: 'https://i0.hdslb.com/old_card_small.png',
                type: 'suit'
              }
            }
          }
        }
      ]
    }
  };
  const r = await runSurge(
    resp(REPLY_URL, JSON.stringify(body), {
      store: { BiliSkinEquip: JSON.stringify(EQUIP_ALL), BiliSkinSelf: JSON.stringify({ mid: '100' }) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const m = JSON.parse(bodyText(r)).data.replies[0].member;
  assert(m.user_sailing.cardbg.image_preview_small.indexOf('cardbg.png') >= 0, '小预览也换了');
  assert(m.user_sailing_v2.card_bg.image_preview_small.indexOf('cardbg.png') >= 0, 'v2 小预览也换了');
  assert(m.user_sailing.pendant.image.indexOf('pend.png') >= 0, '挂件静态图换了');
  assert(m.user_sailing.pendant.image_enhance.indexOf('pend.png') >= 0, '挂件动态形态不再留旧图');
  assert(m.user_sailing.pendant.image_enhance_frame === '', '旧帧图清掉');
});

t('开屏/business show 支持收藏集或自定义开屏并同步换 hash', async function () {
  const body = {
    code: 0,
    data: { id: 111, image_url: 'https://i0.hdslb.com/bfs/splash/orig.png', hash: 'orig_hash' }
  };
  const r = await runSurge(
    resp('https://app.bilibili.com/x/v2/splash/show?id=1', JSON.stringify(body), {
      store: {
        BiliSkinSplash: JSON.stringify({
          kind: 'collect',
          thumb: 'https://i0.hdslb.com/bfs/splash/collect.png',
          md5: 'new_md5_hash'
        })
      }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data;
  assert(d.image_url === 'https://i0.hdslb.com/bfs/splash/collect.png', '开屏图换了');
  assert(d.hash === 'new_md5_hash', 'hash 同步更新');
});

t('主题数据/保留 head_myself_* 等「我的」主页顶栏完整字段', async function () {
  const fullSkinProps = {
    color_mode: 'dark',
    color: '#111',
    head_myself_mp4_bg: 'https://i0.hdslb.com/head_mp4.mp4',
    head_myself_squared_bg: 'https://i0.hdslb.com/head_square.jpg',
    tail_icon_myself: 'https://i0.hdslb.com/tail_my.png'
  };
  const equip = {
    id: 100,
    package_url: 'https://i0.hdslb.com/skin.zip',
    data: fullSkinProps
  };
  const r = await runSurge(
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), {
      store: { BiliSkinEquip: JSON.stringify(equip) }
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const d = JSON.parse(bodyText(r)).data.user_equip.data;
  assert(d.head_myself_mp4_bg === 'https://i0.hdslb.com/head_mp4.mp4', 'head_myself_mp4_bg 保留');
  assert(d.head_myself_squared_bg === 'https://i0.hdslb.com/head_square.jpg', 'head_myself_squared_bg 保留');
});

t('收藏集/home_detail_v2 动态主题套装与 card_list 嗅探与注入', async function () {
  const HOME_DETAIL_RESP = {
    code: 0,
    data: {
      lottery_id: 114676,
      name: '艾尔莎只想宅在家',
      card_list: [
        { card_type_id: 1001, card_name: '狼出没注意', card_img: 'https://i0.hdslb.com/bfs/card1.png' }
      ],
      collect_list: [
        {
          collect_id: 114679,
          redeem_item_type: 5,
          redeem_item_id: '1791739296001&1791739013001',
          redeem_item_name: '艾尔莎只想宅在家',
          redeem_item_image: 'https://i0.hdslb.com/bfs/suit_preview.png',
          redeem_item_type_name: '动态主题套装',
          redeem_detail_videos: ['https://hdslb.com/video.mp4']
        }
      ]
    }
  };
  const r = await runSurge(
    resp('https://api.bilibili.com/x/vas/dlc_act/lottery/home_detail/v2?act_id=114675', JSON.stringify(HOME_DETAIL_RESP), {
      store: {}
    })
  );
  assert(!r.errors.length, 'no errors: ' + r.errors.join('|'));
  const found = JSON.parse(stored(r, 'BiliSkinFound') || '[]');
  const suit = found.map(x => x.equip).find(f => f.name === '艾尔莎只想宅在家');
  assert(suit, '提取到了动态主题套装');
  assert(suit.video_url === 'https://hdslb.com/video.mp4', '提取到了视频 URL');
  const card = found.map(x => x.equip).find(f => f.name === '狼出没注意');
  assert(card, '提取到了 card_list 中的立绘卡片');

  // 测试该动态主题套装注入到 skin
  const applyResp = await runSurge(
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), {
      store: { BiliSkinEquip: JSON.stringify(suit) }
    })
  );
  const uEquip = JSON.parse(bodyText(applyResp)).data.user_equip;
  assert(uEquip && uEquip.package_url, '无自带包的动态主题自动获得了官方基底包');
  assert(uEquip.data.head_myself_mp4_bg === 'https://hdslb.com/video.mp4', '动效视频成功注入');
});

t('桥/delisted 返回官方下架/绝版主题库并支持应用', async function () {
  const r = await runSurge(req('delisted'));
  const d = rb(r).data;
  assert(d && d.user_equip && d.user_equip.length >= 30, '包含至少30套绝版主题: ' + (d && d.user_equip && d.user_equip.length));
  assert(d && d.load_equip && d.load_equip.length >= 8, '包含至少8套绝版加载动画: ' + (d && d.load_equip && d.load_equip.length));
  const miku = d.user_equip.find(x => x.name === '初音未来-日版');
  assert(miku && miku.package_url && miku.package_md5, '初音未来包体完整');

  // 测试该官方下架主题应用到 skin
  const applyResp = await runSurge(
    resp(SKIN_URL, JSON.stringify(SKIN_RESP), {
      store: { BiliSkinEquip: JSON.stringify(miku) }
    })
  );
  const uEquip = JSON.parse(bodyText(applyResp)).data.user_equip;
  assert(uEquip.id === miku.id, '绝版主题 id 正确');
  assert(uEquip.package_url === miku.package_url, '绝版主题 package_url 注入成功');
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
