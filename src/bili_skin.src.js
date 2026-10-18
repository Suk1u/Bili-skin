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
 *   pendant    头像挂件  -> member.user_sailing.pendant / member.pendant / 我的页 pendantUrl
 *   splash     开屏动画  -> x/v2/splash/brand/list 的 list/show
 *
 * ⚠️ 头像挂件（pendant）不在 suit_items 里 —— 对 60 套在售装扮实测，
 *    suit_items 的键只有 skin/loading/card/card_bg/thumbup/play_icon/space_bg/emoji_package。
 *    挂件是**独立资产**：收藏集兑换物（redeem_item_type_name = 头像挂件）、
 *    x/garb/user/pendant/list、x/garb/user/asset/list 才会出现。
 *    所以 handleCandidates 会把这些来源单独抓成「只有某个组件」的候选。
 *
 * 本文件由 scripts/build-bili.js 从 src/bili_skin.src.js 生成，请勿直接改 bili_skin.js。
 */

var KEY_EQUIP = 'BiliSkinEquip';
var KEY_GALLERY = 'BiliSkinGallery';
var KEY_SEEN = 'BiliSkinSeen';
var KEY_FOUND = 'BiliSkinFound';
var KEY_SELF = 'BiliSkinSelf';
var KEY_SPLASH = 'BiliSkinSplash';
var KEY_SPLASH_LIST = 'BiliSkinSplashList';
var KEY_CHRONOS = 'BiliSkinChronos';
var KEY_CHRONOS_LIST = 'BiliSkinChronosList';
var KEY_PREFS = 'BiliSkinPrefs';
var KEY_EQUIPS = 'BiliSkinEquips';
var KEY_REMINDERS = 'BiliSkinReminders';
var KEY_APILOG = 'BiliSkinApiLog';
var GALLERY_MAX = 300;
var SEEN_MAX = 60;
var SEEN_TTL = 1800000; /* 30 分钟：在 App 里逛完收藏集再回面板也还看得到 */
var FOUND_MAX = 80; /* 持久候选（收藏集 / 资产列表抓到的），7 天有效 */
var FOUND_TTL = 604800000;
var SPLASH_MAX = 30;

/* 默认设置项。H5 侧可以改，改完存 KEY_PREFS。 */
var DEFAULT_PREFS = {
  allMembers: false, /* 评论装扮是否连别人的一起改（默认只改自己） */
  notify: true, /* 应用成功发系统通知 */
  autoScan: false, /* 进页面自动扫描 */
  lang: 'zh', /* 面板语言 */
  splashKeepVideo: false, /* 活动开屏是否保留视频通道 */
  splashScratch: -1, /* 活动开屏刮擦比例，-1 = 不动 */
  grpcAll: false /* gRPC 兜底模式：schema 不匹配时把所有 garb 图地址都换掉 */
};

function readPrefs() {
  var p = readJSON(KEY_PREFS, null);
  if (!p || typeof p !== 'object') p = {};
  for (var k in DEFAULT_PREFS) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, k) && p[k] === undefined) {
      p[k] = DEFAULT_PREFS[k];
    }
  }
  return p;
}

/* 字段别名：App 改字段名时只改这里，不用动逻辑。
   键 = 规范名，值 = 该字段可能出现的所有写法。 */
var FIELD_ALIAS = {
  package_url: ['package_url', 'packageUrl', 'url_package'],
  package_md5: ['package_md5', 'packageMd5', 'md5_package'],
  loading_url: ['loading_url', 'loadingUrl'],
  image_ani: ['image_ani', 'imageAni'],
  image_ani_cut: ['image_ani_cut', 'url_image_ani_cut', 'imageAniCut'],
  static_icon_image: ['static_icon_image', 'staticIconImage'],
  drag_left_png: ['drag_left_png', 'dragLeftPng'],
  drag_right_png: ['drag_right_png', 'dragRightPng'],
  middle_png: ['middle_png', 'middlePng'],
  image_enhance: ['image_enhance', 'imageEnhance'],
  image_enhance_frame: ['image_enhance_frame', 'imageEnhanceFrame'],
  card_bg_with_focus: ['card_bg_with_focus', 'cardBgWithFocus'],
  /* 头像挂件：我的页 HeaderViewModel 叫 pendantUrl；挂件对象里叫 image / image_enhance；
     直播那套叫 pendant_pic / pendantImageEnhance。全列上，App 改名只改这张表。 */
  pendant: ['image', 'url', 'image_enhance', 'pendant_pic', 'pendant_image', 'pendantImage']
};

/* 字段名 -> 装扮组件。凡是响应里出现这些字段，就把地址换成对应组件的图。
   这样不依赖响应结构——App 把字段放哪一层都能命中。 */
var FIELD_COMPONENT = {
  /* 空间海报（实测 properties 里到 image9 都有，早期版本只列到 7） */
  image1_portrait: 'space_bg',
  image1_landscape: 'space_bg',
  image2_portrait: 'space_bg',
  image2_landscape: 'space_bg',
  image3_portrait: 'space_bg',
  image3_landscape: 'space_bg',
  image4_portrait: 'space_bg',
  image4_landscape: 'space_bg',
  image5_portrait: 'space_bg',
  image5_landscape: 'space_bg',
  image6_portrait: 'space_bg',
  image6_landscape: 'space_bg',
  image7_portrait: 'space_bg',
  image7_landscape: 'space_bg',
  image8_portrait: 'space_bg',
  image8_landscape: 'space_bg',
  image9_portrait: 'space_bg',
  image9_landscape: 'space_bg',
  fan_no_image: 'space_bg',
  /* 点赞特效 */
  image_ani: 'thumbup',
  image_ani_cut: 'thumbup',
  url_image_ani_cut: 'thumbup',
  /* 播放器进度条 */
  static_icon_image: 'play_icon',
  drag_left_png: 'play_icon',
  drag_right_png: 'play_icon',
  middle_png: 'play_icon',
  squared_image: 'play_icon',
  /* 挂件动态形态 */
  image_enhance: 'pendant',
  image_enhance_frame: 'pendant',
  /* 加载动画：除了 x/resource/show/skin 的 load_equip，
     空间页 / 我的页 / 资产列表里也会出现 loading_url —— 一律换掉。
     （旧版只有 load_equip 一条路，所以加载动画只在视频页下拉刷新里出现。） */
  loading_url: 'loading',
  loadingUrl: 'loading',
  /* 头像挂件（扁平字符串字段）：
     「我的」页 x/v2/account/mine 的 HeaderViewModel 用 pendantUrl */
  pendant_url: 'pendant',
  pendantUrl: 'pendant',
  pendant_image: 'pendant',
  pendantImage: 'pendant',
  pendant_pic: 'pendant',
  pendantImageEnhance: 'pendant',
  pendantEnhance: 'pendant',
  pendantBgImageUrl: 'pendant',
  /* 卡片聚焦态 */
  card_bg_with_focus: 'card'
};

/* 对象字段：命中后把「对象里的图片字段」换掉。
   空间页 / 我的页的挂件、卡片是对象（{image, image_enhance, name, pid...}），
   不是扁平字符串，所以上面那张表命中不了，得单独处理。 */
var FIELD_OBJECT = {
  pendant: 'pendant',
  user_pendant: 'pendant',
  userPendant: 'pendant',
  fans_pendant: 'pendant',
  fansPendant: 'pendant',
  avatar_pendant: 'pendant',
  card_bg: 'card_bg',
  cardBg: 'card_bg',
  card_bg_with_focus: 'card',
  cardBgWithFocus: 'card',
  space_bg: 'space_bg',
  spaceBg: 'space_bg'
};

/* 由构建脚本内联的 H5 页面脚本 */
var H5_PAYLOAD = __H5_PAYLOAD__;
var DELISTED_SKINS = __DELISTED_SKINS__;

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

/* 主题皮肤（package_url）或加载动画（loading_url）任一存在即算有效配置。
   收藏集 / 资产列表抓到的「单组件」候选（只有头像挂件、只有评论装扮…）没有
   package_url，所以这里也认「任意组件带图」的形态。 */
function validEquip(e) {
  if (!e || typeof e !== 'object') return false;
  if (isHttpUrl(e.package_url)) return true;
  if (isHttpUrl(e.loading_url)) return true;
  if (e.needResolve && (e.id || isHttpUrl(e.preview))) return true;
  var c = e.components;
  if (c && typeof c === 'object') {
    if (c.skin && isHttpUrl(c.skin.package_url || c.skin.url)) return true;
    if (c.loading && isHttpUrl(c.loading.loading_url || c.loading.url)) return true;
    for (var k in c) {
      if (!Object.prototype.hasOwnProperty.call(c, k)) continue;
      var v = c[k];
      if (!v || typeof v !== 'object') continue;
      if (isHttpUrl(v.url) || isHttpUrl(v.image) || isHttpUrl(v.package_url) || isHttpUrl(v.loading_url)) {
        return true;
      }
    }
  }
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

/* 这些接口的响应结构还没完全解出（开屏 / 空间 / 我的页 / 收藏集 / 资产），
   记下 URL + 响应样本，方便从 H5 面板导出定位。范围尽量宽，
   因为「为什么没生效」往往就差一条响应没看到。 */
function shouldLogApi(url) {
  return /\/x\/(?:v2\/splash|v2\/space|v2\/account\/mine|member\/app\/pendant|vas\/dlc_act|vas\/digital|garb\/user|garb\/skin|garb\/right|garb\/digital|garb\/mall|chronos|resource\/show\/skin)/.test(
    url
  );
}

function logApi(url, body) {
  try {
    var p = pathOf(url);
    if (!p) return;
    var list = readJSON(KEY_APILOG, []);
    if (!(list instanceof Array)) list = [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].path === p) list.splice(i, 1);
    }
    var s = typeof body === 'string' ? body : '';
    list.unshift({
      ts: Date.now(),
      path: p,
      q: queryOf(url).slice(0, 200),
      len: s.length,
      sample: s.length > 3000 ? s.slice(0, 3000) : s
    });
    if (list.length > 40) list = list.slice(0, 40);
    writeJSON(KEY_APILOG, list);
  } catch (e) {}
}

function intParam(qs, name) {
  var m = new RegExp('[?&]' + name + '=(\\d+)').exec('?' + qs);
  return m ? parseInt(m[1], 10) : 0;
}

/* ---------- MD5 ----------
   活动开屏会校验图片 md5（BFCEventSplashPreloader downloadWithURL:hashValue:），
   Surge 没有内置摘要，这里带一份精简实现（Joseph Myers 公有领域版改写）。
   输入 Uint8Array，输出 32 位小写 hex。 */
function md5(bytes) {
  function add32(a, b) {
    return (a + b) & 0xffffffff;
  }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  var n = bytes.length;
  var x = [];
  var i;
  for (i = 0; i < n; i++) {
    x[i >> 2] = (x[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
  }
  x[n >> 2] = (x[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
  var words = (((n + 8) >> 6) + 1) * 16;
  for (i = 0; i < words; i++) if (x[i] === undefined) x[i] = 0;
  x[words - 2] = (n * 8) & 0xffffffff;
  x[words - 1] = 0;

  var a = 0x67452301,
    b = 0xefcdab89,
    c = 0x98badcfe,
    d = 0x10325476;

  for (i = 0; i < x.length; i += 16) {
    var oa = a,
      ob = b,
      oc = c,
      od = d;
    a = ff(a, b, c, d, x[i], 7, -680876936);
    d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063);
    b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

    a = gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = gg(b, c, d, a, x[i], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

    a = hh(a, b, c, d, x[i + 5], 4, -378558);
    d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = hh(d, a, b, c, x[i], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = hh(b, c, d, a, x[i + 2], 23, -995338651);

    a = ii(a, b, c, d, x[i], 6, -198630844);
    d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = ii(b, c, d, a, x[i + 9], 21, -343485551);

    a = add32(a, oa);
    b = add32(b, ob);
    c = add32(c, oc);
    d = add32(d, od);
  }

  function hex(v) {
    var s = '';
    for (var k = 0; k < 4; k++) {
      var byte = (v >>> (k * 8)) & 0xff;
      s += (byte < 16 ? '0' : '') + byte.toString(16);
    }
    return s;
  }
  return hex(a) + hex(b) + hex(c) + hex(d);
}

function toBytes(data) {
  if (!data) return null;
  if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Array) return new Uint8Array(data);
  if (typeof data === 'string') {
    var out = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
    return out;
  }
  return null;
}

/* 开屏图需要 md5 时，把图拉下来算一遍再存。失败就原样存（md5 空）。 */
function ensureSplashMd5(sp, cb) {
  if (sp.md5) return cb(sp);
  if (typeof $httpClient === 'undefined' || !$httpClient.get) return cb(sp);
  try {
    $httpClient.get({ url: sp.thumb, 'binary-mode': true, timeout: 20 }, function (err, resp, data) {
      if (err) return cb(sp);
      var bytes = toBytes(data);
      if (!bytes || !bytes.length) return cb(sp);
      try {
        sp.md5 = md5(bytes);
      } catch (e) {}
      cb(sp);
    });
  } catch (e) {
    cb(sp);
  }
}

/* ===================== 组件取值 ===================== */

function isDarkMode(reqUrl, reqHeaders) {
  var u = String(reqUrl || '');
  if (/[?&](?:night|dark)=1\b/.test(u)) return true;
  if (/[?&]native\.theme=2\b/.test(u)) return true;
  var ua = '';
  if (reqHeaders) {
    for (var k in reqHeaders) {
      if (/^user-agent$/i.test(k)) {
        ua = String(reqHeaders[k]);
        break;
      }
    }
  }
  if (/themeId\/2\b/.test(ua)) return true;
  return false;
}

/* 装扮 -> user_equip（个性主题） */
function skinOf(e, dark) {
  if (!e || typeof e !== 'object') return null;
  var c = (e.components && e.components.skin) || null;
  var url = e.package_url || (c && (c.package_url || c.url)) || '';
  var md5 = e.package_md5 || (c && c.package_md5) || '';

  var isTheme = isHttpUrl(url) || (c && (c.id || c.preview)) || e.video_url || (e.typeName && e.typeName.indexOf('主题') >= 0);
  if (!isTheme) return null;

  var isDark = dark || (e.data && e.data.color_mode === 'dark');

  /* 若是主题但没有自带装扮包（如收藏集提取的主题），回退到官方基底包，确保客户端能正常渲染 */
  if (!isHttpUrl(url)) {
    if (isDark) {
      url = 'https://i0.hdslb.com/bfs/garb/zip/14e2f377e601481e2befab34e0773c81886b7232.zip';
      md5 = 'e10f4ff37f3d964c6ecb3f8f2c8434c9';
    } else {
      url = 'https://i0.hdslb.com/bfs/garb/zip/bbd834e1f783cef686569ff3cf94bdc3bc57f9e8.zip';
      md5 = 'b251980ad26b33b8c4a0a64049b14daf';
    }
  }

  var sdata = skinData(e.data || {}, isDark);
  var img = e.preview || (c && (c.image_preview || c.image_cover)) || e.image || '';
  if (img) {
    if (!sdata.head_myself_squared_bg) sdata.head_myself_squared_bg = img;
    if (!sdata.head_myself_bg) sdata.head_myself_bg = img;
    if (!sdata.head_bg) sdata.head_bg = img;
  }
  if (e.video_url) {
    sdata.head_myself_mp4_bg = e.video_url;
    sdata.head_myself_mp4_play = 'loop';
  }

  return {
    id: e.id || (c && c.id) || 0,
    name: e.name || (c && c.name) || '',
    preview: img,
    ver: Number(e.ver || (c && c.ver)) || 1700000000,
    package_url: url,
    package_md5: md5,
    data: sdata
  };
}

/* 装扮 -> load_equip（加载动画） */
function loadingOf(e) {
  var c = e && e.components && e.components.loading;
  if (!c) {
    if (e && isHttpUrl(e.loading_url)) {
      return {
        id: e.id || 0,
        name: e.name || '',
        ver: Number(e.ver) || 1700000000,
        loading_url: e.loading_url,
        loading_frame_url: e.loading_frame_url || ''
      };
    }
    return null;
  }
  var url = c.loading_url || c.url;
  if (!isHttpUrl(url)) return null;
  return {
    id: c.id || 0,
    name: c.name || (e && e.name) || '',
    ver: Number(c.ver) || 1700000000,
    loading_url: url,
    loading_frame_url: c.loading_frame_url || c.frame_url || ''
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
  /* 动态形态（image_enhance）单独带出来：App 优先画它，
     不一起换掉的话静态图会被旧的动态形态盖住（实机上像「两层」）。 */
  var enh = c.image_enhance || c.imageEnhance || c.enhance || '';
  return {
    id: c.id || 0,
    name: c.name || (e && e.name) || '',
    image: img,
    image_enhance: isHttpUrl(enh) ? enh : ''
  };
}

/* 装扮 -> 各组件要用的图。给「按字段名换图」的通用改写用。 */
function compsOf(e) {
  var c = (e && e.components) || {};
  var out = {};
  function pick(kind, url) {
    if (isHttpUrl(url) && !out[kind]) out[kind] = url;
  }
  var skin = c.skin || {};
  var loading = c.loading || {};
  var card = c.card || {};
  var cardbg = c.card_bg || {};
  var pend = c.pendant || {};
  var thumb = c.thumbup || {};
  var play = c.play_icon || {};
  var space = c.space_bg || {};

  pick('skin', e.package_url || skin.package_url || skin.url);
  pick('loading', loading.loading_url || loading.url || e.loading_url);
  pick('card', card.image || card.url || cardbg.image);
  pick('card_bg', cardbg.image || cardbg.url || card.image);
  /* 挂件：静态图优先，拿不到就退到动态形态那张 */
  pick('pendant', pend.image || pend.url || pend.image_enhance || pend.imageEnhance);
  pick('pendant', pend.enhance);
  pick('thumbup', thumb.image_ani || thumb.image_ani_cut || thumb.url);
  pick('play_icon', play.static_icon_image || play.url || play.middle_png);
  pick('space_bg', space.url || space.image1_portrait || space.image1_landscape);
  if (isHttpUrl(pend.image_enhance)) out.pendant = out.pendant || pend.image_enhance;
  if (pend.id) out.pendant_id = Number(pend.id) || 1;
  return out;
}

/* 递归扫一遍，凡是字段名命中 FIELD_COMPONENT、值是 URL，就换成对应组件的图。
   不依赖响应结构——只看字段名，所以 App 把字段放哪一层都能命中。 */
function rewriteByField(node, comps, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return 0;
  var n = 0;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) n += rewriteByField(node[i], comps, depth + 1);
    return n;
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    var kind = FIELD_COMPONENT[k];
    if (
      kind &&
      typeof v === 'string' &&
      /^https?:\/\//.test(v) &&
      comps[kind] &&
      v !== comps[kind]
    ) {
      node[k] = comps[kind];
      n++;
      continue;
    }
    if (v && typeof v === 'object') n += rewriteByField(v, comps, depth + 1);
  }
  return n;
}

/* 只按字段名命中就换图 —— 用在空间装扮、收藏集开屏这类「结构不明」的响应上。 */
/* 递归换图：字符串字段（FIELD_COMPONENT）+ 对象字段（FIELD_OBJECT）。
   只用于「一定/大概率是自己的数据」的页面（空间主页 / 我的页 / 数字藏品）。 */
function rewriteProfile(node, comps, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return 0;
  var n = 0;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) n += rewriteProfile(node[i], comps, depth + 1);
    return n;
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];

    /* 1) 扁平字符串字段：值是 URL 就直接换；挂件/loading等字段即便当前为空字符串也注入 */
    var kind = FIELD_COMPONENT[k];
    if (kind && comps[kind]) {
      var target = comps[kind];
      if (typeof v === 'string') {
        if (v !== target && (/^https?:\/\//.test(v) || v === '' || (kind === 'pendant' && /pendant/i.test(k)))) {
          node[k] = target;
          n++;
          continue;
        }
      }
    }

    /* 2) 对象字段（挂件 / 卡片 / 空间背景）：先把里面按字段名换一遍 */
    var okind = FIELD_OBJECT[k];
    if (okind && v && typeof v === 'object' && !(v instanceof Array) && comps[okind]) {
      var sub = rewriteProfile(v, comps, depth + 1);
      if (sub) {
        n += sub;
      }
      if (okind === 'pendant') {
        var pendImg = comps.pendant;
        if (v.image !== pendImg) {
          v.image = pendImg;
          n++;
        }
        if (v.image_enhance !== pendImg) {
          v.image_enhance = pendImg;
          n++;
        }
        if (!v.pid || v.pid === 0) {
          v.pid = (comps.pendant_id) || 1;
          n++;
        }
        continue;
      }
      /* 里面没有可识别的字段名：直接换对象的图片字段 */
      var img = comps[okind];
      var imgKeys = ['image', 'url'];
      for (var q = 0; q < imgKeys.length; q++) {
        var ik = imgKeys[q];
        if (typeof v[ik] === 'string' && (/^https?:\/\//.test(v[ik]) || v[ik] === '') && v[ik] !== img) {
          v[ik] = img;
          n++;
          break;
        }
      }
      continue;
    }

    if (v && typeof v === 'object') n += rewriteProfile(v, comps, depth + 1);
  }
  return n;
}

/* 从 space / mine 响应里取「这个页面的主人」的 mid */
function pickOwnerMid(json) {
  var d = json && json.data;
  if (!d || typeof d !== 'object') return '';
  var cands = [d.mid, d.uid];
  var c = d.card;
  if (c && typeof c === 'object') cands.push(c.mid, c.mid_str, c.uid);
  for (var i = 0; i < cands.length; i++) {
    var x = cands[i];
    if (x != null && String(x) !== '' && String(x) !== '0') return String(x);
  }
  return '';
}

/* 这些接口只可能返回「自己」的数据 */
var MINE_RE = /\/x\/(?:v2\/account\/mine|v2\/account\/myinfo|member\/app\/pendant|garb\/user|garb\/v3\/user|garb\/skin|garb\/mall_v2\/mine)/;
/* 需要「按字段名换图」的接口：空间主页 / 我的页 / 数字藏品 / 我的装扮设置 */
var PROFILE_RE = /\/x\/(?:v2\/space|v2\/account\/mine|v2\/account\/myinfo|space\/myinfo|member\/app\/pendant|vas\/digital|garb\/skin)/;

/* 空间主页 / 我的页 / 数字藏品 / 我的装扮：换自己的挂件、空间海报、卡片。
   「我的」页一定是自己；space 页用响应里的 mid（或 URL 上的 mid/vmid）判断，
   避免改到别人。返回 true 表示响应被改过（调用方负责 $done）。 */
function rewriteProfileBody(url, json) {
  var equip = readJSON(KEY_EQUIP, null);
  if (!validEquip(equip)) return false;
  var comps = compsOf(equip);
  if (!comps) return false;

  var isMine = MINE_RE.test(url);

  /* 「我的」页一定是自己：顺手把 mid 学下来，之后 space 页才知道该改谁 */
  var ownerMid = pickOwnerMid(json);
  if (isMine && ownerMid) {
    var cur = readJSON(KEY_SELF, null);
    if (!cur || String(cur.mid) !== ownerMid) writeJSON(KEY_SELF, { mid: ownerMid });
  }

  /* 不是「我的」页：知道自己的 mid 时才做归属校验；
     不知道 mid 就放行（不然「我的」空间会看起来完全没装扮）。
     mid 由「我的」页 / H5 面板上报，正常用一次就学到了。 */
  if (!isMine) {
    var self = readJSON(KEY_SELF, null);
    var selfMid = self && self.mid ? String(self.mid) : '';
    var qMid = '';
    var qm = /[?&](?:vmid|mid)=(\d+)/.exec('?' + queryOf(url));
    if (qm) qMid = qm[1];
    var who = ownerMid || qMid;
    if (selfMid && who && who !== selfMid) return false;
  }

  var n = rewriteProfile(json, comps, 0);
  if (isMine && json.data) {
    if (rewriteMineData(json.data, comps, equip)) n++;
  }
  return n > 0;
}

/* 适配新版 B站客户端 Layered Avatar（复合头像挂件图层） */
function injectAvatarPendantLayer(avatar, pendantUrl) {
  if (!avatar || typeof avatar !== 'object' || !pendantUrl) return false;
  var targetGroups = [avatar.layers, avatar.fallback_layers];
  var injected = false;
  for (var g = 0; g < targetGroups.length; g++) {
    var group = targetGroups[g];
    if (!group) continue;
    var list = Array.isArray(group) ? group : [group];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || !Array.isArray(item.layers)) continue;
      var sublayers = item.layers;
      var found = false;
      for (var j = 0; j < sublayers.length; j++) {
        var l = sublayers[j];
        if (l && l.layer_config && l.layer_config.tags && (l.layer_config.tags.PENDANT_LAYER || l.layer_config.tags.PENDANT)) {
          if (l.resource && l.resource.res_image && l.resource.res_image.image_src && l.resource.res_image.image_src.remote) {
            l.resource.res_image.image_src.remote.url = pendantUrl;
            found = true;
            injected = true;
          }
        }
      }
      if (!found) {
        sublayers.push({
          visible: true,
          general_spec: {
            pos_spec: { coordinate_pos: 2, axis_x: 0.675, axis_y: 0.675 },
            size_spec: { width: 1.35, height: 1.35 },
            render_spec: { opacity: 1 }
          },
          layer_config: {
            tags: { PENDANT_LAYER: {} },
            is_critical: false
          },
          resource: {
            res_type: 3,
            res_image: {
              image_src: {
                src_type: 1,
                placeholder: 0,
                remote: {
                  url: pendantUrl,
                  bfs_style: 'widget-layer-avatar'
                }
              }
            }
          }
        });
        injected = true;
      }
    }
  }
  return injected;
}

/* 「我的」主页顶栏装扮与挂件字段增强 */
function rewriteMineData(data, comps, equip) {
  if (!data || typeof data !== 'object') return false;
  var changed = false;
  /* 顶栏背景只认「真的是背景图」的来源：空间海报 / 卡片组件，
     或者整套主题自带的封面。
     收藏集抓到的单组件候选（只有头像挂件）的 preview 就是挂件那张小图，
     以前拿它当 header_bg，会把「我的」页顶栏糊成一张挂件。 */
  var bg = comps.space_bg || comps.card || '';
  var hasThemePkg = isHttpUrl(equip.package_url);
  var themeBg = (equip.data && isHttpUrl(equip.data.head_myself_bg) && equip.data.head_myself_bg) || '';
  if (!bg && (hasThemePkg || themeBg)) bg = themeBg || equip.preview || '';
  if (!isHttpUrl(bg)) bg = '';
  if (bg) {
    if (data.header_bg !== bg) { data.header_bg = bg; changed = true; }
    if (data.vip_space_label !== bg) { data.vip_space_label = bg; changed = true; }
  }
  if (comps.pendant) {
    if (data.pendantUrl !== comps.pendant) { data.pendantUrl = comps.pendant; changed = true; }
    data.pendant = {
      pid: comps.pendant_id || 1,
      name: (equip.components && equip.components.pendant && equip.components.pendant.name) || '',
      image: comps.pendant,
      expire: 0,
      image_enhance: comps.pendant,
      image_enhance_frame: ''
    };
    changed = true;
    if (data.avatar && injectAvatarPendantLayer(data.avatar, comps.pendant)) changed = true;
  }
  return changed;
}

/* 开屏候选合并写入。
   以前每条通道（品牌 / 活动 / business / 收藏集）都是直接覆盖，
   谁最后响应谁说了算 —— 结果往往只剩一堆没用的，自己想要的反而被冲掉。
   现在按 kind#id 去重后合并，最多留 SPLASH_MAX 条。 */
function mergeSplashList(items) {
  if (!items || !items.length) return 0;
  var fresh = [];
  var keys = {};
  var i;
  for (i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !isHttpUrl(it.thumb)) continue;
    var k = String(it.kind || 'brand') + '#' + String(it.id);
    if (keys[k]) continue;
    keys[k] = 1;
    fresh.push(it);
  }
  if (!fresh.length) return 0;

  var cur = readJSON(KEY_SPLASH_LIST, []);
  if (!(cur instanceof Array)) cur = [];
  var keep = [];
  for (i = 0; i < cur.length; i++) {
    var c = cur[i];
    if (!c || !isHttpUrl(c.thumb)) continue;
    if (keys[String(c.kind || 'brand') + '#' + String(c.id)]) continue;
    keep.push(c);
  }
  var out = fresh.concat(keep);
  if (out.length > SPLASH_MAX) out = out.slice(0, SPLASH_MAX);
  writeJSON(KEY_SPLASH_LIST, out);
  return out.length;
}

/* 收藏集开屏（x/vas/dlc_act/card/splash_info）：结构未解，按字段名兜。
   记候选 + 若选中了开屏就把图字段铺过去。 */
function handleCollectSplash() {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body.length > 1048576) return $done({});

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }
  if (!json || json.code !== 0) return $done({});

  /* 收集所有 hdslb 图地址当候选 */
  var urls = [];
  collectHttpUrls(json, urls, 0, 12);
  if (urls.length) {
    var out = [];
    for (var i = 0; i < urls.length && out.length < SPLASH_MAX; i++) {
      out.push({ kind: 'collect', id: i + 1, thumb: urls[i] });
    }
    if (out.length) mergeSplashList(out);
  }

  var splash = readJSON(KEY_SPLASH, null);
  if (!splash || !isHttpUrl(splash.thumb)) return $done({});
  if (!replaceHttpUrls(json, splash.thumb, 0)) return $done({});
  $done({ body: JSON.stringify(json) });
}

function collectHttpUrls(node, out, depth, max) {
  if (!node || typeof node !== 'object' || depth > max) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectHttpUrls(node[i], out, depth + 1, max);
    return;
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (typeof v === 'string' && /^https?:\/\/[a-z0-9.-]*hdslb\.com\//i.test(v)) out.push(v);
    else if (v && typeof v === 'object') collectHttpUrls(v, out, depth + 1, max);
  }
}

function replaceHttpUrls(node, url, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return 0;
  var n = 0;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) n += replaceHttpUrls(node[i], url, depth + 1);
    return n;
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (typeof v === 'string' && /^https?:\/\/[a-z0-9.-]*hdslb\.com\//i.test(v) && v !== url) {
      node[k] = url;
      n++;
    } else if (v && typeof v === 'object') n += replaceHttpUrls(v, url, depth + 1);
  }
  return n;
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

    /* 合并已有装扮组件：应用单组件（如收藏集挂件）时保留已有主题，应用主题时保留已有独立挂件 */
    var prev = readJSON(KEY_EQUIP, null);
    if (prev && typeof prev === 'object') {
      equip.components = equip.components || {};
      var prevComps = prev.components || {};
      if (!isHttpUrl(equip.package_url) && isHttpUrl(prev.package_url)) {
        equip.package_url = prev.package_url;
        equip.package_md5 = prev.package_md5;
        equip.data = equip.data || prev.data;
        if (!equip.preview) equip.preview = prev.preview;
      }
      for (var ck in prevComps) {
        if (!equip.components[ck] && prevComps[ck]) {
          equip.components[ck] = prevComps[ck];
        }
      }
    }

    if (!writeJSON(KEY_EQUIP, equip)) return reply({ code: -1, msg: '写入失败' });

    /* 多账号：顺手按当前 mid 也存一份 */
    var selfNow = readJSON(KEY_SELF, null);
    if (selfNow && selfNow.mid) {
      var eqMap = readJSON(KEY_EQUIPS, {});
      if (!eqMap || typeof eqMap !== 'object') eqMap = {};
      eqMap[String(selfNow.mid)] = equip;
      writeJSON(KEY_EQUIPS, eqMap);
    }

    /* 应用成功发系统通知 */
    var pf = readPrefs();
    if (pf.notify && typeof $notification !== 'undefined' && $notification.post) {
      $notification.post(
        'B站装扮工作室',
        '已注入「' + (equip.name || equip.id) + '」',
        '杀掉后台重进 B站 生效'
      );
    }
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
    /* 活动开屏要校验图片 md5：这里把图拉下来算好再存，否则换了图也会被校验丢掉。
       品牌开屏没有 md5，算不出来也不影响。 */
    ensureSplashMd5(sp, function (done) {
      writeJSON(KEY_SPLASH, done);
      reply({ code: 0, data: { id: done.id, md5: done.md5 || '' } });
    });
    return;
  }
  if (name === 'splash/clear') {
    $persistentStore.write('', KEY_SPLASH);
    return reply({ code: 0 });
  }

  /* Chronos 开屏：只能「回放」服务端发过的包（见 handleChronos 的说明） */
  if (name === 'chronos/list') return reply({ code: 0, data: readJSON(KEY_CHRONOS_LIST, []) });
  if (name === 'chronos') return reply({ code: 0, data: readJSON(KEY_CHRONOS, null) });
  if (name === 'chronos/set') {
    var ch;
    try {
      ch = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    if (!ch || !isHttpUrl(ch.url) || !ch.sign) {
      return reply({ code: -1, msg: '缺少 url 或 sign（回放必须有服务端签名）' });
    }
    writeJSON(KEY_CHRONOS, ch);
    /* 顺手把包体也存一份本地副本，CDN 撤包后还能顶上 */
    cacheChronosBlob(ch, function (cached) {
      reply({
        code: 0,
        data: { id: ch.id, service_key: ch.service_key || '', cached: cached }
      });
    });
    return;
  }
  if (name === 'chronos/clear') {
    $persistentStore.write('', KEY_CHRONOS);
    return reply({ code: 0 });
  }

  /* ---- 设置项 ---- */
  if (name === 'prefs') return reply({ code: 0, data: readPrefs() });
  if (name === 'prefs/set') {
    var np;
    try {
      np = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    if (!np || typeof np !== 'object') return reply({ code: -1, msg: '空配置' });
    var cur = readPrefs();
    for (var pk in np) {
      if (Object.prototype.hasOwnProperty.call(np, pk)) cur[pk] = np[pk];
    }
    writeJSON(KEY_PREFS, cur);
    return reply({ code: 0, data: cur });
  }

  /* ---- 诊断：面板里显示「到底有没有生效」 ---- */
  if (name === 'diag') {
    var seenList = readJSON(KEY_SEEN, []);
    var eq = readJSON(KEY_EQUIP, null);
    var selfRec = readJSON(KEY_SELF, null);
    var galList = readJSON(KEY_GALLERY, []);
    var chList = readJSON(KEY_CHRONOS_LIST, []);
    return reply({
      code: 0,
      data: {
        equip: eq
          ? {
              id: eq.id,
              name: eq.name,
              components: Object.keys((eq && eq.components) || {}),
              hasSkin: !!skinOf(eq),
              hasLoading: !!loadingOf(eq)
            }
          : null,
        selfMid: (selfRec && selfRec.mid) || '',
        seen: seenList instanceof Array ? seenList.length : 0,
        found: (function () {
          var f = readJSON(KEY_FOUND, []);
          return f instanceof Array ? f.length : 0;
        })(),
        gallery: galList instanceof Array ? galList.length : 0,
        chronos: chList instanceof Array ? chList.length : 0,
        splash: readJSON(KEY_SPLASH, null) ? 1 : 0,
        prefs: readPrefs()
      }
    });
  }

  /* ---- 接口日志（定位响应结构用） ---- */
  if (name === 'apilog') return reply({ code: 0, data: readJSON(KEY_APILOG, []) });
  if (name === 'apilog/clear') {
    $persistentStore.write('', KEY_APILOG);
    return reply({ code: 0 });
  }

  /* ---- 导出 / 导入（换设备用） ---- */
  if (name === 'export') {
    return reply({
      code: 0,
      data: {
        v: 1,
        at: Date.now(),
        equip: readJSON(KEY_EQUIP, null),
        gallery: readJSON(KEY_GALLERY, []),
        equips: readJSON(KEY_EQUIPS, {}),
        splash: readJSON(KEY_SPLASH, null),
        chronos: readJSON(KEY_CHRONOS, null),
        prefs: readPrefs()
      }
    });
  }
  if (name === 'import') {
    var dump;
    try {
      dump = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '不是合法 JSON' });
    }
    if (!dump || typeof dump !== 'object') return reply({ code: -1, msg: '空数据' });
    var wrote = 0;
    if (dump.equip && validEquip(dump.equip)) {
      writeJSON(KEY_EQUIP, dump.equip);
      wrote++;
    }
    if (dump.gallery instanceof Array) {
      writeJSON(KEY_GALLERY, dump.gallery);
      wrote++;
    }
    if (dump.equips && typeof dump.equips === 'object') {
      writeJSON(KEY_EQUIPS, dump.equips);
      wrote++;
    }
    if (dump.splash && typeof dump.splash === 'object') {
      writeJSON(KEY_SPLASH, dump.splash);
      wrote++;
    }
    if (dump.chronos && typeof dump.chronos === 'object') {
      writeJSON(KEY_CHRONOS, dump.chronos);
      wrote++;
    }
    if (dump.prefs && typeof dump.prefs === 'object') {
      writeJSON(KEY_PREFS, dump.prefs);
      wrote++;
    }
    return reply({ code: 0, data: { sections: wrote } });
  }

  /* ---- 多账号：按 mid 分开存 ---- */
  if (name === 'equips') return reply({ code: 0, data: readJSON(KEY_EQUIPS, {}) });
  if (name === 'equips/use') {
    var useMid = String(intParam(qs, 'mid') || '');
    var all = readJSON(KEY_EQUIPS, {});
    if (!all || typeof all !== 'object' || !all[useMid]) {
      return reply({ code: -1, msg: '这个账号没存过装扮' });
    }
    if (!validEquip(all[useMid])) return reply({ code: -1, msg: '存的那套已失效' });
    writeJSON(KEY_EQUIP, all[useMid]);
    return reply({ code: 0, data: { mid: useMid, name: all[useMid].name } });
  }
  if (name === 'equips/remove') {
    var rmMid = String(intParam(qs, 'mid') || '');
    var map = readJSON(KEY_EQUIPS, {});
    if (map && typeof map === 'object') delete map[rmMid];
    writeJSON(KEY_EQUIPS, map || {});
    return reply({ code: 0, data: { count: Object.keys(map || {}).length } });
  }

  /* ---- 开售提醒 ---- */
  if (name === 'reminders') return reply({ code: 0, data: readJSON(KEY_REMINDERS, []) });
  if (name === 'reminders/add') {
    var rem;
    try {
      rem = JSON.parse($request.body || '');
    } catch (e) {
      return reply({ code: -1, msg: '配置不是合法 JSON' });
    }
    if (!rem || !rem.name) return reply({ code: -1, msg: '缺少名称' });
    var rl = readJSON(KEY_REMINDERS, []);
    if (!(rl instanceof Array)) rl = [];
    rl = rl.filter(function (x) {
      return x && String(x.id) !== String(rem.id);
    });
    rl.unshift({ id: rem.id || Date.now(), name: rem.name, startAt: Number(rem.startAt) || 0 });
    if (rl.length > 50) rl = rl.slice(0, 50);
    writeJSON(KEY_REMINDERS, rl);
    return reply({ code: 0, data: { count: rl.length } });
  }
  if (name === 'reminders/remove') {
    var rid = String(intParam(qs, 'id') || '');
    var rr = readJSON(KEY_REMINDERS, []);
    if (!(rr instanceof Array)) rr = [];
    var kept = rr.filter(function (x) {
      return x && String(x.id) !== rid;
    });
    writeJSON(KEY_REMINDERS, kept);
    return reply({ code: 0, data: { count: kept.length } });
  }

  /* ---- 手动发通知 ---- */
  if (name === 'notify') {
    var nt = '';
    var nm = /[?&]msg=([^&]+)/.exec('?' + qs);
    if (nm) nt = nm[1];
    if (typeof $notification !== 'undefined' && $notification.post) {
      $notification.post('B站装扮工作室', '提示', nt || '');
    }
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

  /* 持久候选：在 App 原生页（收藏集 / 资产列表）里抓到的、只有单个组件的东西。
     面板打开时不一定还在 seen 的 30 分钟窗口里，所以单独一条。 */
  if (name === 'found') {
    var fl = readJSON(KEY_FOUND, []);
    if (!(fl instanceof Array)) fl = [];
    var now2 = Date.now();
    var fo = [];
    for (var fi = 0; fi < fl.length; fi++) {
      var fr = fl[fi];
      if (!fr || !validEquip(fr.equip)) continue;
      if (!fr.ts || now2 - fr.ts > FOUND_TTL) continue;
      fo.push(fr.equip);
    }
    return reply({ code: 0, data: fo });
  }

  /* 官方绝版/下架装扮库（30套主题 + 8套加载动画） */
  if (name === 'delisted') {
    return reply({ code: 0, data: DELISTED_SKINS });
  }
  if (name === 'found/clear') {
    $persistentStore.write('', KEY_FOUND);
    return reply({ code: 0 });
  }

  return reply({ code: 0, data: { ok: true } });
}

/* ===================== 2. 应用主题 + 加载动画 ===================== */

/* 到点的收藏集开售提醒：每次拉 skin 时检查一次，发完就从列表里摘掉。 */
function checkReminders() {
  var prefs = readPrefs();
  if (!prefs.notify) return;
  var list = readJSON(KEY_REMINDERS, []);
  if (!(list instanceof Array) || !list.length) return;

  var now = Math.floor(Date.now() / 1000);
  var due = [];
  var rest = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r) continue;
    if (r.startAt && r.startAt <= now) due.push(r);
    else rest.push(r);
  }
  if (!due.length) return;

  writeJSON(KEY_REMINDERS, rest);
  var names = [];
  for (var j = 0; j < due.length && j < 3; j++) names.push(due[j].name);
  if (typeof $notification !== 'undefined' && $notification.post) {
    $notification.post('B站装扮工作室', '收藏集已开售', names.join(' / '));
  }
}

function handleApply() {
  checkReminders();

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
  var dark = isDarkMode($request && $request.url, $request && $request.headers);

  var skin = skinOf(equip, dark);
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

  /* 通用一遍：响应里若还有别的组件字段（挂件动态形态等）也顺手换掉 */
  if (rewriteByField(resp.data, compsOf(equip), 0)) changed = true;

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
  'pendant',
  'thumbup',
  'play_icon',
  'space_bg',
  'emoji_package'
];

function skinData(p, dark) {
  p = p || {};
  var out = {};
  for (var k in p) {
    if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
  }
  var isDark = dark || p.color_mode === 'dark';
  out.color_mode = isDark ? 'dark' : (p.color_mode || 'light');
  out.color = isDark ? '#ffffff' : (p.color || '#212121');
  out.color_second_page = p.color_second_page || (isDark ? '#302C49' : '#ffffff');
  out.side_bg_color = p.side_bg_color || p.color_second_page || (isDark ? '#29244d' : '#ffffff');
  out.tail_color = p.tail_color || (isDark ? '#dad6d6' : '#996c00');
  out.tail_color_selected = p.tail_color_selected || (isDark ? '#a2f3f7' : '#0d6872');
  out.tail_icon_ani = String(p.tail_icon_ani) === 'true';
  out.tail_icon_ani_mode = p.tail_icon_ani_mode || 'once';
  out.tail_icon_mode = p.tail_icon_mode || 'img';
  out.head_myself_mp4_play = p.head_myself_mp4_play || (p.head_myself_mp4_bg ? 'loop' : 'once');
  return out;
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
  } else if (kind === 'pendant') {
    out.url = p.image || p.image_enhance || p.pendant_pic || p.preview || '';
    out.enhance = p.image_enhance || p.imageEnhance || '';
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

/* 把抓到的候选写进「本页」存储（短 TTL，面板按 since 过滤）。 */
function pushSeen(found) {
  if (!found || !found.length) return 0;
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
  return found.length;
}

/* 把抓到的候选写进「持久候选」存储（7 天）。
   收藏集是在 App 原生页里逛的，等回到 H5 面板时 enterTs 早就过去了，
   所以这条必须另外存，否则永远「没获取到」。 */
function pushFound(found) {
  if (!found || !found.length) return 0;
  var now = Date.now();
  var list = readJSON(KEY_FOUND, []);
  if (!(list instanceof Array)) list = [];
  list = list.filter(function (x) {
    return x && x.ts && now - x.ts <= FOUND_TTL;
  });
  for (var i = 0; i < found.length; i++) {
    var e = found[i];
    for (var j = list.length - 1; j >= 0; j--) {
      if (list[j].equip && String(list[j].equip.id) === String(e.id)) list.splice(j, 1);
    }
    list.unshift({ ts: now, equip: e });
  }
  if (list.length > FOUND_MAX) list = list.slice(0, FOUND_MAX);
  writeJSON(KEY_FOUND, list);
  return found.length;
}

/* ---------- 收藏集兑换物 ----------
   收藏集（抽卡 / 数字藏品）里的东西不是 suit：响应的 collect_infos 里是
   redeem_item_* 一组字段。实测条目（act_id=114713&lottery_id=114714）：
     {redeem_item_type: 3,    redeem_item_type_name: "头像挂件", redeem_item_id: "1790565160001", ...}
     {redeem_item_type: 1001, redeem_item_type_name: "评论背景", redeem_item_id: "", ...}
     {redeem_item_type: 1,    redeem_item_type_name: "典藏卡",   redeem_item_id: "1790737537002", ...}
   type 数字各活动不统一（见过 1/3/4/5/1001），所以**按名字**映射组件最稳。
   这里只做「不花时间」的事：有图的直接拼成单组件候选；
   只有 id 的（主题套装那种）标 needResolve，交给 H5 面板去拉详情——
   免得为了几个请求把 App 的收藏集页卡住。 */

var TYPE_NAME_COMPONENT = {
  头像挂件: 'pendant',
  挂件: 'pendant',
  粉丝挂件: 'pendant',
  评论背景: 'card_bg',
  评论装扮: 'card_bg',
  动态卡片: 'card',
  卡片: 'card',
  空间头图: 'space_bg',
  空间海报: 'space_bg',
  加载动画: 'loading',
  进度条: 'play_icon',
  点赞效果: 'thumbup',
  点赞: 'thumbup',
  个性主题: 'skin',
  主题: 'skin'
};

function kindOfTypeName(name) {
  var s = String(name || '').trim();
  if (!s) return '';
  if (TYPE_NAME_COMPONENT[s]) return TYPE_NAME_COMPONENT[s];
  for (var k in TYPE_NAME_COMPONENT) {
    if (s.indexOf(k) >= 0) return TYPE_NAME_COMPONENT[k];
  }
  return '';
}

/* 递归找出所有 redeem 条目（不依赖外层包装键名） */
function collectRedeems(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectRedeems(node[i], out, depth + 1);
    return;
  }
  if (node.redeem_item_name || node.redeem_item_id || node.redeem_item_type_name) {
    var vUrl = '';
    if (node.redeem_detail_videos && node.redeem_detail_videos instanceof Array && node.redeem_detail_videos.length) {
      vUrl = node.redeem_detail_videos[0];
    }
    out.push({
      id: String(node.redeem_item_id == null ? '' : node.redeem_item_id),
      name: String(node.redeem_item_name || ''),
      image: node.redeem_item_image || node.redeem_detail_image || '',
      typeName: node.redeem_item_type_name || '',
      type: Number(node.redeem_item_type) || 0,
      jump: node.garb_suit_url || node.garb_apply_url || node.jump_url || '',
      video_url: vUrl
    });
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (v && typeof v === 'object') collectRedeems(v, out, depth + 1);
  }
}

/* redeem 条目 -> 候选。有图 + 认得出组件就拼成单组件候选；否则只留 id 等面板解析。 */
function equipFromRedeem(r) {
  if (!r) return null;
  var kind = kindOfTypeName(r.typeName);
  var img = isHttpUrl(r.image) ? r.image : '';
  var name = r.name || ('装扮 ' + (r.id || ''));
  var id = /^\d+$/.test(r.id) ? Number(r.id) : r.id;

  if (kind && img && kind !== 'skin') {
    var comp = { id: id || 0, name: name, url: img };
    if (kind === 'pendant') comp.image = img;
    var comps = {};
    comps[kind] = comp;
    return {
      id: id || name,
      name: name,
      preview: img,
      ver: 1700000000,
      components: comps,
      from: 'collect',
      partial: true,
      typeName: r.typeName
    };
  }

  /* 主题套装 / 认不出类型：带 id，同时如果带图也拼成基础组件以防拉详情失败 */
  if (r.id || img) {
    var fallbackComps = {};
    if (img) {
      fallbackComps.card = { id: id || 0, name: name, image: img, url: img };
      fallbackComps.card_bg = { id: id || 0, name: name, image: img, url: img };
      if (kind === 'skin') fallbackComps.skin = { id: id || 0, name: name, preview: img };
    }
    return {
      id: id || name,
      name: name,
      preview: img,
      video_url: r.video_url || '',
      ver: 1700000000,
      components: fallbackComps,
      from: 'collect',
      needResolve: !!r.id,
      typeName: r.typeName
    };
  }
  return null;
}

/* ---------- 已拥有资产列表 ----------
   x/garb/user/asset/list、x/garb/v3/user/asset、x/garb/user/pendant/list…
   结构没完全解出，所以只在**明确看到 part 字段**时才动；
   挂件那条接口按路径特判（它的条目没有 part）。
   拿不到就什么都不做，但响应已经被 shouldLogApi 记进日志了。 */

var ASSET_PARTS = {
  skin: 1,
  loading: 1,
  card: 1,
  card_bg: 1,
  pendant: 1,
  fansPendant: 1,
  thumbup: 1,
  play_icon: 1,
  space_bg: 1
};

function collectAssets(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectAssets(node[i], out, depth + 1);
    return;
  }
  var part = typeof node.part === 'string' ? node.part : '';
  if (part && ASSET_PARTS[part]) {
    var it = node.item || {};
    out.push({
      part: part === 'fansPendant' ? 'pendant' : part,
      id: it.item_id || node.asset_id || node.id || 0,
      name: it.name || node.name || '',
      props: it.properties || node.properties || {}
    });
    return; /* 命中就不再往里钻 */
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (v && typeof v === 'object') collectAssets(v, out, depth + 1);
  }
}

/* 挂件接口（/x/garb/user/pendant/list）的条目没有 part，按字段特征认 */
function collectPendantItems(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 10) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectPendantItems(node[i], out, depth + 1);
    return;
  }
  var p = node.properties || node;
  if (
    (isHttpUrl(p.image) || isHttpUrl(p.image_enhance)) &&
    (node.item_id != null || node.id != null || node.pid != null)
  ) {
    out.push({
      part: 'pendant',
      id: node.item_id || node.id || node.pid || 0,
      name: node.name || '',
      props: p
    });
    return;
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (v && typeof v === 'object') collectPendantItems(v, out, depth + 1);
  }
}

/* ---------- 收藏集卡片列表 (card_list) ----------
   用户逛数字藏品 / 抽卡页时，把卡池里的立绘卡片直接提取为动态卡片 / 评论装扮候选 */
function collectCardList(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 10) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectCardList(node[i], out, depth + 1);
    return;
  }
  if (node.card_list && node.card_list instanceof Array) {
    for (var j = 0; j < node.card_list.length; j++) {
      var c = node.card_list[j] || {};
      var img = c.card_img || '';
      if (isHttpUrl(img)) {
        var cid = c.card_type_id || c.id || (j + 1);
        var cname = c.card_name || ('卡片 ' + cid);
        out.push({
          id: cid,
          name: cname,
          preview: img,
          ver: 1700000000,
          components: {
            card: { id: cid, name: cname, image: img, url: img },
            card_bg: { id: cid, name: cname, image: img, url: img }
          },
          from: 'collect_card',
          partial: true,
          typeName: '动态卡片'
        });
      }
    }
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (v && typeof v === 'object' && k !== 'card_list') collectCardList(v, out, depth + 1);
  }
}

/* ---------- 统一入口：从任意 garb/vas 响应里挖候选 ----------
   一条响应里可能同时有多种东西（suit_items 套装 + collect_infos 兑换物 +
   asset 列表），所以一次遍历全试一遍，最后统一写存储、只 $done 一次。 */
function handleCandidates(url) {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body.length < 16 || body.length > 4194304) return $done({});

  var profile = PROFILE_RE.test(url);
  /* 便宜的前置判断：没这几样、又不是空间/我的页，就别白解析一遍 JSON
     （x/garb/mall/suit/all 那种全量目录能有好几 MB）。 */
  var maybe =
    body.indexOf('suit_items') >= 0 ||
    body.indexOf('redeem_item') >= 0 ||
    body.indexOf('card_list') >= 0 ||
    body.indexOf('collect_list') >= 0 ||
    body.indexOf('"part"') >= 0 ||
    /\/pendant\//.test(url);
  if (!maybe && !profile) return $done({});
  if (body.indexOf('{') < 0) return $done({});

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }
  if (!json || typeof json !== 'object') return $done({});

  var out = [];

  /* 1) 套装：suit_items.skin[] 是主键，其它组件一起收 */
  if (body.indexOf('suit_items') >= 0) {
    var suits = [];
    harvest(json, suits, 0);
    for (var s = 0; s < suits.length && out.length < 40; s++) out.push(suits[s]);
  }

  /* 2) 收藏集兑换物 */
  if (body.indexOf('redeem_item') >= 0 || body.indexOf('collect_list') >= 0) {
    var redeems = [];
    collectRedeems(json, redeems, 0);
    for (var r = 0; r < redeems.length && out.length < 60; r++) {
      var re = equipFromRedeem(redeems[r]);
      if (re) out.push(re);
    }
  }

  /* 2.5) 收藏集立绘卡片 */
  if (body.indexOf('card_list') >= 0) {
    var cards = [];
    collectCardList(json, cards, 0);
    for (var c = 0; c < cards.length && out.length < 90; c++) {
      out.push(cards[c]);
    }
  }

  /* 3) 已拥有资产列表 */
  if (body.indexOf('"part"') >= 0 || /\/pendant\//.test(url)) {
    var assets = [];
    collectAssets(json, assets, 0);
    if (/\/pendant\//.test(url) && !assets.length) collectPendantItems(json, assets, 0);
    for (var a = 0; a < assets.length && out.length < 90; a++) {
      var it = assets[a];
      var c = componentOf(it.part, { item_id: it.id, name: it.name, properties: it.props });
      if (!c || !isHttpUrl(c.url)) continue;
      var comps = {};
      comps[it.part] = c;
      out.push({
        id: it.id || it.name,
        name: it.name || '',
        preview: c.url,
        ver: 1700000000,
        components: comps,
        from: 'assets',
        partial: true
      });
    }
  }

  if (out.length) {
    pushSeen(out);
    pushFound(out);
  } else if (!profile) {
    return $done({});
  }

  /* 空间 / 我的页 / 数字藏品 / 我的装扮：顺手按字段名换图 */
  if (profile && rewriteProfileBody(url, json)) {
    return $done({ body: JSON.stringify(json) });
  }
  $done({});
}

/* ===================== 5. 评论装扮 / 头像挂件 ===================== */

/* 只改「当前登录用户自己」的 member 节点，别人的不动。
   selfMid 由 H5 页面通过桥上报；拿不到就不改，避免全站串味。
   设置里把 allMembers 打开后，就不再校验 mid（所有人的评论装扮都换成你的）。 */
function rewriteMember(m, selfMid, card, pendant, all) {
  if (!m || typeof m !== 'object') return 0;
  var mid = m.mid != null ? String(m.mid) : m.mid_str != null ? String(m.mid_str) : '';
  if (!mid) return 0;
  if (!all && (!selfMid || mid !== selfMid)) return 0;

  var n = 0;
  if (pendant) {
    var pImg = pendant.image || pendant.url;
    var pId = Number(pendant.id) || 1;
    var pName = pendant.name || '';
    if (!m.user_sailing || typeof m.user_sailing !== 'object') m.user_sailing = {};
    if (!m.user_sailing.pendant || typeof m.user_sailing.pendant !== 'object') {
      m.user_sailing.pendant = {
        id: pId,
        name: pName,
        image: pImg,
        jump_url: '',
        type: 'suit',
        image_enhance: pendant.image_enhance || pImg,
        image_enhance_frame: ''
      };
      n++;
    } else {
      m.user_sailing.pendant = mergePendant(m.user_sailing.pendant, pendant);
      n++;
    }

    if (!m.pendant || typeof m.pendant !== 'object') {
      m.pendant = {
        pid: pId,
        name: pName,
        image: pImg,
        expire: 0,
        image_enhance: pendant.image_enhance || pImg,
        image_enhance_frame: ''
      };
      n++;
    } else {
      m.pendant = mergePendant(m.pendant, pendant);
      if (!m.pendant.pid || m.pendant.pid === 0) m.pendant.pid = pId;
      n++;
    }
  }

  if (card) {
    var cImg = card.image || card.url;
    var cId = Number(card.id) || 1;
    var cName = card.name || '';
    if (!m.user_sailing || typeof m.user_sailing !== 'object') m.user_sailing = {};

    /* ⚠️ 字段名是实测出来的，别想当然：
         2026-10-18 拉线上评论接口（x/v2/reply，aid=117451148822815）实际结构：
           member.user_sailing    = { pendant:null, cardbg:{…}, cardbg_with_focus:null }
           member.user_sailing_v2 = { card_bg:{…} }
       v1 里是 **cardbg**（没有下划线），v2 里才是 card_bg。
       旧代码往 v1 写的是 user_sailing.card_bg —— App 不认识这个键，等于没改；
       而 App 仍然拿 v1 里原来那套 cardbg 去渲染，于是「我们的卡 + 原来的卡」
       两层叠在一起互相打架，表现就是「装扮卡片加载不出来 / 好像加载了两层」。 */
    if (!m.user_sailing.cardbg || typeof m.user_sailing.cardbg !== 'object') {
      m.user_sailing.cardbg = cardNode(null, card);
      n++;
    } else {
      m.user_sailing.cardbg = mergeCard(m.user_sailing.cardbg, card);
      n++;
    }
    /* 聚焦态只有原本就存在才补，避免给 App 塞出它不认识的结构 */
    if (m.user_sailing.cardbg_with_focus !== undefined) {
      m.user_sailing.cardbg_with_focus = mergeCard(m.user_sailing.cardbg_with_focus, card);
      n++;
    }
    /* 旧版本写错的键，顺手清掉 */
    if (m.user_sailing.card_bg !== undefined) delete m.user_sailing.card_bg;

    if (!m.user_sailing_v2 || typeof m.user_sailing_v2 !== 'object') m.user_sailing_v2 = {};
    m.user_sailing_v2.card_bg = mergeCard(m.user_sailing_v2.card_bg || {}, card);
    n++;
  }

  /* 通用字段一遍：image_enhance 之类的挂件动态形态 */
  n += rewriteByField(m, compsOf({ components: { pendant: pendant, card: card } }), 0);
  return n;
}

/* 新建一个 App 认识的卡片节点（只在原本没有卡时用）。
   字段照抄线上结构：{id,name,image,jump_url,fan,type}，v1 还有 image_group。
   fan 必须是 null 或完整对象 —— 塞个半成品会让粉丝牌那块渲染异常。 */
function cardNode(orig, card) {
  var out = {};
  if (orig && typeof orig === 'object') {
    for (var k in orig) {
      if (Object.prototype.hasOwnProperty.call(orig, k)) out[k] = orig[k];
    }
  }
  out.id = card.id || out.id || 0;
  out.name = card.name || out.name || '';
  out.image = card.image;
  if (!out.type) out.type = 'suit';
  if (out.jump_url == null) out.jump_url = '';
  if (out.fan === undefined) out.fan = null;
  if (out.image_group === undefined) out.image_group = null;
  return out;
}

/* 保留原对象结构，只把图/名/id 换掉。
   ⚠️ `image_preview_small` 也要一起换：卡片对象里它是「先画出来的小预览」，
   只换 image 不换它，就会先看到旧卡的缩略图、再叠上我们的整图 ——
   实机上看起来就是「加载了两层」。 */
function mergeCard(orig, card) {
  if (typeof orig === 'string') return card.image;
  var out = {};
  if (orig && typeof orig === 'object') {
    for (var k in orig) {
      if (Object.prototype.hasOwnProperty.call(orig, k)) out[k] = orig[k];
    }
  }
  out.image = card.image;
  if (out.image_preview_small !== undefined) out.image_preview_small = card.image;
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
  var img = pendant.image || pendant.url;
  out.image = img;
  var pid = Number(pendant.id) || 1;
  out.pid = pid;
  out.id = pid;
  if (pendant.name) out.name = pendant.name;
  /* 动态形态要么换成我们的，要么退到同一张静态图 ——
     留着原来那套就是「旧挂件 + 新挂件」两层叠在头像上。 */
  if (out.image_enhance !== undefined) {
    out.image_enhance = pendant.image_enhance || img;
  } else if (pendant.image_enhance) {
    out.image_enhance = pendant.image_enhance;
  }
  if (out.image_enhance_frame !== undefined) out.image_enhance_frame = '';
  return out;
}

/* 在任意嵌套结构里找出所有 member 节点并改写 */
function walkMembers(node, selfMid, card, pendant, all, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return 0;
  var n = 0;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) {
      n += walkMembers(node[i], selfMid, card, pendant, all, depth + 1);
    }
    return n;
  }
  n += rewriteMember(node, selfMid, card, pendant, all);
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    if (k === 'member' && node[k] && typeof node[k] === 'object') {
      n += rewriteMember(node[k], selfMid, card, pendant, all);
    }
    try {
      n += walkMembers(node[k], selfMid, card, pendant, all, depth + 1);
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

  var prefs = readPrefs();
  var self = readJSON(KEY_SELF, null);
  var selfMid = self && self.mid ? String(self.mid) : '';
  /* 不知道是谁、又没开「改所有人」，就不动，避免全站串味 */
  if (!selfMid && !prefs.allMembers) return $done({});

  var body = $response && $response.body;
  if (typeof body !== 'string') return $done({});
  /* 评论/动态走 member.user_sailing*；动态信息流的作者节点是
     modules.module_author，里面只有 pendant / card_bg —— 也要放进来。
     若原本没有装扮节点，只要含 member 或 module_author 也应允许注入。 */
  if (
    body.indexOf('user_sailing') < 0 &&
    body.indexOf('pendant') < 0 &&
    body.indexOf('card_bg') < 0 &&
    body.indexOf('member') < 0 &&
    body.indexOf('module_author') < 0
  ) {
    return $done({});
  }

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }

  if (!walkMembers(json, selfMid, card, pendant, !!prefs.allMembers, 0)) return $done({});
  $done({ body: JSON.stringify(json) });
}

/* ===================== 6. 开屏动画 ===================== */

/* 两个通道都挂在 /x/v2/splash/ 下，按响应特征分派：
   - brand/list ：data.{pull_interval,list[],show[]}，list[].thumb 是开屏图
   - event/list2：一组「前后卡片」元素，front_image_url / back_image_url */
function handleSplash() {
  var url = ($request && $request.url) || '';
  var body = $response && $response.body;
  if (typeof body !== 'string') return $done({});

  /* 新版 business 开屏（BFCBusinessSplashSwift）：list 拿候选、show 决定展示。
     这是 App 现在真正走的一条，旧版 brand/list 只用于「品牌开屏设置」页。 */
  if (/\/x\/v2\/splash\/(?:list|show)/.test(url)) return handleBusinessSplash(body, url);
  if (body.indexOf('pull_interval') >= 0) return handleBrandSplash(body);
  if (body.indexOf('front_image_url') >= 0 || body.indexOf('back_image_url') >= 0) {
    return handleEventSplash(body);
  }
  return $done({});
}

/* 新版 business 开屏：结构未完全解出，按「图片字段名」策略兜。
   list 里认出创意项就记候选；选中后把候选里的图地址换成我们的图。 */
function handleBusinessSplash(body, url) {
  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }
  if (!json || json.code !== 0) return $done({});

  /* list：记录候选（含 id + 图） */
  if (/\/list/.test(url)) {
    var items = [];
    collectSplashItems(json, items, 0);
    if (items.length) mergeSplashList(items);
  }

  var splash = readJSON(KEY_SPLASH, null);
  if (!splash || !isHttpUrl(splash.thumb)) return $done({});

  /* 把响应里所有「开屏创意图」字段换成选中的图 */
  if (!replaceSplashImage(json, splash.thumb, splash.md5 || '', 0)) return $done({});
  $done({ body: JSON.stringify(json) });
}

/* 开屏创意图字段白名单（尽量窄，避免误伤 logo / 按钮图） */
var SPLASH_IMG_KEYS = {
  image_url: 1,
  image: 1,
  thumb: 1,
  pic: 1,
  splash_image: 1,
  main_image: 1,
  cover: 1,
  url: 0 /* url 太泛，只在含 id 的对象里才换 */
};

/* 递归：在「含 id 的对象」里替换开屏创意图 */
function replaceSplashImage(node, img, md5Val, depth) {
  if (!node || typeof node !== 'object' || depth > 10) return 0;
  var n = 0;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) n += replaceSplashImage(node[i], img, md5Val, depth + 1);
    return n;
  }
  var hasId = node.id != null || node.creative_id != null || node.splash_id != null;
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (SPLASH_IMG_KEYS[k] && typeof v === 'string' && /^https?:\/\//.test(v) && v !== img) {
      /* url 这个键名太泛，只在明确是创意项（有 id）时换 */
      if (k === 'url' && !hasId) continue;
      node[k] = img;
      if (md5Val) {
        if ('hash' in node) node.hash = md5Val;
        if ('md5' in node) node.md5 = md5Val;
      }
      n++;
      continue;
    }
    if (v && typeof v === 'object') n += replaceSplashImage(v, img, md5Val, depth + 1);
  }
  return n;
}

/* 从 business 开屏响应里挑候选（有 id 且含图地址的对象） */
function collectSplashItems(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 10) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectSplashItems(node[i], out, depth + 1);
    return;
  }
  var id = node.id != null ? node.id : node.creative_id != null ? node.creative_id : null;
  if (id != null) {
    var img = '';
    var keys = ['image_url', 'image', 'thumb', 'pic', 'splash_image', 'main_image', 'cover', 'url'];
    for (var j = 0; j < keys.length; j++) {
      if (isHttpUrl(node[keys[j]])) {
        img = node[keys[j]];
        break;
      }
    }
    if (img) out.push({ kind: 'brand', id: id, thumb: img, logo_url: '' });
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    if (node[k] && typeof node[k] === 'object') collectSplashItems(node[k], out, depth + 1);
  }
}

/* 只在字段已存在时替换，避免给元素塞出 App 不认识的结构 */
function setIfExists(obj, key, val) {
  if (!obj || typeof obj !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return false;
  if (obj[key] === val) return false;
  obj[key] = val;
  return true;
}

/* 品牌开屏（x/v2/splash/brand/list）既是候选来源，也是注入点：
   1. 把服务端下发的开屏图存下来，供 H5 页面挑选；
   2. 把选中的开屏图插到 list/show 最前面，App 启动时会拉这张图。 */
function handleBrandSplash(body) {
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
      out.push({ kind: 'brand', id: it.id, thumb: it.thumb, logo_url: it.logo_url || '' });
    }
    if (out.length) mergeSplashList(out);
  }

  var splash = readJSON(KEY_SPLASH, null);
  if (splash && splash.kind !== 'event' && isHttpUrl(splash.thumb)) {
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

/* 活动开屏元素：同时具备前后卡片的图字段才算 */
function collectEventElements(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 10) return;
  if (node instanceof Array) {
    for (var i = 0; i < node.length; i++) collectEventElements(node[i], out, depth + 1);
    return;
  }
  if (isHttpUrl(node.front_image_url) || isHttpUrl(node.back_image_url)) {
    out.push(node);
    return; /* 命中就不再往里钻，避免把嵌套的同名字段重复收集 */
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    try {
      collectEventElements(node[k], out, depth + 1);
    } catch (e) {}
  }
}

/* 活动开屏（x/v2/splash/event/list2）：
   同样一箭双雕——记候选 + 把选中的图铺到每个元素上（App 挑哪个都显示我们的）。
   元素还有视频通道（video_url / second_video_url），不清掉的话换了图也看不到。 */
function handleEventSplash(body) {
  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }
  if (!json || json.code !== 0) return $done({});

  var elements = [];
  collectEventElements(json, elements, 0);

  if (elements.length) {
    var out = [];
    for (var i = 0; i < elements.length && out.length < SPLASH_MAX; i++) {
      var e = elements[i];
      var thumb = e.front_image_url || e.image || e.back_image_url || '';
      if (!isHttpUrl(thumb)) continue;
      out.push({
        kind: 'event',
        id: e.id || out.length + 1,
        name: e.name || '',
        thumb: thumb,
        back: isHttpUrl(e.back_image_url) ? e.back_image_url : ''
      });
    }
    if (out.length) mergeSplashList(out);
  }

  var splash = readJSON(KEY_SPLASH, null);
  if (!splash || splash.kind !== 'event' || !isHttpUrl(splash.thumb)) return $done({});

  var prefs = readPrefs();
  var md5v = splash.md5 || '';
  var changed = false;
  for (var k = 0; k < elements.length; k++) {
    var el = elements[k];
    changed = setIfExists(el, 'front_image_url', splash.thumb) || changed;
    changed = setIfExists(el, 'back_image_url', splash.thumb) || changed;
    changed = setIfExists(el, 'image', splash.thumb) || changed;
    changed = setIfExists(el, 'top_image_url', splash.thumb) || changed;
    changed = setIfExists(el, 'guide_image_url', splash.thumb) || changed;
    if (md5v) {
      changed = setIfExists(el, 'front_image_md5', md5v) || changed;
      changed = setIfExists(el, 'back_image_md5', md5v) || changed;
      changed = setIfExists(el, 'image_md5', md5v) || changed;
      changed = setIfExists(el, 'top_image_md5', md5v) || changed;
      changed = setIfExists(el, 'guide_image_md5', md5v) || changed;
    }
    /* 视频通道：默认清掉强制走图片（否则换了图也被视频盖住）。
       设置里把 splashKeepVideo 打开就保留视频，只换封面。 */
    if (!prefs.splashKeepVideo) {
      if (isHttpUrl(el.video_url)) {
        el.video_url = '';
        if ('video_hash' in el) el.video_hash = '';
        changed = true;
      }
      if (isHttpUrl(el.second_video_url)) {
        el.second_video_url = '';
        if ('second_video_hash' in el) el.second_video_hash = '';
        changed = true;
      }
    }
    /* 刮擦比例可调（-1 = 不动） */
    if (prefs.splashScratch >= 0 && prefs.splashScratch <= 100) {
      changed = setIfExists(el, 'scratch_percent', prefs.splashScratch) || changed;
    }
    /* 开屏时长可调 */
    if (splash.duration > 0) {
      changed = setIfExists(el, 'duration', splash.duration) || changed;
    }
  }

  if (!changed) return $done({});
  $done({ body: JSON.stringify(json) });
}

/* ===================== 7. gRPC（bilibili.vas.garb.service）===================== */

/* 装扮里有一部分走 gRPC，不在 HTTP JSON 里，Surge 默认碰不到：
     bilibili.vas.garb.service / BAPIVasGarbService
       SailingEquipMulti  -> map<mid, UserSailing{ pendant, card_bg, card_bg_with_focus }>
       UserCardMulti      -> map<mid, UserCard{ card_url, big_card_url, ... }>
   走的是 grpc.biliapi.net 上的 HTTP/2。要改它需要：
     1) MITM 里加上 grpc.biliapi.net
     2) [Script] 里给这条挂 binary-body-mode=true（body 以 Uint8Array 进出）
   默认**不启用**——见 BiliSkinGrpc.sgmodule（单独一个可选模块）。
   代码在这里始终存在，规则没挂上就永远不会被调用。

   只改 map 里 key == 自己 mid 的那一条，别人的不动。任何一步解析不确信就原样放行。 */

/* 把 JS 字符串编成 UTF-8 字节（URL 都是 ASCII，够用） */
function strBytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function sliceBytes(bytes, a, b) {
  if (bytes.subarray) return bytes.subarray(a, b);
  var out = new Uint8Array(b - a);
  for (var i = 0; i < out.length; i++) out[i] = bytes[a + i];
  return out;
}

function pbVarint(bytes, pos, end) {
  var shift = 0,
    val = 0;
  while (pos < end) {
    var b = bytes[pos++];
    val += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return { value: val, pos: pos };
    shift += 7;
    if (shift > 56) return null;
  }
  return null;
}

function pbWriteVarint(out, n) {
  n = Math.floor(n);
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n & 0x7f);
}

/* 各层 message 的字段表。sub=子 message，key=map 的键，img=要替换成哪张图 */
var GRPC_SUB = {
  entry: { 1: { key: true }, 2: { sub: 'value' } },
  sailing: { 1: { img: 'pendant' }, 2: { img: 'card' }, 3: { img: 'card' } },
  usercard: { 4: { img: 'card' }, 5: { img: 'card' } }
};

/* 递归走一遍 message。返回 { bytes, changed }，解析不了返回 null。 */
function pbWalk(bytes, start, end, schema, st) {
  var out = [];
  var pos = start;
  var changed = false;
  var key = null;

  while (pos < end) {
    var t = pbVarint(bytes, pos, end);
    if (!t) return null;
    var tag = t.value;
    pos = t.pos;
    var field = Math.floor(tag / 8);
    var wire = tag % 8;
    if (field === 0) return null;

    if (wire === 0) {
      var v = pbVarint(bytes, pos, end);
      if (!v) return null;
      if (schema && schema[field] && schema[field].key) key = String(v.value);
      pbWriteVarint(out, tag);
      pbWriteVarint(out, v.value);
      pos = v.pos;
    } else if (wire === 1) {
      if (pos + 8 > end) return null;
      pbWriteVarint(out, tag);
      for (var i1 = 0; i1 < 8; i1++) out.push(bytes[pos + i1]);
      pos += 8;
    } else if (wire === 5) {
      if (pos + 4 > end) return null;
      pbWriteVarint(out, tag);
      for (var i5 = 0; i5 < 4; i5++) out.push(bytes[pos + i5]);
      pos += 4;
    } else if (wire === 2) {
      var l = pbVarint(bytes, pos, end);
      if (!l) return null;
      var len = l.value;
      var p0 = l.pos;
      var p1 = p0 + len;
      if (p1 > end) return null;
      var spec = schema && schema[field];
      var done = false;

      if (spec && spec.img && st.hit) {
        var repl = spec.img === 'pendant' ? st.pendant : st.card;
        if (repl) {
          var rb = strBytes(repl);
          pbWriteVarint(out, tag);
          pbWriteVarint(out, rb.length);
          for (var ir = 0; ir < rb.length; ir++) out.push(rb[ir]);
          changed = true;
          done = true;
        }
      }

      if (!done && spec && spec.sub) {
        var childSchema;
        var childHit = st.hit;
        if (spec.sub === 'value') {
          childSchema = GRPC_SUB[st.valueSchema];
          childHit = key !== null && key === st.selfMid;
        } else {
          childSchema = GRPC_SUB[spec.sub];
        }
        var sub = pbWalk(bytes, p0, p1, childSchema, {
          selfMid: st.selfMid,
          card: st.card,
          pendant: st.pendant,
          hit: childHit,
          valueSchema: st.valueSchema
        });
        if (sub && sub.changed) {
          pbWriteVarint(out, tag);
          pbWriteVarint(out, sub.bytes.length);
          for (var is = 0; is < sub.bytes.length; is++) out.push(sub.bytes[is]);
          changed = true;
          done = true;
        }
      }

      if (!done) {
        pbWriteVarint(out, tag);
        pbWriteVarint(out, len);
        for (var ic = 0; ic < len; ic++) out.push(bytes[p0 + ic]);
      }
      pos = p1;
    } else {
      return null; /* wire 3/4（group）不支持，整体放弃 */
    }
  }
  return { bytes: out, changed: changed };
}

/* gRPC 帧：[1 字节压缩标志][4 字节大端长度][message]。只处理单帧（一元调用）。 */
function grpcRewrite(bytes, kind, selfMid, card, pendant) {
  if (!bytes || bytes.length < 6) return null;
  var flag = bytes[0];
  var len = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
  if (len <= 0 || 5 + len !== bytes.length) return null;

  var res = pbWalk(bytes, 5, 5 + len, { 1: { sub: 'entry' } }, {
    selfMid: selfMid,
    card: card,
    pendant: pendant,
    hit: false,
    valueSchema: kind
  });
  if (!res || !res.changed) return null;

  var msg = res.bytes;
  var head = [
    flag,
    (msg.length >>> 24) & 0xff,
    (msg.length >>> 16) & 0xff,
    (msg.length >>> 8) & 0xff,
    msg.length & 0xff
  ];
  var all = head.concat(msg);
  var out = new Uint8Array(all.length);
  for (var i = 0; i < all.length; i++) out[i] = all[i];
  return out;
}

/* 兜底模式：schema 不认识时，把 protobuf 里所有 garb 图地址统一换成一张图。
   有「串味」风险（别人的也一起改），所以默认关，设置里开。 */
function looksLikeGarb(bytes, a, b) {
  var s = '';
  var lim = Math.min(b, a + 140);
  for (var i = a; i < lim; i++) s += String.fromCharCode(bytes[i]);
  return /^https?:\/\//.test(s) && s.indexOf('/bfs/garb/') >= 0;
}

function pbReplaceGarb(bytes, start, end, url, depth) {
  if (depth > 8) return null;
  var out = [];
  var pos = start;
  var changed = false;
  while (pos < end) {
    var t = pbVarint(bytes, pos, end);
    if (!t) return null;
    var tag = t.value;
    pos = t.pos;
    var field = Math.floor(tag / 8);
    var wire = tag % 8;
    if (field === 0) return null;

    if (wire === 0) {
      var v = pbVarint(bytes, pos, end);
      if (!v) return null;
      pbWriteVarint(out, tag);
      pbWriteVarint(out, v.value);
      pos = v.pos;
    } else if (wire === 1) {
      if (pos + 8 > end) return null;
      pbWriteVarint(out, tag);
      for (var i1 = 0; i1 < 8; i1++) out.push(bytes[pos + i1]);
      pos += 8;
    } else if (wire === 5) {
      if (pos + 4 > end) return null;
      pbWriteVarint(out, tag);
      for (var i5 = 0; i5 < 4; i5++) out.push(bytes[pos + i5]);
      pos += 4;
    } else if (wire === 2) {
      var l = pbVarint(bytes, pos, end);
      if (!l) return null;
      var len = l.value;
      var p0 = l.pos;
      var p1 = p0 + len;
      if (p1 > end) return null;

      if (len > 20 && len < 400 && looksLikeGarb(bytes, p0, p1)) {
        var rb = strBytes(url);
        pbWriteVarint(out, tag);
        pbWriteVarint(out, rb.length);
        for (var ir = 0; ir < rb.length; ir++) out.push(rb[ir]);
        changed = true;
      } else {
        var sub = pbReplaceGarb(bytes, p0, p1, url, depth + 1);
        if (sub && sub.changed) {
          pbWriteVarint(out, tag);
          pbWriteVarint(out, sub.bytes.length);
          for (var is = 0; is < sub.bytes.length; is++) out.push(sub.bytes[is]);
          changed = true;
        } else {
          pbWriteVarint(out, tag);
          pbWriteVarint(out, len);
          for (var ic = 0; ic < len; ic++) out.push(bytes[p0 + ic]);
        }
      }
      pos = p1;
    } else {
      return null;
    }
  }
  return { bytes: out, changed: changed };
}

function grpcReplaceGarb(bytes, url) {
  if (!bytes || bytes.length < 6) return null;
  var flag = bytes[0];
  var len = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
  if (len <= 0 || 5 + len !== bytes.length) return null;
  var res = pbReplaceGarb(bytes, 5, 5 + len, url, 0);
  if (!res || !res.changed) return null;
  var msg = res.bytes;
  var head = [
    flag,
    (msg.length >>> 24) & 0xff,
    (msg.length >>> 16) & 0xff,
    (msg.length >>> 8) & 0xff,
    msg.length & 0xff
  ];
  var all = head.concat(msg);
  var out = new Uint8Array(all.length);
  for (var i = 0; i < all.length; i++) out[i] = all[i];
  return out;
}

function handleGrpc() {
  var url = ($request && $request.url) || '';

  var kind = null;
  if (/SailingEquipMulti/i.test(url)) kind = 'sailing';
  else if (/UserCardMulti/i.test(url)) kind = 'usercard';

  var equip = readJSON(KEY_EQUIP, null);
  if (!validEquip(equip)) return $done({});
  var card = cardOf(equip);
  var pendant = pendantOf(equip);
  if (!card && !pendant) return $done({});

  var bytes = toBytes($response && $response.body);
  if (!bytes) return $done({});

  /* 已知服务：按 schema 精确改，只动自己那条 */
  if (kind) {
    var self = readJSON(KEY_SELF, null);
    var selfMid = self && self.mid ? String(self.mid) : '';
    if (!selfMid) return $done({});
    var out = null;
    try {
      out = grpcRewrite(bytes, kind, selfMid, card ? card.image : '', pendant ? pendant.image : '');
    } catch (e) {
      return $done({});
    }
    if (!out) return $done({});
    return $done({ body: out });
  }

  /* 未知的 garb 服务：兜底把所有 garb 图地址换掉（默认关） */
  var prefs = readPrefs();
  if (!prefs.grpcAll) return $done({});
  var repl = card ? card.image : pendant ? pendant.image : '';
  if (!repl) return $done({});
  var out2 = null;
  try {
    out2 = grpcReplaceGarb(bytes, repl);
  } catch (e) {
    return $done({});
  }
  if (!out2) return $done({});
  $done({ body: out2 });
}

/* ===================== 8. Chronos 开屏（x/chronos/package/obtain）===================== */

/* Chronos 是 B站那套「动态组件包」系统（开屏 / 挂件 / 直播插件都用它）。
   开屏这条：App 调 x/chronos/package/obtain 拿 {url, md5, sign}，下载 zip 后由
   BFCChronosFileValidator 用**硬编码 RSA 公钥**验签，再比 md5，都过才用。

   ⚠️ 签名是服务端私钥签的，伪造不了 —— 所以**没法注入任意包**。
   能做的是「捕获 + 回放」：把服务端发过的 {url, md5, sign} 存下来，
   之后把响应换成之前存的那一组。三件套原样复用，签名仍然有效。

   字段名（proto bilibili.polymer.chronos.v1）：
     ObtainChronosPackageRsp { md5 = 1; url = 2; sign = 3; }
   本地缓存键（IPA 提取）：chronos.splash_package_url / _md5 / _path，
   下载校验日志：`[PackageDownloader] invalid sign` / `invalid md5` */

function recordChronos(serviceKey, info) {
  var list = readJSON(KEY_CHRONOS_LIST, []);
  if (!(list instanceof Array)) list = [];
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].url === info.url) list.splice(i, 1);
  }
  list.unshift({
    id: info.id || Date.now(),
    service_key: serviceKey || '',
    url: info.url,
    md5: info.md5 || '',
    sign: info.sign || '',
    ts: Date.now()
  });
  if (list.length > SPLASH_MAX) list = list.slice(0, SPLASH_MAX);
  writeJSON(KEY_CHRONOS_LIST, list);
}

function handleChronos() {
  var body = $response && $response.body;
  if (typeof body !== 'string') return $done({});

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return $done({});
  }
  if (!json || json.code !== 0) return $done({});

  /* 响应可能是 { data: {url,md5,sign} }，也可能直接是 {url,md5,sign} */
  var d = null;
  if (json.data && isHttpUrl(json.data.url)) d = json.data;
  else if (isHttpUrl(json.url)) d = json;
  if (!d) return $done({});

  var qs = queryOf($request.url);
  var serviceKey = '';
  var m = /[?&](?:service_key|serviceKey)=([^&]+)/.exec('?' + qs);
  if (m) serviceKey = m[1];

  recordChronos(serviceKey, d);

  var pick = readJSON(KEY_CHRONOS, null);
  if (!pick || !isHttpUrl(pick.url) || !pick.sign) return $done({});
  /* 服务端要哪个 feature 就得给哪个 feature 的包，别串 */
  if (pick.service_key && serviceKey && pick.service_key !== serviceKey) return $done({});

  d.url = pick.url;
  d.md5 = pick.md5 || '';
  d.sign = pick.sign;
  $done({ body: JSON.stringify(json) });
}

/* ---- Chronos 包体本地缓存 ----
   回放只在 CDN 还在时有效。把包也存一份到本地，CDN 撤包后还能顶上。
   包里有 RSA 签名，我们只存不改，签名照样有效。
   需要 MITM 那个 CDN 主机（见 BiliSkinCache.sgmodule）。 */
var KEY_CHRONOS_BLOB = 'BiliSkinChronosBlob';
var CHRONOS_BLOB_MAX = 1500000;

var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64CHARS[b0 >> 2];
    out += B64CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64CHARS[b2 & 63] : '=';
  }
  return out;
}

function b64decode(str) {
  var lut = {};
  for (var i = 0; i < B64CHARS.length; i++) lut[B64CHARS.charAt(i)] = i;
  var out = [];
  var buf = 0;
  var bits = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charAt(j);
    if (c === '=') break;
    var v = lut[c];
    if (v === undefined) continue;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/* 选中 chronos 包时顺手存一份本地副本。超限或拉不到就跳过（只回放 URL）。 */
function cacheChronosBlob(ch, cb) {
  if (!ch || !isHttpUrl(ch.url)) return cb(false);
  if (typeof $httpClient === 'undefined' || !$httpClient.get) return cb(false);
  try {
    $httpClient.get({ url: ch.url, 'binary-mode': true, timeout: 30 }, function (err, resp, data) {
      if (err) return cb(false);
      var bytes = toBytes(data);
      if (!bytes || !bytes.length || bytes.length > CHRONOS_BLOB_MAX) return cb(false);
      var ok = false;
      try {
        ok = writeJSON(KEY_CHRONOS_BLOB, {
          url: ch.url,
          md5: ch.md5 || '',
          size: bytes.length,
          b64: b64encode(bytes)
        });
      } catch (e) {
        ok = false;
      }
      cb(ok);
    });
  } catch (e) {
    cb(false);
  }
}

/* CDN 上的 .cron 请求：本地存了同一份就直接吐本地字节，不再出网。 */
function handleChronosPkg() {
  var blob = readJSON(KEY_CHRONOS_BLOB, null);
  if (!blob || !blob.b64 || !isHttpUrl(blob.url)) return $done({});
  var url = ($request && $request.url) || '';
  if (!url || url.split('?')[0] !== String(blob.url).split('?')[0]) return $done({});
  var bytes;
  try {
    bytes = b64decode(blob.b64);
  } catch (e) {
    return $done({});
  }
  if (!bytes || !bytes.length) return $done({});
  $done({ body: bytes });
}

/* ===================== 分派 ===================== */

/* 注入页面脚本的目标页。
   ⚠️ 这三处必须**同时**覆盖同一批页面，任何一处漂移都会让功能静默失效：
     1) BiliSkinStudio.sgmodule 第 3 条 [Script] 的 pattern（决定脚本会不会被调用）
     2) 这里（决定调用进来后走不走 handleInject）
     3) src/bili_h5.js 的 isTargetPage（决定按钮挂不挂）
   2026-10-18 踩过的坑：模块规则放宽到 /h5/garb/* 之后忘了同步这里，
   抽卡页/数字藏品页虽然命中了规则，却掉进 handleCandidates 被当成 JSON
   解析失败，脚本根本没注入。scripts/test-bili-module.js 会机械校验。 */
var INJECT_RE = /^https?:\/\/www\.bilibili\.com\/(?:h5\/(?:mall|garb)\/|blackboard\/fe\/|garb\/)/;

(function main() {
  var url = ($request && $request.url) || '';

  if (TYPE === 'http-request') return handleBridge();
  if (shouldLogApi(url)) logApi(url, $response && $response.body);
  if (/\/x\/resource\/show\/skin/.test(url)) return handleApply();
  /* 装扮商城/详情/收藏集走 /h5/mall/，抽卡与数字藏品走 /h5/garb/，
     收藏集的「主题套装」预览页与相关活动页走 /blackboard/fe/，
     收藏集大厅走 /garb/。 */
  if (INJECT_RE.test(url)) return handleInject();
  /* 开屏动画（品牌 / 活动 / 新版 business list+show） */
  if (/\/x\/v2\/splash\//.test(url)) return handleSplash();
  /* Chronos 开屏包（只能回放服务端发过的三件套） */
  if (/\/x\/chronos\//.test(url)) return handleChronos();
  /* 收藏集开屏 */
  if (/\/x\/vas\/dlc_act\/card\/splash_info/.test(url)) return handleCollectSplash();
  /* 评论 / 动态：换自己的评论装扮与头像挂件。
     动态信息流走 x/polymer/web-dynamic（旧代码只写了 x/dynamic，所以动态一直没生效）。 */
  if (/\/x\/(?:v2\/reply|dynamic|polymer\/web-dynamic|polymer\/v2\/dynamic)/.test(url)) return handleCard();
  /* gRPC 装扮服务（需 MITM grpc.biliapi.net，第 9 条规则） */
  if (/^https?:\/\/grpc\.biliapi\.net\//.test(url)) return handleGrpc();
  /* Chronos 包体本地缓存（第 10 条规则） */
  if (/\.cron(\?|$)/.test(url)) return handleChronosPkg();
  /* 剩下的 garb / vas 一律挖候选：套装、收藏集兑换物、已拥有资产，
     空间/我的页那类接口还会顺带按字段名换图。 */
  return handleCandidates(url);
})();
