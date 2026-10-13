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
var H5_PAYLOAD = "/*\n * 哔哩哔哩装扮工作室 —— 注入到 www.bilibili.com/h5/mall/* 的页面脚本\n *\n * 按钮只有一个：「应用装扮」。点它就去**扫描当前页面**上出现的装扮，而不是翻全站目录。\n * 候选来自四个地方，按可靠性排序：\n *   1. Surge 嗅探到的接口响应（本页加载过的 x/garb/* x/vas/* 里含装扮包的条目）\n *   2. 页面 JS 状态（__INITIAL_MIRROR__ / __INITIAL_STATE__ 等）里递归找出的装扮对象\n *   3. DOM 里指向装扮详情页的链接\n *   4. 当前 URL 的参数\n *\n * 拿到候选后：1 个直接应用，多个弹选择列表，0 个给空状态（可清除注入 / 从藏馆里挑）。\n *\n * 与 Surge 的通信走 https://app.bilibili.com/x/surge-skin/ （由 Surge 假响应接管）\n */\n(function () {\n  'use strict';\n  if (window.__BSS_LOADED__) return;\n  window.__BSS_LOADED__ = true;\n\n  var BRIDGE = 'https://app.bilibili.com/x/surge-skin/';\n  var API = 'https://api.bilibili.com';\n  var PINK = '#fb7299';\n  var THUMB = '@360w_360h_1c.webp';\n  var POS_KEY = 'bss_btn_pos';\n  var MAX_RESOLVE = 8;\n\n  /* 本页进入时间：用来过滤 Surge 嗅探到的候选，只留当前页面的。\n     注入点选在 </head>，所以这个时间早于 SPA 发起请求。 */\n  var enterTs = Date.now();\n\n  /* ===================== 基础工具 ===================== */\n\n  function mk(tag, css, html) {\n    var e = document.createElement(tag);\n    if (css) e.setAttribute('style', css);\n    if (html != null) e.innerHTML = html;\n    return e;\n  }\n\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n\n  function thumb(url) {\n    if (!url) return '';\n    if (!/hdslb\\.com/.test(url)) return url;\n    return url + THUMB;\n  }\n\n  function idFrom(str) {\n    var m = /(?:id|item_id|suit_id|act_id)=(\\d+)/.exec(String(str || ''));\n    return m ? m[1] : '';\n  }\n\n  function jget(url) {\n    return fetch(url, { credentials: 'include' }).then(function (r) {\n      return r.json();\n    });\n  }\n\n  /* ===================== Surge 桥 ===================== */\n\n  function bget(path) {\n    return fetch(BRIDGE + path, { credentials: 'omit' }).then(function (r) {\n      return r.json();\n    });\n  }\n  function bpost(path, obj) {\n    return fetch(BRIDGE + path, {\n      method: 'POST',\n      credentials: 'omit',\n      headers: { 'Content-Type': 'text/plain' },\n      body: JSON.stringify(obj)\n    }).then(function (r) {\n      return r.json();\n    });\n  }\n\n  function bridgeSet(equip) {\n    return bpost('set', equip);\n  }\n  function bridgeGet() {\n    return bget('get');\n  }\n  function bridgeClear() {\n    return bget('clear');\n  }\n  function bridgeGallery() {\n    return bget('gallery');\n  }\n  function bridgeGalleryAdd(equip) {\n    return bpost('gallery/add', equip);\n  }\n  function bridgeSeen(since) {\n    return bget('seen?since=' + (since || 0));\n  }\n\n  /* ===================== B 站接口 ===================== */\n\n  function apiSuitDetail(id) {\n    return jget(API + '/x/garb/mall/item/suit/v2?part=suit&item_id=' + id);\n  }\n\n  /* ===================== 纯逻辑（可测试） ===================== */\n\n  /* 一个「容器 + skin 子项」-> user_equip 配置 */\n  function equipFrom(container, skin) {\n    var p = (skin && skin.properties) || {};\n    if (!p.package_url) return null;\n    var item = (container && container.item) || {};\n    return {\n      id: item.item_id || (skin && skin.item_id) || 0,\n      name: item.name || (skin && skin.name) || '',\n      preview: p.image_preview || p.image_cover || '',\n      ver: Number(p.ver) || 1700000000,\n      package_url: p.package_url,\n      package_md5: p.package_md5 || '',\n      data: {\n        color_mode: p.color_mode || 'light',\n        color: p.color || '#212121',\n        color_second_page: p.color_second_page || '#ffffff',\n        side_bg_color: p.side_bg_color || p.color_second_page || '#ffffff',\n        tail_color: p.tail_color || '#996c00',\n        tail_color_selected: p.tail_color_selected || '#0d6872',\n        tail_icon_ani: String(p.tail_icon_ani) === 'true',\n        tail_icon_ani_mode: p.tail_icon_ani_mode || 'once',\n        tail_icon_mode: p.tail_icon_mode || 'img'\n      }\n    };\n  }\n\n  /* 装扮详情响应 -> user_equip 配置 */\n  function toEquip(d) {\n    var da = d && d.data;\n    if (!da) return null;\n    var skins = (da.suit_items && da.suit_items.skin) || [];\n    return equipFrom(da, skins[0]);\n  }\n\n  /* 递归找出所有「带装扮包的容器」 */\n  function harvest(node, out, depth) {\n    if (!node || typeof node !== 'object' || depth > 9) return;\n    if (Array.isArray(node)) {\n      for (var i = 0; i < node.length; i++) harvest(node[i], out, depth + 1);\n      return;\n    }\n    if (node.suit_items && typeof node.suit_items === 'object') {\n      var skins = node.suit_items.skin;\n      if (Array.isArray(skins)) {\n        for (var j = 0; j < skins.length; j++) {\n          var e = equipFrom(node, skins[j]);\n          if (e) out.push(e);\n        }\n      }\n    }\n    for (var k in node) {\n      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;\n      try {\n        harvest(node[k], out, depth + 1);\n      } catch (e) {}\n    }\n  }\n\n  function scanState(win) {\n    var out = [];\n    var roots = [\n      win.__INITIAL_MIRROR__,\n      win.__INITIAL_STATE__,\n      win.__NUXT__,\n      win.__PRELOADED_STATE__,\n      win.__DATA__,\n      win.__GARB_DATA__\n    ];\n    for (var i = 0; i < roots.length; i++) {\n      if (roots[i]) harvest(roots[i], out, 0);\n    }\n    return out;\n  }\n\n  /* 从 URL 与 DOM 里收集「可能指向装扮」的 id */\n  function collectIds(doc, loc) {\n    var seen = {};\n    var out = [];\n    function add(v) {\n      var s = String(v == null ? '' : v).replace(/\\D/g, '');\n      if (!s || s.length < 3 || seen[s]) return;\n      seen[s] = 1;\n      out.push(s);\n    }\n\n    var s = (loc.search || '') + '&' + (loc.hash || '');\n    var re = /[?&](?:id|item_id|suit_id)=(\\d+)/g;\n    var m;\n    while ((m = re.exec(s)) !== null) add(m[1]);\n\n    try {\n      var links = doc.querySelectorAll ? doc.querySelectorAll('a[href]') : [];\n      for (var i = 0; i < links.length; i++) {\n        var href = links[i].getAttribute('href') || '';\n        if (!/suit\\/detail|mall/i.test(href)) continue;\n        add(idFrom(href));\n      }\n    } catch (e) {}\n\n    return out.slice(0, MAX_RESOLVE);\n  }\n\n  function mergeById() {\n    var out = [];\n    var seen = {};\n    for (var i = 0; i < arguments.length; i++) {\n      var list = arguments[i] || [];\n      for (var j = 0; j < list.length; j++) {\n        var e = list[j];\n        if (!e || !e.id || !e.package_url || seen[e.id]) continue;\n        seen[e.id] = 1;\n        out.push(e);\n      }\n    }\n    return out;\n  }\n\n  /* ===================== 候选收集 ===================== */\n\n  async function collectCandidates() {\n    var stateHits = [];\n    try {\n      stateHits = scanState(window);\n    } catch (e) {}\n\n    var sniffed = [];\n    try {\n      var r = await bridgeSeen(enterTs);\n      sniffed = (r && r.data) || [];\n    } catch (e) {}\n\n    var merged = mergeById(sniffed, stateHits);\n\n    var ids = collectIds(document, location);\n    for (var i = 0; i < ids.length; i++) {\n      var dup = false;\n      for (var k = 0; k < merged.length; k++) {\n        if (String(merged[k].id) === ids[i]) {\n          dup = true;\n          break;\n        }\n      }\n      if (dup) continue;\n      try {\n        var e = toEquip(await apiSuitDetail(ids[i]));\n        if (e) merged.push(e);\n      } catch (err) {}\n    }\n\n    return merged;\n  }\n\n  /* ===================== 应用 ===================== */\n\n  async function applyEquip(equip) {\n    try {\n      await bridgeGalleryAdd(equip);\n    } catch (e) {}\n    var r = await bridgeSet(equip);\n    if (!r || r.code !== 0) throw new Error((r && r.msg) || '保存失败');\n    return equip;\n  }\n\n  /* ===================== 提示 ===================== */\n\n  var toastEl = null;\n  function toast(msg, ok) {\n    if (toastEl) toastEl.remove();\n    toastEl = mk(\n      'div',\n      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;' +\n        'max-width:76vw;padding:12px 18px;border-radius:12px;font-size:14px;line-height:1.5;' +\n        'color:#fff;text-align:center;white-space:pre-line;word-break:break-word;' +\n        'background:' + (ok ? 'rgba(0,0,0,.82)' : 'rgba(214,48,49,.92)') +\n        ';-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)',\n      esc(msg)\n    );\n    document.body.appendChild(toastEl);\n    setTimeout(function () {\n      if (toastEl) {\n        toastEl.remove();\n        toastEl = null;\n      }\n    }, 2400);\n  }\n\n  /* ===================== 卡片 ===================== */\n\n  function cardHtml(it) {\n    return (\n      '<div data-id=\"' + it.id + '\" style=\"background:#fff;border-radius:12px;overflow:hidden;' +\n      'box-shadow:0 1px 6px rgba(0,0,0,.07);cursor:pointer\">' +\n      '<div style=\"position:relative;width:100%;aspect-ratio:1/1;background:#f4f4f5;overflow:hidden\">' +\n      (it.preview\n        ? '<img src=\"' + esc(thumb(it.preview)) + '\" loading=\"lazy\" ' +\n          'style=\"display:block;width:100%;height:100%;object-fit:cover\">'\n        : '') +\n      '</div>' +\n      '<div style=\"padding:8px 10px 10px\">' +\n      '<div style=\"font-size:13px;line-height:1.35;color:#18191c;overflow:hidden;' +\n      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:35px\">' +\n      esc(it.name) + '</div>' +\n      '<div data-apply=\"' + it.id + '\" style=\"margin-top:8px;height:30px;line-height:30px;' +\n      'text-align:center;border-radius:15px;background:' + PINK + ';color:#fff;font-size:12px\">' +\n      '应用</div>' +\n      '</div></div>'\n    );\n  }\n\n  /* ===================== 面板 ===================== */\n\n  var panel = null;\n\n  function closePanel() {\n    if (panel) {\n      panel.remove();\n      panel = null;\n    }\n  }\n\n  /* 通用底部面板：标题 + 副标题 + 网格 + 右上角动作 */\n  function openSheet(title, subtitle, actions, bodyHtml) {\n    closePanel();\n\n    panel = mk(\n      'div',\n      'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);' +\n        'display:flex;align-items:flex-end'\n    );\n\n    var sheet = mk(\n      'div',\n      'width:100%;max-height:82vh;background:#fff;border-radius:16px 16px 0 0;' +\n        'display:flex;flex-direction:column;overflow:hidden;' +\n        'font-family:-apple-system,system-ui,sans-serif'\n    );\n\n    var actionHtml = (actions || [])\n      .map(function (a) {\n        return (\n          '<span data-act=\"' + esc(a.key) + '\" style=\"font-size:12px;color:' +\n          (a.pink ? PINK : '#9499a0') + ';margin-left:14px\">' + esc(a.label) + '</span>'\n        );\n      })\n      .join('');\n\n    sheet.innerHTML =\n      '<div style=\"flex:none;padding:16px 16px 10px\">' +\n      '<div style=\"display:flex;align-items:flex-start;justify-content:space-between\">' +\n      '<div style=\"flex:1;min-width:0\">' +\n      '<div style=\"font-size:16px;font-weight:600;color:#18191c\">' + esc(title) + '</div>' +\n      (subtitle\n        ? '<div style=\"margin-top:4px;font-size:12px;color:#9499a0\">' + esc(subtitle) + '</div>'\n        : '') +\n      '</div>' +\n      '<div style=\"flex:none;padding-left:10px\">' + actionHtml +\n      '<span data-act=\"close\" style=\"font-size:20px;color:#9499a0;margin-left:14px;' +\n      'line-height:1\">&times;</span></div>' +\n      '</div></div>' +\n      '<div id=\"bss-body\" style=\"flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;' +\n      'padding:0 16px calc(env(safe-area-inset-bottom,0px) + 20px)\">' + bodyHtml + '</div>';\n\n    panel.appendChild(sheet);\n    panel.addEventListener('click', function (e) {\n      if (e.target === panel) closePanel();\n    });\n    document.body.appendChild(panel);\n    return sheet;\n  }\n\n  function gridHtml(list) {\n    return (\n      '<div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:12px\">' +\n      list.map(cardHtml).join('') +\n      '</div>'\n    );\n  }\n\n  function emptyHtml(text) {\n    return (\n      '<div style=\"padding:44px 0;text-align:center;color:#9499a0;font-size:13px;' +\n      'line-height:1.7\">' + esc(text) + '</div>'\n    );\n  }\n\n  /* 选中列表：1 个直接应用，多个弹选择 */\n  async function runApply() {\n    if (!launcher) return;\n    launcher.textContent = '扫描中…';\n    launcher.style.opacity = '.7';\n\n    var list;\n    try {\n      list = await collectCandidates();\n    } catch (e) {\n      list = [];\n    }\n\n    launcher.textContent = '应用装扮';\n    launcher.style.opacity = '1';\n\n    if (list.length === 0) return showEmpty();\n    if (list.length === 1) return doApply(list[0]);\n\n    openSheet('选择要应用的装扮', '本页找到 ' + list.length + ' 套，点「应用」生效', [], gridHtml(list));\n    bindGridActions(panel.querySelector('#bss-body'), list);\n  }\n\n  function bindGridActions(root, list) {\n    if (!root) return;\n    root.addEventListener('click', function (e) {\n      var ap = e.target.closest && e.target.closest('[data-apply]');\n      var card = ap || (e.target.closest && e.target.closest('[data-id]'));\n      if (!card) return;\n      var id = card.getAttribute('data-apply') || card.getAttribute('data-id');\n      var hit = null;\n      for (var i = 0; i < list.length; i++) {\n        if (String(list[i].id) === String(id)) {\n          hit = list[i];\n          break;\n        }\n      }\n      if (hit) {\n        closePanel();\n        doApply(hit);\n      }\n    });\n  }\n\n  async function doApply(equip) {\n    if (launcher) launcher.textContent = '注入中…';\n    try {\n      await applyEquip(equip);\n      if (launcher) launcher.textContent = '已应用';\n      toast('已注入「' + equip.name + '」\\n杀掉后台重进 B 站即可生效', true);\n    } catch (e) {\n      toast('失败：' + e.message);\n    }\n    setTimeout(function () {\n      if (launcher) launcher.textContent = '应用装扮';\n    }, 2600);\n  }\n\n  /* 本页没找到：给清除入口 + 藏馆里之前用过的 */\n  async function showEmpty() {\n    var cur = null;\n    var gal = [];\n    try {\n      var g = await bridgeGet();\n      cur = g && g.data;\n    } catch (e) {}\n    try {\n      var r = await bridgeGallery();\n      gal = (r && r.data) || [];\n    } catch (e) {}\n\n    var acts = [];\n    if (cur && cur.name) acts.push({ key: 'clear', label: '清除注入', pink: true });\n\n    var body =\n      emptyHtml('本页没找到可用的装扮。\\n到装扮详情页或收藏集页再试一次。') +\n      (gal.length\n        ? '<div style=\"margin:2px 0 10px;font-size:13px;color:#61666d\">藏馆 · 之前应用过的</div>' +\n          gridHtml(gal)\n        : '');\n\n    openSheet('应用装扮', cur && cur.name ? '当前：' + cur.name : '', acts, body);\n    bindGridActions(panel.querySelector('#bss-body'), gal);\n\n    var clearBtn = panel.querySelector('[data-act=\"clear\"]');\n    if (clearBtn) {\n      clearBtn.addEventListener('click', async function () {\n        await bridgeClear();\n        closePanel();\n        toast('已清除注入的装扮', true);\n      });\n    }\n  }\n\n  /* ===================== 悬浮按钮（可拖动） ===================== */\n\n  var launcher = null;\n\n  function mountLauncher() {\n    if (launcher) return;\n    var saved = null;\n    try {\n      saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');\n    } catch (e) {}\n\n    var pos =\n      saved && saved.left != null\n        ? 'left:' + saved.left + 'px;top:' + saved.top + 'px;'\n        : 'left:56px;top:calc(env(safe-area-inset-top,0px) + 8px);';\n\n    launcher = mk(\n      'div',\n      'position:fixed;z-index:2147483000;' + pos +\n        'padding:7px 14px;border-radius:20px;background:' + PINK + ';color:#fff;' +\n        'font-size:12px;font-weight:500;font-family:-apple-system,system-ui,sans-serif;' +\n        'box-shadow:0 4px 16px rgba(251,114,153,.45);cursor:pointer;white-space:nowrap;' +\n        'user-select:none;-webkit-user-select:none;touch-action:none;' +\n        '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)',\n      '应用装扮'\n    );\n\n    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;\n\n    function down(e) {\n      var t = e.touches ? e.touches[0] : e;\n      var r = launcher.getBoundingClientRect();\n      dragging = true;\n      moved = false;\n      sx = t.clientX;\n      sy = t.clientY;\n      ox = r.left;\n      oy = r.top;\n      launcher.style.left = ox + 'px';\n      launcher.style.top = oy + 'px';\n    }\n    function move(e) {\n      if (!dragging) return;\n      var t = e.touches ? e.touches[0] : e;\n      var dx = t.clientX - sx;\n      var dy = t.clientY - sy;\n      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;\n      moved = true;\n      if (e.cancelable) e.preventDefault();\n      var w = launcher.offsetWidth;\n      var h = launcher.offsetHeight;\n      launcher.style.left = Math.min(Math.max(ox + dx, 4), window.innerWidth - w - 4) + 'px';\n      launcher.style.top = Math.min(Math.max(oy + dy, 4), window.innerHeight - h - 4) + 'px';\n    }\n    function up() {\n      if (!dragging) return;\n      dragging = false;\n      if (moved) {\n        var r = launcher.getBoundingClientRect();\n        try {\n          localStorage.setItem(\n            POS_KEY,\n            JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })\n          );\n        } catch (e) {}\n      } else {\n        runApply();\n      }\n    }\n\n    launcher.addEventListener('touchstart', down, { passive: true });\n    launcher.addEventListener('touchmove', move, { passive: false });\n    launcher.addEventListener('touchend', up);\n    launcher.addEventListener('mousedown', down);\n    document.addEventListener('mousemove', move);\n    document.addEventListener('mouseup', up);\n\n    document.body.appendChild(launcher);\n  }\n\n  /* ===================== 路由 ===================== */\n\n  var lastPath = '';\n\n  function markEnter() {\n    enterTs = Date.now();\n  }\n\n  function route() {\n    var p = (location.pathname || '') + (location.hash || '');\n    if (!/h5\\/mall/.test(p)) {\n      if (launcher) {\n        launcher.remove();\n        launcher = null;\n      }\n      lastPath = '';\n      return;\n    }\n    var key = location.pathname + location.search + location.hash;\n    if (key === lastPath) return;\n    lastPath = key;\n    closePanel();\n    mountLauncher();\n  }\n\n  ['pushState', 'replaceState'].forEach(function (m) {\n    var orig = history[m];\n    if (typeof orig !== 'function') return;\n    history[m] = function () {\n      markEnter();\n      var r = orig.apply(this, arguments);\n      setTimeout(route, 0);\n      return r;\n    };\n  });\n  window.addEventListener('popstate', function () {\n    markEnter();\n    setTimeout(route, 0);\n  });\n  window.addEventListener('hashchange', function () {\n    markEnter();\n    setTimeout(route, 0);\n  });\n  setInterval(route, 800);\n\n  if (document.body) route();\n  else document.addEventListener('DOMContentLoaded', route);\n\n  /* 测试钩子 */\n  window.__BSS_API__ = {\n    idFrom: idFrom,\n    thumb: thumb,\n    equipFrom: equipFrom,\n    toEquip: toEquip,\n    harvest: harvest,\n    scanState: scanState,\n    collectIds: collectIds,\n    mergeById: mergeById,\n    cardHtml: cardHtml,\n    enterTs: function () {\n      return enterTs;\n    },\n    markEnter: markEnter\n  };\n})();\n";

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
  if (/^https?:\/\/www\.bilibili\.com\/h5\/mall\//.test(url)) return handleInject();
  return handleSniff();
})();
