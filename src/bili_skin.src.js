/*
 * 哔哩哔哩装扮工作室 —— Surge 侧
 *
 * 同一个文件被多条 [Script] 引用，按 $script.type + URL 分派：
 *   1. http-request  app.bilibili.com/x/surge-skin/*        -> H5 页面与 Surge 的通信桥
 *   2. http-response app.bilibili.com/x/resource/show/skin  -> 换「个性主题」+「加载动画」
 *   3. http-response www.bilibili.com/(h5/mall|…)           -> 注入页面脚本
 *   4. http-response api.bilibili.com/x/(garb|vas)/         -> 嗅探本页出现过的装扮
 *   5. http-response api.bilibili.com/x/v2/reply/…          -> 换「评论装扮 / 头像挂件」
 *   6. http-response app.bilibili.com/x/v2/splash/…         -> 换「开屏动画」
 *
 * 一套装扮（suit）由若干组件构成，各组件注入到不同接口：
 *   skin       个性主题  -> x/resource/show/skin 的 data.user_equip
 *   loading    加载动画  -> x/resource/show/skin 的 data.load_equip
 *   card       动态卡片  -> member.user_sailing_v2.card_bg（动态/评论响应）
 *   card_bg    评论装扮  -> member.user_sailing_v2.card_bg
 *   pendant    头像挂件  -> member.user_sailing.pendant / member.pendant
 *   splash     开屏动画  -> x/v2/splash/brand/list 的 list/show
 *
 * 本文件由 scripts/build-bili.js 从 src/bili_skin.src.js 生成，请勿直接改 bili_skin.js。
 */

var KEY_EQUIP = 'BiliSkinEquip';
var KEY_GALLERY = 'BiliSkinGallery';
var KEY_SEEN = 'BiliSkinSeen';
var KEY_SELF = 'BiliSkinSelf';
var KEY_SPLASH = 'BiliSkinSplash';
var KEY_SPLASH_LIST = 'BiliSkinSplashList';
var GALLERY_MAX = 300;
var SEEN_MAX = 40;
var SEEN_TTL = 600000;
var SPLASH_MAX = 30;

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

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//.test(u);
}

/* 主题皮肤（package_url）或加载动画（loading_url）任一存在即算有效配置 */
function validEquip(e) {
  if (!e || typeof e !== 'object') return false;
  if (isHttpUrl(e.package_url)) return true;
  var c = e.components;
  if (c && typeof c === 'object') {
    if (c.skin && isHttpUrl(c.skin.package_url || c.skin.url)) return true;
    if (c.loading && isHttpUrl(c.loading.loading_url || c.loading.url)) return true;
  }
  if (e.loading_url && isHttpUrl(e.loading_url)) return true;
  return false;
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

/* ===================== 组件取值 ===================== */

/* 装扮 -> user_equip（个性主题） */
function skinOf(e) {
  if (!e || typeof e !== 'object') return null;
  var c = (e.components && e.components.skin) || null;
  var url = e.package_url || (c && (c.package_url || c.url)) || '';
  if (!isHttpUrl(url)) return null;
  return {
    id: e.id || (c && c.id) || 0,
    name: e.name || (c && c.name) || '',
    preview: e.preview || (c && (c.image_preview || c.image_cover)) || '',
    ver: Number(e.ver || (c && c.ver)) || 1700000000,
    package_url: url,
    package_md5: e.package_md5 || (c && c.package_md5) || '',
    data: e.data || {}
  };
}

/* 装扮 -> load_equip（加载动画） */
function loadingOf(e) {
  var c = e && e.components && e.components.loading;
  if (!c) {
    if (e && isHttpUrl(e.loading_url)) {
      return { id: e.id || 0, name: e.name || '', ver: Number(e.ver) || 1700000000, loading_url: e.loading_url };
    }
    return null;
  }
  var url = c.loading_url || c.url;
  if (!isHttpUrl(url)) return null;
  return {
    id: c.id || 0,
    name: c.name || (e && e.name) || '',
    ver: Number(c.ver) || 1700000000,
    loading_url: url
  };
}

/* 装扮 -> 卡片（动态卡片 / 评论装扮） */
function cardOf(e) {
  var c = e && e.components;
  var it = (c && (c.card_bg || c.card)) || null;
  if (!it) return null;
  var img = it.image || it.url || '';
  if (!isHttpUrl(img)) return null;
  return { id: it.id || 0, name: it.name || (e && e.name) || '', image: img };
}

/* 装扮 -> 头像挂件 */
function pendantOf(e) {
  var c = e && e.components && e.components.pendant;
  if (!c) return null;
  var img = c.image || c.url || '';
  if (!isHttpUrl(img)) return null;
  return { id: c.id || 0, name: c.name || (e && e.name) || '', image: img };
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
    if (!validEquip(equip)) return reply({ code: -1, msg: '配置缺少装扮包或加载动画' });
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
    if (!validEquip(g)) return reply({ code: -1, msg: '配置缺少装扮包或加载动画' });
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

  /* H5 页面把当前登录 mid 报上来，评论装扮只改自己的 */
  if (name === 'selfmid') {
    var m;
    try {
      m = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    var mid = m && m.mid != null ? String(m.mid) : '';
    if (!mid) return reply({ code: -1, msg: '缺少 mid' });
    writeJSON(KEY_SELF, { mid: mid });
    return reply({ code: 0, data: { mid: mid } });
  }

  /* 开屏动画：嗅探到的候选列表 */
  if (name === 'splash/list') return reply({ code: 0, data: readJSON(KEY_SPLASH_LIST, []) });
  if (name === 'splash') return reply({ code: 0, data: readJSON(KEY_SPLASH, null) });
  if (name === 'splash/set') {
    var sp;
    try {
      sp = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    if (!sp || !isHttpUrl(sp.thumb)) return reply({ code: -1, msg: '缺少 thumb' });
    writeJSON(KEY_SPLASH, sp);
    return reply({ code: 0, data: { id: sp.id } });
  }
  if (name === 'splash/clear') {
    $persistentStore.write('', KEY_SPLASH);
    return reply({ code: 0 });
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

/* ===================== 2. 应用主题 + 加载动画 ===================== */

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

  var changed = false;

  var skin = skinOf(equip);
  if (skin) {
    resp.data.user_equip = skin;
    changed = true;
  }

  /* 加载动画：原响应没有 load_equip 字段时也补上，App 会照着去下载 */
  var loading = loadingOf(equip);
  if (loading) {
    resp.data.load_equip = loading;
    changed = true;
  }

  if (!changed) return $done({});
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

var COMPONENTS = [
  'skin',
  'loading',
  'card',
  'card_bg',
  'thumbup',
  'play_icon',
  'space_bg',
  'emoji_package'
];

function skinData(p) {
  p = p || {};
  return {
    color_mode: p.color_mode || 'light',
    color: p.color || '#212121',
    color_second_page: p.color_second_page || '#ffffff',
    side_bg_color: p.side_bg_color || p.color_second_page || '#ffffff',
    tail_color: p.tail_color || '#996c00',
    tail_color_selected: p.tail_color_selected || '#0d6872',
    tail_icon_ani: String(p.tail_icon_ani) === 'true',
    tail_icon_ani_mode: p.tail_icon_ani_mode || 'once',
    tail_icon_mode: p.tail_icon_mode || 'img'
  };
}

function componentOf(kind, entry) {
  if (!entry || typeof entry !== 'object') return null;
  var p = entry.properties || {};
  var out = { kind: kind, id: entry.item_id || 0, name: entry.name || '' };
  for (var k in p) {
    if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
  }
  if (kind === 'loading') {
    out.url = p.loading_url || '';
    out.frame_url = p.loading_frame_url || '';
  } else if (kind === 'skin') {
    out.url = p.package_url || '';
    out.md5 = p.package_md5 || '';
  } else if (kind === 'space_bg') {
    out.url = p.image1_portrait || p.image1_landscape || p.image || '';
  } else {
    out.url = p.image || p.image_ani || p.static_icon_image || p.image_preview || p.preview || '';
  }
  return out;
}

function equipFrom(container, skin) {
  var p = (skin && skin.properties) || {};
  if (!p.package_url) return null;
  var item = (container && container.item) || {};
  var equip = {
    id: item.item_id || (container && container.item_id) || (skin && skin.item_id) || 0,
    name: item.name || (container && container.name) || (skin && skin.name) || '',
    preview: p.image_preview || p.image_cover || '',
    ver: Number(p.ver) || 1700000000,
    package_url: p.package_url,
    package_md5: p.package_md5 || '',
    data: skinData(p),
    components: {}
  };
  var si = (container && container.suit_items) || null;
  if (si && typeof si === 'object') {
    for (var i = 0; i < COMPONENTS.length; i++) {
      var kind = COMPONENTS[i];
      var arr = si[kind];
      var c = componentOf(kind, arr instanceof Array ? arr[0] : arr);
      if (c) equip.components[kind] = c;
    }
  }
  if (!equip.components.skin) equip.components.skin = componentOf('skin', skin);
  return equip;
}

function harvest(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 9) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) harvest(node[i], out, depth + 1);
    return;
  }
  if (node.suit_items && typeof node.suit_items === 'object') {
    var skins = node.suit_items.skin;
    if (skins instanceof Array) {
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
  if (typeof body !== 'string') return $done({});
  if (body.indexOf('suit_items') < 0) return $done({});

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

/* ===================== 5. 评论装扮 / 头像挂件 ===================== */

/* 只改「当前登录用户自己」的 member 节点，别人的不动。
   selfMid 由 H5 页面通过桥上报；拿不到就不改，避免全站串味。 */
function rewriteMember(m, selfMid, card, pendant) {
  if (!m || typeof m !== 'object') return 0;
  var mid = m.mid != null ? String(m.mid) : m.mid_str != null ? String(m.mid_str) : '';
  if (!selfMid || !mid || mid !== selfMid) return 0;

  var n = 0;
  var sailing = m.user_sailing;
  if (sailing && typeof sailing === 'object') {
    if (pendant && sailing.pendant) {
      sailing.pendant = mergePendant(sailing.pendant, pendant);
      n++;
    }
    if (card && sailing.card_bg) {
      sailing.card_bg = mergeCard(sailing.card_bg, card);
      n++;
    }
  }
  var sailing2 = m.user_sailing_v2;
  if (sailing2 && typeof sailing2 === 'object') {
    if (card && sailing2.card_bg) {
      sailing2.card_bg = mergeCard(sailing2.card_bg, card);
      n++;
    }
    if (card && sailing2.card_bg_with_focus) {
      sailing2.card_bg_with_focus = mergeCard(sailing2.card_bg_with_focus, card);
      n++;
    }
  }
  if (pendant && m.pendant && typeof m.pendant === 'object') {
    m.pendant = mergePendant(m.pendant, pendant);
    n++;
  }
  return n;
}

/* 保留原对象结构，只把图/名/id 换掉 */
function mergeCard(orig, card) {
  if (typeof orig === 'string') return card.image;
  var out = {};
  if (orig && typeof orig === 'object') {
    for (var k in orig) {
      if (Object.prototype.hasOwnProperty.call(orig, k)) out[k] = orig[k];
    }
  }
  out.image = card.image;
  if (card.id) out.id = card.id;
  if (card.name) out.name = card.name;
  return out;
}

function mergePendant(orig, pendant) {
  if (typeof orig === 'string') return pendant.image;
  var out = {};
  if (orig && typeof orig === 'object') {
    for (var k in orig) {
      if (Object.prototype.hasOwnProperty.call(orig, k)) out[k] = orig[k];
    }
  }
  out.image = pendant.image;
  if (pendant.id) out.pid = pendant.id;
  if (pendant.name) out.name = pendant.name;
  return out;
}

/* 在任意嵌套结构里找出所有 member 节点并改写 */
function walkMembers(node, selfMid, card, pendant, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return 0;
  var n = 0;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) {
      n += walkMembers(node[i], selfMid, card, pendant, depth + 1);
    }
    return n;
  }
  n += rewriteMember(node, selfMid, card, pendant);
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    if (k === 'member' && node[k] && typeof node[k] === 'object') {
      n += rewriteMember(node[k], selfMid, card, pendant);
    }
    try {
      n += walkMembers(node[k], selfMid, card, pendant, depth + 1);
    } catch (e) {}
  }
  return n;
}

function handleCard() {
  var equip = readJSON(KEY_EQUIP, null);
  if (!validEquip(equip)) return $done({});

  var card = cardOf(equip);
  var pendant = pendantOf(equip);
  if (!card && !pendant) return $done({});

  var self = readJSON(KEY_SELF, null);
  var selfMid = self && self.mid ? String(self.mid) : '';
  if (!selfMid) return $done({}); /* 不知道是谁就不动，避免全站串味 */

  var body = $response && $response.body;
  if (typeof body !== 'string' || body.indexOf('user_sailing') < 0) return $done({});

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }

  if (!walkMembers(json, selfMid, card, pendant, 0)) return $done({});
  $done({ body: JSON.stringify(json) });
}

/* ===================== 6. 开屏动画 ===================== */

/* 开屏图片列表（x/v2/splash/brand/list）既是候选来源，也是注入点：
   1. 把服务端下发的开屏图存下来，供 H5 页面挑选；
   2. 把选中的开屏图插到 list/show 最前面，App 启动时会拉这张图。 */
function handleSplash() {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body.indexOf('pull_interval') < 0) return $done({});

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }
  if (!json || json.code !== 0 || !json.data) return $done({});

  var changed = false;

  var list = json.data.list;
  if (list instanceof Array && list.length) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      if (!isHttpUrl(it.thumb)) continue;
      out.push({ id: it.id, thumb: it.thumb, logo_url: it.logo_url || '' });
    }
    if (out.length) {
      if (out.length > SPLASH_MAX) out = out.slice(0, SPLASH_MAX);
      writeJSON(KEY_SPLASH_LIST, out);
    }
  }

  var splash = readJSON(KEY_SPLASH, null);
  if (splash && isHttpUrl(splash.thumb)) {
    if (!(json.data.list instanceof Array)) json.data.list = [];
    if (!(json.data.show instanceof Array)) json.data.show = [];
    var id = Number(splash.id) || 900000001;
    json.data.list.unshift({ id: id, thumb: splash.thumb, logo_url: splash.logo_url || '' });
    json.data.show.unshift({
      id: id,
      begin_time: 0,
      end_time: 0,
      probability: 0,
      duration: Number(splash.duration) || 3000
    });
    changed = true;
  }

  if (!changed) return $done({});
  $done({ body: JSON.stringify(json) });
}

/* ===================== 分派 ===================== */

(function main() {
  var url = ($request && $request.url) || '';

  if (TYPE === 'http-request') return handleBridge();
  if (/\/x\/resource\/show\/skin/.test(url)) return handleApply();
  /* 装扮商城/详情/收藏集走 /h5/mall/，收藏集的「主题套装」预览页走
     /blackboard/fe/suit-preview.html（独立活动页，不在 mall 下），
     收藏集大厅走 /garb/collection-hall/。 */
  if (
    /^https?:\/\/www\.bilibili\.com\/(?:h5\/mall\/|blackboard\/fe\/suit-preview\.html|garb\/collection-hall)/.test(
      url
    )
  ) {
    return handleInject();
  }
  /* 评论 / 动态：换自己的评论装扮与头像挂件 */
  if (/\/x\/v2\/reply/.test(url) || /\/x\/dynamic\//.test(url)) return handleCard();
  /* 开屏动画 */
  if (/\/x\/v2\/splash\//.test(url)) return handleSplash();
  return handleSniff();
})();
