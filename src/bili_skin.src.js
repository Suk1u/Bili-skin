/*
 * 哔哩哔哩装扮工作室 —— Surge 侧
 *
 * 同一个文件被四条 [Script] 引用，按 $script.type + URL 分派：
 *   1. http-request  app.bilibili.com/x/surge-skin/*     -> H5 页面与 Surge 的通信桥
 *   2. http-response app.bilibili.com/x/resource/show/skin -> 替换「当前装扮」
 *   3. http-response www.bilibili.com/h5/mall/*          -> 注入页面脚本
 *   4. http-response api.bilibili.com/x/(garb|vas)/      -> 嗅探，记下本页出现过的装扮
 *
 * 本文件由 scripts/build-bili.js 从 src/bili_skin.src.js 生成，请勿直接改 bili_skin.js。
 */

var KEY_EQUIP = 'BiliSkinEquip';
var KEY_GALLERY = 'BiliSkinGallery';
var KEY_SEEN = 'BiliSkinSeen';
var GALLERY_MAX = 300;
var SEEN_MAX = 40;
var SEEN_TTL = 600000;

/* 由构建脚本内联的 H5 页面脚本 */
var H5_PAYLOAD = __H5_PAYLOAD__;

var TYPE =
  ($script && $script.type) ||
  (typeof $response === 'undefined' ? 'http-request' : 'http-response');

/* ===================== 通用 ===================== */

function readJSON(key, fallback) {
  var raw = $persistentStore.read(key);
  if (!raw) return fallback;
  try {
    var v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, val) {
  try {
    $persistentStore.write(JSON.stringify(val), key);
    return true;
  } catch (e) {
    return false;
  }
}

function reply(obj, status) {
  $done({
    response: {
      status: status || 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(obj)
    }
  });
}

function validEquip(e) {
  return !!(
    e &&
    typeof e === 'object' &&
    e.package_url &&
    typeof e.package_url === 'string' &&
    /^https?:\/\//.test(e.package_url) &&
    e.data &&
    typeof e.data === 'object'
  );
}

function pathOf(url) {
  return String(url || '')
    .replace(/^[a-z]+:\/\/[^/]+/i, '')
    .split('?')[0];
}

function queryOf(url) {
  return String(url || '').split('?')[1] || '';
}

function intParam(qs, name) {
  var m = new RegExp('[?&]' + name + '=(\\d+)').exec('?' + qs);
  return m ? parseInt(m[1], 10) : 0;
}

/* ===================== 1. 通信桥 ===================== */

function handleBridge() {
  var method = String(($request && $request.method) || 'GET').toUpperCase();
  var name = pathOf($request.url).replace(/^\/x\/surge-skin\//, '');
  var qs = queryOf($request.url);

  if (method === 'OPTIONS') return reply({ code: 0 });

  if (name === 'set') {
    var body = $request.body;
    if (typeof body !== 'string' || !body) {
      return reply({ code: -1, msg: '请求体为空（检查 requires-body 与 max-size）' });
    }
    var equip;
    try {
      equip = JSON.parse(body);
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    if (!validEquip(equip)) return reply({ code: -1, msg: '配置缺少 package_url 或 data' });
    if (!writeJSON(KEY_EQUIP, equip)) return reply({ code: -1, msg: '写入失败' });
    return reply({ code: 0, data: { id: equip.id, name: equip.name } });
  }

  if (name === 'get') return reply({ code: 0, data: readJSON(KEY_EQUIP, null) });

  if (name === 'clear') {
    $persistentStore.write('', KEY_EQUIP);
    return reply({ code: 0 });
  }

  if (name === 'gallery') return reply({ code: 0, data: readJSON(KEY_GALLERY, []) });

  if (name === 'gallery/add') {
    var g;
    try {
      g = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    if (!validEquip(g)) return reply({ code: -1, msg: '配置缺少 package_url 或 data' });
    var list = readJSON(KEY_GALLERY, []);
    if (!(list instanceof Array)) list = [];
    var hit = false;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(g.id)) {
        list[i] = g;
        hit = true;
        break;
      }
    }
    if (!hit) {
      list.unshift(g);
      if (list.length > GALLERY_MAX) list = list.slice(0, GALLERY_MAX);
    }
    writeJSON(KEY_GALLERY, list);
    return reply({ code: 0, data: { count: list.length, added: !hit } });
  }

  if (name === 'gallery/remove') {
    var id = String(intParam(qs, 'id') || '');
    var cur = readJSON(KEY_GALLERY, []);
    if (!(cur instanceof Array)) cur = [];
    var next = cur.filter(function (x) {
      return String(x.id) !== id;
    });
    writeJSON(KEY_GALLERY, next);
    return reply({ code: 0, data: { count: next.length } });
  }

  /* 本页嗅探到的装扮候选；since 是页面进入时刻的毫秒时间戳 */
  if (name === 'seen') {
    var since = intParam(qs, 'since');
    var all = readJSON(KEY_SEEN, []);
    if (!(all instanceof Array)) all = [];
    var now = Date.now();
    var out = [];
    for (var k = 0; k < all.length; k++) {
      var rec = all[k];
      if (!rec || !validEquip(rec.equip)) continue;
      if (!rec.ts || now - rec.ts > SEEN_TTL) continue;
      if (since > 0 && rec.ts < since) continue;
      out.push(rec.equip);
    }
    return reply({ code: 0, data: out });
  }

  if (name === 'seen/clear') {
    $persistentStore.write('', KEY_SEEN);
    return reply({ code: 0 });
  }

  return reply({ code: 0, data: { ok: true } });
}

/* ===================== 2. 应用装扮 ===================== */

function handleApply() {
  var equip = readJSON(KEY_EQUIP, null);
  if (!validEquip(equip)) return $done({});

  var resp;
  try {
    resp = JSON.parse($response.body);
  } catch (e) {
    return $done({});
  }
  if (!resp || resp.code !== 0 || !resp.data) return $done({});

  resp.data.user_equip = equip;
  $done({ body: JSON.stringify(resp) });
}

/* ===================== 3. 注入页面脚本 ===================== */

function handleInject() {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body.length < 32) return $done({});
  if (body.indexOf('<html') < 0 && body.indexOf('<!DOCTYPE') < 0) return $done({});
  if (body.indexOf('__BSS_LOADED__') >= 0) return $done({});

  var payload = String(H5_PAYLOAD).replace(/<\/script/gi, '<\\/script');
  var tag = '<script>' + payload + '</' + 'script>';

  /* 注入到 </head> 之前：必须早于 SPA 的请求，否则首屏那批接口响应
     会早于 enterTs，被 seen 的时间过滤掉。 */
  var head = body.lastIndexOf('</head>');
  var out;
  if (head >= 0) out = body.slice(0, head) + tag + body.slice(head);
  else {
    var tail = body.lastIndexOf('</body>');
    out = tail >= 0 ? body.slice(0, tail) + tag + body.slice(tail) : body + tag;
  }
  $done({ body: out });
}

/* ===================== 4. 嗅探本页出现过的装扮 ===================== */

/* 注意：equipFrom / harvest 与 src/bili_h5.js 里的同名函数必须保持一致。
   两边运行环境隔离，没法共享代码，改动时请同步。 */

function equipFrom(container, skin) {
  var p = (skin && skin.properties) || {};
  if (!p.package_url) return null;
  var item = (container && container.item) || {};
  return {
    id: item.item_id || (skin && skin.item_id) || 0,
    name: item.name || (skin && skin.name) || '',
    preview: p.image_preview || p.image_cover || '',
    ver: Number(p.ver) || 1700000000,
    package_url: p.package_url,
    package_md5: p.package_md5 || '',
    data: {
      color_mode: p.color_mode || 'light',
      color: p.color || '#212121',
      color_second_page: p.color_second_page || '#ffffff',
      side_bg_color: p.side_bg_color || p.color_second_page || '#ffffff',
      tail_color: p.tail_color || '#996c00',
      tail_color_selected: p.tail_color_selected || '#0d6872',
      tail_icon_ani: String(p.tail_icon_ani) === 'true',
      tail_icon_ani_mode: p.tail_icon_ani_mode || 'once',
      tail_icon_mode: p.tail_icon_mode || 'img'
    }
  };
}

function harvest(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 9) return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) harvest(node[i], out, depth + 1);
    return;
  }
  if (node.suit_items && typeof node.suit_items === 'object') {
    var skins = node.suit_items.skin;
    if (Array.isArray(skins)) {
      for (var j = 0; j < skins.length; j++) {
        var e = equipFrom(node, skins[j]);
        if (e) out.push(e);
      }
    }
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    try {
      harvest(node[k], out, depth + 1);
    } catch (err) {}
  }
}

function handleSniff() {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body.indexOf('suit_items') < 0) return $done({});

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }

  var found = [];
  harvest(json, found, 0);
  if (!found.length) return $done({});

  var now = Date.now();
  var list = readJSON(KEY_SEEN, []);
  if (!(list instanceof Array)) list = [];
  list = list.filter(function (x) {
    return x && x.ts && now - x.ts <= SEEN_TTL;
  });

  for (var i = 0; i < found.length; i++) {
    var e = found[i];
    for (var j = list.length - 1; j >= 0; j--) {
      if (list[j].equip && String(list[j].equip.id) === String(e.id)) list.splice(j, 1);
    }
    list.unshift({ ts: now, equip: e });
  }
  if (list.length > SEEN_MAX) list = list.slice(0, SEEN_MAX);

  writeJSON(KEY_SEEN, list);
  $done({});
}

/* ===================== 分派 ===================== */

(function main() {
  var url = ($request && $request.url) || '';

  if (TYPE === 'http-request') return handleBridge();
  if (/\/x\/resource\/show\/skin/.test(url)) return handleApply();
  /* 装扮商城/详情/收藏集走 /h5/mall/，收藏集的「主题套装」预览页走
     /blackboard/fe/suit-preview.html（独立活动页，不在 mall 下）。 */
  if (/^https?:\/\/www\.bilibili\.com\/(?:h5\/mall\/|blackboard\/fe\/suit-preview\.html)/.test(url)) {
    return handleInject();
  }
  return handleSniff();
})();
