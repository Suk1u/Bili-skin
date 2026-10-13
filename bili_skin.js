/*
 * 哔哩哔哩装扮工作室 —— Surge 侧
 *
 * 同一个文件被三条 [Script] 引用，按 $script.type + URL 分派：
 *   1. http-request  app.bilibili.com/x/surge-skin/*   -> H5 页面与 Surge 的通信桥
 *   2. http-response app.bilibili.com/x/resource/show/skin -> 替换「当前装扮」
 *   3. http-response www.bilibili.com/h5/mall/*        -> 注入页面增强脚本
 *
 * 本文件由 scripts/build-bili.js 从 src/bili_skin.src.js 生成，请勿直接改 dist 里的产物。
 */

var KEY_EQUIP = 'BiliSkinEquip';
var KEY_GALLERY = 'BiliSkinGallery';
var GALLERY_MAX = 300;

/* 由构建脚本内联的 H5 页面脚本 */
var H5_PAYLOAD = "/*\n * 哔哩哔哩装扮工作室 —— 注入到 www.bilibili.com/h5/mall/* 的页面脚本\n *\n * 跑在 B 站自己的 H5 页面里（同源，CORS 已放开），负责：\n *   1. 商城页：悬浮按钮 -> 拉取全量装扮目录 -> 面板浏览（含藏馆里的绝版装扮）\n *   2. 详情页：左上角按钮 -> 解析当前装扮 -> 组装配置 -> 交给 Surge 存起来\n *\n * 与 Surge 的通信走 https://app.bilibili.com/x/surge-skin/ （由 Surge 假响应接管）\n */\n(function () {\n  'use strict';\n  if (window.__BSS_LOADED__) return;\n  window.__BSS_LOADED__ = true;\n\n  var BRIDGE = 'https://app.bilibili.com/x/surge-skin/';\n  var API = 'https://api.bilibili.com';\n  var PINK = '#fb7299';\n  var CACHE_KEY = 'bss_catalog_v1';\n  var CACHE_TTL = 86400000;\n  var POS_KEY = 'bss_btn_pos';\n\n  /* ===================== 基础工具 ===================== */\n\n  function mk(tag, css, html) {\n    var e = document.createElement(tag);\n    if (css) e.setAttribute('style', css);\n    if (html != null) e.innerHTML = html;\n    return e;\n  }\n\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n\n  /* 从 URL（含 hash 路由）里取装扮 id */\n  function qid() {\n    var hash = location.hash || '';\n    var qi = hash.indexOf('?');\n    var s = (location.search || '') + '&' + (qi >= 0 ? hash.slice(qi) : '');\n    var m = /[?&](?:id|item_id|suit_id)=(\\d+)/.exec(s);\n    return m ? m[1] : '';\n  }\n\n  /* 当前页面类型 */\n  function page() {\n    var p = (location.pathname || '') + (location.hash || '');\n    if (/suit\\/detail/.test(p)) return 'detail';\n    if (/h5\\/mall/.test(p)) return 'mall';\n    return 'other';\n  }\n\n  function jget(url) {\n    return fetch(url, { credentials: 'include' }).then(function (r) {\n      return r.json();\n    });\n  }\n\n/* ===================== Surge 桥 ===================== */\n/* 桥请求不带凭据，Surge 侧回 Access-Control-Allow-Origin: * 即可 */\n\nfunction bget(path) {\n  return fetch(BRIDGE + path, { credentials: 'omit' }).then(function (r) {\n    return r.json();\n  });\n}\nfunction bpost(path, obj) {\n  return fetch(BRIDGE + path, {\n    method: 'POST',\n    credentials: 'omit',\n    headers: { 'Content-Type': 'text/plain' },\n    body: JSON.stringify(obj)\n  }).then(function (r) {\n    return r.json();\n  });\n}\n\nfunction bridgeSet(equip) {\n  return bpost('set', equip);\n}\nfunction bridgeGet() {\n  return bget('get');\n}\nfunction bridgeClear() {\n  return bget('clear');\n}\nfunction bridgeGallery() {\n  return bget('gallery');\n}\nfunction bridgeGalleryAdd(equip) {\n  return bpost('gallery/add', equip);\n}\n\n  /* ===================== B 站接口 ===================== */\n\n  function apiSuitDetail(id) {\n    return jget(API + '/x/garb/mall/item/suit/v2?part=suit&item_id=' + id);\n  }\n  function apiSuitAll() {\n    return jget(API + '/x/garb/mall/suit/all');\n  }\n\n  /* ===================== 纯逻辑（可测试） ===================== */\n\n  /* 详情响应 -> user_equip 配置 */\n  function toEquip(d) {\n    var da = d && d.data;\n    if (!da) return null;\n    var item = da.item || {};\n    var skins = (da.suit_items && da.suit_items.skin) || [];\n    var p = (skins[0] && skins[0].properties) || {};\n    if (!p.package_url) return null;\n    return {\n      id: item.item_id || skins[0].item_id || 0,\n      name: item.name || skins[0].name || '',\n      preview: p.image_preview || p.image_cover || '',\n      ver: Number(p.ver) || 1700000000,\n      package_url: p.package_url,\n      package_md5: p.package_md5 || '',\n      data: {\n        color_mode: p.color_mode || 'light',\n        color: p.color || '#212121',\n        color_second_page: p.color_second_page || '#ffffff',\n        side_bg_color: p.side_bg_color || p.color_second_page || '#ffffff',\n        tail_color: p.tail_color || '#996c00',\n        tail_color_selected: p.tail_color_selected || '#0d6872',\n        tail_icon_ani: String(p.tail_icon_ani) === 'true',\n        tail_icon_ani_mode: p.tail_icon_ani_mode || 'once',\n        tail_icon_mode: p.tail_icon_mode || 'img'\n      }\n    };\n  }\n\n  /* 全量目录响应 -> 扁平列表 */\n  function mapCatalog(raw) {\n    var out = [];\n    var cats = (raw && raw.data && raw.data.category) || [];\n    cats.forEach(function (c) {\n      (c.suits || []).forEach(function (s) {\n        var p = s.properties || {};\n        out.push({\n          id: s.item_id,\n          name: s.name,\n          cover: p.image_cover || '',\n          cat: c.name,\n          paid: Number(p.sale_bp_forever_raw || 0) > 0,\n          live: true\n        });\n      });\n    });\n    return out;\n  }\n\n  /* 把藏馆里的绝版装扮并进列表 */\n  function mergeGallery(list, gallery) {\n    var seen = {};\n    (list || []).forEach(function (x) {\n      seen[x.id] = 1;\n    });\n    (gallery || []).forEach(function (g) {\n      if (!g || !g.id || seen[g.id]) return;\n      seen[g.id] = 1;\n      list.push({\n        id: g.id,\n        name: g.name,\n        cover: g.preview || '',\n        cat: '藏馆',\n        paid: false,\n        live: false,\n        equip: g\n      });\n    });\n    return list;\n  }\n\n  /* ===================== 提示条 ===================== */\n\n  var toastEl = null;\n  function toast(msg, ok) {\n    if (toastEl) toastEl.remove();\n    toastEl = mk(\n      'div',\n      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;' +\n        'max-width:76vw;padding:12px 18px;border-radius:12px;font-size:14px;line-height:1.5;' +\n        'color:#fff;text-align:center;background:' +\n        (ok ? 'rgba(0,0,0,.82)' : 'rgba(214,48,49,.92)') +\n        ';box-shadow:0 8px 28px rgba(0,0,0,.3);word-break:break-all;' +\n        '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)',\n      esc(msg)\n    );\n    document.body.appendChild(toastEl);\n    setTimeout(function () {\n      if (toastEl) {\n        toastEl.remove();\n        toastEl = null;\n      }\n    }, 2200);\n  }\n\n  /* ===================== 装扮目录（带缓存） ===================== */\n\n  var catalogCache = null;\n\n  function loadCatalog(force) {\n    if (catalogCache && !force) return Promise.resolve(catalogCache);\n    if (!force) {\n      try {\n        var raw = localStorage.getItem(CACHE_KEY);\n        if (raw) {\n          var c = JSON.parse(raw);\n          if (c && c.ts && Date.now() - c.ts < CACHE_TTL && c.list) {\n            catalogCache = c.list;\n            return Promise.resolve(catalogCache);\n          }\n        }\n      } catch (e) {}\n    }\n    return apiSuitAll().then(function (r) {\n      var list = mapCatalog(r);\n      catalogCache = list;\n      try {\n        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list: list }));\n      } catch (e) {}\n      return list;\n    });\n  }\n\n  function loadAll(force) {\n    return Promise.all([loadCatalog(force), bridgeGallery().catch(function () { return null; })])\n      .then(function (res) {\n        var list = mergeGallery(res[0].slice(), (res[1] && res[1].data) || []);\n        return list;\n      });\n  }\n\n  /* ===================== 应用装扮 ===================== */\n\n  function applyEquip(equip) {\n    return bridgeSet(equip).then(function (r) {\n      if (r && r.code === 0) return equip;\n      throw new Error((r && r.msg) || '保存失败');\n    });\n  }\n\n  /* 按 id 直接应用（面板里用，省去进详情页） */\n  function applyById(id) {\n    return apiSuitDetail(id)\n      .then(function (d) {\n        var equip = toEquip(d);\n        if (!equip) throw new Error('这个装扮拿不到装扮包，可能已彻底下架');\n        return applyEquip(equip);\n      })\n      .then(function (equip) {\n        toast('已注入「' + equip.name + '」\\n杀掉后台重进 B 站即可生效', true);\n      })\n      .catch(function (e) {\n        toast('失败：' + e.message);\n      });\n  }\n\n  /* ===================== 面板 UI ===================== */\n\n  var panel = null;\n\n  function closePanel() {\n    if (panel) {\n      panel.remove();\n      panel = null;\n    }\n  }\n\n  function cardHtml(it) {\n    var badge = !it.live\n      ? '<span style=\"position:absolute;left:0;top:0;padding:2px 6px;border-radius:0 0 8px 0;' +\n        'font-size:10px;color:#fff;background:#8a8a8a\">绝版</span>'\n      : it.paid\n      ? '<span style=\"position:absolute;right:0;top:0;padding:2px 6px;border-radius:0 0 0 8px;' +\n        'font-size:10px;color:#fff;background:' + PINK + '\">付费</span>'\n      : '';\n    return (\n      '<div data-id=\"' + it.id + '\" style=\"position:relative;border-radius:10px;overflow:hidden;' +\n      'background:#f4f4f5;cursor:pointer\">' +\n      badge +\n      '<div style=\"width:100%;padding-top:100%;position:relative;overflow:hidden\">' +\n      (it.cover\n        ? '<img src=\"' + esc(it.cover) + '@120w_120h_1c.webp\" loading=\"lazy\" ' +\n          'style=\"position:absolute;inset:0;width:100%;height:100%;object-fit:cover\">'\n        : '') +\n      '</div>' +\n      '<div style=\"padding:6px 8px 8px\">' +\n      '<div style=\"font-size:12px;color:#18191c;line-height:1.3;overflow:hidden;' +\n      'text-overflow:ellipsis;white-space:nowrap\">' + esc(it.name) + '</div>' +\n      '<div style=\"margin-top:3px;display:flex;align-items:center;justify-content:space-between\">' +\n      '<span style=\"font-size:10px;color:#9499a0\">' + esc(it.cat) + '</span>' +\n      '<span data-apply=\"' + it.id + '\" style=\"font-size:10px;color:' + PINK + ';' +\n      'padding:2px 6px;border:1px solid ' + PINK + ';border-radius:20px\">应用</span>' +\n      '</div></div></div>'\n    );\n  }\n\n  function openPanel() {\n    if (panel) return closePanel();\n\n    panel = mk(\n      'div',\n      'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);' +\n        '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;' +\n        'align-items:flex-end'\n    );\n\n    var sheet = mk(\n      'div',\n      'width:100%;height:88vh;background:#fff;border-radius:16px 16px 0 0;display:flex;' +\n        'flex-direction:column;overflow:hidden;font-family:-apple-system,system-ui,sans-serif'\n    );\n\n    sheet.innerHTML =\n      '<div style=\"flex:none;padding:14px 16px 8px\">' +\n      '<div style=\"display:flex;align-items:center;justify-content:space-between\">' +\n      '<b style=\"font-size:16px;color:#18191c\">全部装扮</b>' +\n      '<div>' +\n      '<span id=\"bss-cur\" style=\"font-size:11px;color:#9499a0;margin-right:12px\"></span>' +\n      '<span id=\"bss-clear\" style=\"font-size:11px;color:#9499a0;margin-right:12px\">清除注入</span>' +\n      '<span id=\"bss-close\" style=\"font-size:20px;color:#9499a0;line-height:1\">&times;</span>' +\n      '</div></div>' +\n      '<input id=\"bss-q\" placeholder=\"搜索装扮名 / 输入 ID 直接应用\" ' +\n      'style=\"margin-top:10px;width:100%;box-sizing:border-box;height:34px;padding:0 12px;' +\n      'border:none;border-radius:17px;background:#f4f4f5;font-size:13px;outline:none\">' +\n      '<div id=\"bss-cats\" style=\"margin-top:10px;display:flex;gap:8px;overflow-x:auto;' +\n      'white-space:nowrap;-webkit-overflow-scrolling:touch\"></div>' +\n      '</div>' +\n      '<div id=\"bss-grid\" style=\"flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;' +\n      'padding:4px 16px 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px\"></div>';\n\n    panel.appendChild(sheet);\n    panel.addEventListener('click', function (e) {\n      if (e.target === panel) closePanel();\n    });\n    document.body.appendChild(panel);\n\n    var grid = sheet.querySelector('#bss-grid');\n    var cats = sheet.querySelector('#bss-cats');\n    var q = sheet.querySelector('#bss-q');\n    var cur = sheet.querySelector('#bss-cur');\n    var state = { list: [], cat: '全部', kw: '' };\n\n    function renderCats() {\n      var names = ['全部'];\n      var seen = {};\n      state.list.forEach(function (x) {\n        if (!seen[x.cat]) {\n          seen[x.cat] = 1;\n          names.push(x.cat);\n        }\n      });\n      cats.innerHTML = names\n        .map(function (n) {\n          var on = n === state.cat;\n          return (\n            '<span data-cat=\"' + esc(n) + '\" style=\"flex:none;padding:5px 12px;border-radius:14px;' +\n            'font-size:12px;background:' + (on ? PINK : '#f4f4f5') + ';color:' +\n            (on ? '#fff' : '#61666d') + '\">' + esc(n) + '</span>'\n          );\n        })\n        .join('');\n    }\n\n    function renderGrid() {\n      var kw = state.kw.trim().toLowerCase();\n      var rows = state.list.filter(function (x) {\n        if (state.cat !== '全部' && x.cat !== state.cat) return false;\n        if (!kw) return true;\n        return String(x.name).toLowerCase().indexOf(kw) >= 0 || String(x.id) === kw;\n      });\n      grid.innerHTML = rows.length\n        ? rows.map(cardHtml).join('')\n        : '<div style=\"grid-column:1/-1;padding:40px 0;text-align:center;color:#9499a0;' +\n          'font-size:13px\">没有匹配的装扮</div>';\n    }\n\n    grid.addEventListener('click', function (e) {\n      var ap = e.target.closest('[data-apply]');\n      if (ap) {\n        e.stopPropagation();\n        applyById(ap.getAttribute('data-apply'));\n        return;\n      }\n      var card = e.target.closest('[data-id]');\n      if (card) {\n        var id = card.getAttribute('data-id');\n        closePanel();\n        location.href = '/h5/mall/suit/detail?id=' + id + '&navhide=1';\n      }\n    });\n\n    cats.addEventListener('click', function (e) {\n      var s = e.target.closest('[data-cat]');\n      if (!s) return;\n      state.cat = s.getAttribute('data-cat');\n      renderCats();\n      renderGrid();\n    });\n\n    q.addEventListener('input', function () {\n      state.kw = q.value;\n      renderGrid();\n    });\n\n    sheet.querySelector('#bss-close').addEventListener('click', closePanel);\n\n    sheet.querySelector('#bss-clear').addEventListener('click', function () {\n      bridgeClear().then(function () {\n        toast('已清除注入的装扮', true);\n        refreshCur();\n      });\n    });\n\n    function refreshCur() {\n      bridgeGet().then(function (r) {\n        var eq = r && r.data;\n        cur.textContent = eq && eq.name ? '当前：' + eq.name : '';\n      });\n    }\n    refreshCur();\n\n    grid.innerHTML =\n      '<div style=\"grid-column:1/-1;padding:40px 0;text-align:center;color:#9499a0;' +\n      'font-size:13px\">加载中…</div>';\n\n    loadAll(false)\n      .then(function (list) {\n        state.list = list;\n        renderCats();\n        renderGrid();\n      })\n      .catch(function (e) {\n        grid.innerHTML =\n          '<div style=\"grid-column:1/-1;padding:40px 0;text-align:center;color:#d63031;' +\n          'font-size:13px\">加载失败：' + esc(e.message) + '</div>';\n      });\n  }\n\n  /* ===================== 悬浮按钮（可拖动） ===================== */\n\n  var launcher = null;\n\n  function mountLauncher(kind) {\n    if (launcher) launcher.remove();\n    var isDetail = kind === 'detail';\n    var saved = null;\n    try {\n      saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');\n    } catch (e) {}\n\n    var pos = saved && saved.kind === kind\n      ? 'left:' + saved.left + 'px;top:' + saved.top + 'px;'\n      : isDetail\n      ? 'left:56px;top:calc(env(safe-area-inset-top,0px) + 8px);'\n      : 'right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);';\n\n    launcher = mk(\n      'div',\n      'position:fixed;z-index:2147483000;' + pos +\n        'display:flex;align-items:center;gap:5px;padding:7px 13px;border-radius:20px;' +\n        'background:' + PINK + ';color:#fff;font-size:12px;font-weight:500;' +\n        'font-family:-apple-system,system-ui,sans-serif;' +\n        'box-shadow:0 4px 16px rgba(251,114,153,.45);cursor:pointer;' +\n        'user-select:none;-webkit-user-select:none;touch-action:none;' +\n        '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)',\n      isDetail ? '应用此装扮' : '全部装扮'\n    );\n\n    /* 拖动 + 点击 */\n    var sx = 0,\n      sy = 0,\n      ox = 0,\n      oy = 0,\n      moved = false,\n      dragging = false;\n\n    function down(e) {\n      var t = e.touches ? e.touches[0] : e;\n      var r = launcher.getBoundingClientRect();\n      dragging = true;\n      moved = false;\n      sx = t.clientX;\n      sy = t.clientY;\n      ox = r.left;\n      oy = r.top;\n      launcher.style.right = 'auto';\n      launcher.style.bottom = 'auto';\n      launcher.style.left = ox + 'px';\n      launcher.style.top = oy + 'px';\n    }\n    function move(e) {\n      if (!dragging) return;\n      var t = e.touches ? e.touches[0] : e;\n      var dx = t.clientX - sx;\n      var dy = t.clientY - sy;\n      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;\n      if (!moved) return;\n      e.preventDefault();\n      var w = launcher.offsetWidth;\n      var hh = launcher.offsetHeight;\n      var nx = Math.min(Math.max(ox + dx, 4), window.innerWidth - w - 4);\n      var ny = Math.min(Math.max(oy + dy, 4), window.innerHeight - hh - 4);\n      launcher.style.left = nx + 'px';\n      launcher.style.top = ny + 'px';\n    }\n    function up() {\n      if (!dragging) return;\n      dragging = false;\n      if (moved) {\n        var r = launcher.getBoundingClientRect();\n        try {\n          localStorage.setItem(\n            POS_KEY,\n            JSON.stringify({ kind: kind, left: Math.round(r.left), top: Math.round(r.top) })\n          );\n        } catch (e) {}\n      } else {\n        onTap();\n      }\n    }\n\n    launcher.addEventListener('touchstart', down, { passive: true });\n    launcher.addEventListener('touchmove', move, { passive: false });\n    launcher.addEventListener('touchend', up);\n    launcher.addEventListener('mousedown', down);\n    document.addEventListener('mousemove', move);\n    document.addEventListener('mouseup', up);\n\n    function onTap() {\n      if (!isDetail) return openPanel();\n      var id = qid();\n      if (!id) return toast('没找到装扮 ID，请在装扮详情页使用');\n      launcher.textContent = '注入中…';\n      apiSuitDetail(id)\n        .then(function (d) {\n          var equip = toEquip(d);\n          if (!equip) throw new Error('这个装扮拿不到装扮包，可能已彻底下架');\n          return bridgeGalleryAdd(equip).catch(function () {}).then(function () {\n            return applyEquip(equip);\n          });\n        })\n        .then(function (equip) {\n          launcher.textContent = '已应用 ✓';\n          toast('已注入「' + equip.name + '」\\n杀掉后台重进 B 站即可生效', true);\n          setTimeout(function () {\n            if (launcher) launcher.textContent = '应用此装扮';\n          }, 2600);\n        })\n        .catch(function (e) {\n          launcher.textContent = '应用此装扮';\n          toast('失败：' + e.message);\n        });\n    }\n\n    document.body.appendChild(launcher);\n  }\n\n  /* ===================== 路由 ===================== */\n\n  var lastPath = '';\n  function route() {\n    var p = page();\n    var key = p + '|' + location.pathname + location.search + location.hash;\n    if (key === lastPath) return;\n    lastPath = key;\n    closePanel();\n    if (p === 'detail' || p === 'mall') mountLauncher(p);\n    else if (launcher) {\n      launcher.remove();\n      launcher = null;\n    }\n  }\n\n  ['pushState', 'replaceState'].forEach(function (m) {\n    var orig = history[m];\n    if (typeof orig !== 'function') return;\n    history[m] = function () {\n      var r = orig.apply(this, arguments);\n      setTimeout(route, 0);\n      return r;\n    };\n  });\n  window.addEventListener('popstate', function () {\n    setTimeout(route, 0);\n  });\n  window.addEventListener('hashchange', function () {\n    setTimeout(route, 0);\n  });\n  setInterval(route, 800);\n\n  if (document.body) route();\n  else document.addEventListener('DOMContentLoaded', route);\n\n  /* 测试钩子 */\n  window.__BSS_API__ = {\n    qid: qid,\n    page: page,\n    toEquip: toEquip,\n    mapCatalog: mapCatalog,\n    mergeGallery: mergeGallery,\n    mountLauncher: mountLauncher,\n    openPanel: openPanel,\n    closePanel: closePanel\n  };\n})();\n";

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

/* ===================== 1. 通信桥 ===================== */

function handleBridge() {
  var method = String(($request && $request.method) || 'GET').toUpperCase();
  var name = pathOf($request.url).replace(/^\/x\/surge-skin\//, '');
  var qs = String($request.url || '').split('?')[1] || '';

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

  if (name === 'get') {
    return reply({ code: 0, data: readJSON(KEY_EQUIP, null) });
  }

  if (name === 'clear') {
    $persistentStore.write('', KEY_EQUIP);
    return reply({ code: 0 });
  }

  if (name === 'gallery') {
    return reply({ code: 0, data: readJSON(KEY_GALLERY, []) });
  }

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
    var m = /[?&]id=([^&]+)/.exec('?' + qs);
    var id = m ? decodeURIComponent(m[1]) : '';
    var cur = readJSON(KEY_GALLERY, []);
    if (!(cur instanceof Array)) cur = [];
    var next = cur.filter(function (x) {
      return String(x.id) !== String(id);
    });
    writeJSON(KEY_GALLERY, next);
    return reply({ code: 0, data: { count: next.length } });
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

  var idx = body.lastIndexOf('</body>');
  var out = idx >= 0 ? body.slice(0, idx) + tag + body.slice(idx) : body + tag;
  $done({ body: out });
}

/* ===================== 分派 ===================== */

if (TYPE === 'http-request') {
  handleBridge();
} else if (/\/x\/resource\/show\/skin/.test($request.url || '')) {
  handleApply();
} else {
  handleInject();
}
