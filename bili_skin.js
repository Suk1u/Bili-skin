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
var H5_PAYLOAD = "/*\n * 哔哩哔哩装扮工作室 —— 注入到 www.bilibili.com/h5/mall/* 的页面脚本\n *\n * 按钮只有一个：「应用装扮」。点它就去**扫描当前页面**上出现的装扮，而不是翻全站目录。\n * 候选来自五个地方，按可靠性排序：\n *   1. Surge 嗅探到的接口响应（本页加载过的 x/garb/* x/vas/* 里含装扮包的条目）\n *   2. 页面 JS 状态（__INITIAL_MIRROR__ / __INITIAL_STATE__ 等）里递归找出的装扮对象\n *   3. DOM 里指向装扮详情页的链接\n *   4. 当前 URL 的参数\n *   5. 收藏集/抽奖页：collect_infos 里的兑换物 id，以及主题套装预览链接\n *\n * 一套「装扮套装」（suit）不只有主题皮肤。suit_items 里可能有：\n *   skin（个性主题）loading（加载动画）card（动态卡片）card_bg（评论装扮）\n *   thumbup（点赞特效）play_icon（进度条）space_bg（空间海报）emoji_package（表情包）\n * 全部一起抓，写进 equip.components，Surge 侧按类型分别注入到对应接口。\n *\n * 拿到候选后：1 个直接应用，多个弹选择列表，0 个给空状态（可清除注入 / 从藏馆里挑）。\n *\n * 与 Surge 的通信走 https://app.bilibili.com/x/surge-skin/ （由 Surge 假响应接管）\n */\n(function () {\n  'use strict';\n  if (window.__BSS_LOADED__) return;\n  window.__BSS_LOADED__ = true;\n\n  var BRIDGE = 'https://app.bilibili.com/x/surge-skin/';\n  var API = 'https://api.bilibili.com';\n  var PINK = '#fb7299';\n  var THUMB = '@360w_360h_1c.webp';\n  var POS_KEY = 'bss_btn_pos';\n  var MAX_RESOLVE = 8;\n\n  /* suit_items 里的全部组件类型。顺序即展示顺序。 */\n  var COMPONENTS = [\n    'skin',\n    'loading',\n    'card',\n    'card_bg',\n    'thumbup',\n    'play_icon',\n    'space_bg',\n    'emoji_package'\n  ];\n\n  /* 组件中文名，用于卡片上的小标签 */\n  var COMPONENT_LABEL = {\n    skin: '主题',\n    loading: '加载动画',\n    card: '动态卡片',\n    card_bg: '评论装扮',\n    thumbup: '点赞特效',\n    play_icon: '进度条',\n    space_bg: '空间海报',\n    emoji_package: '表情包'\n  };\n\n  /* 本页进入时间：用来过滤 Surge 嗅探到的候选，只留当前页面的。\n     注入点选在 </head>，所以这个时间早于 SPA 发起请求。 */\n  var enterTs = Date.now();\n\n  /* ===================== 基础工具 ===================== */\n\n  function mk(tag, css, html) {\n    var e = document.createElement(tag);\n    if (css) e.setAttribute('style', css);\n    if (html != null) e.innerHTML = html;\n    return e;\n  }\n\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n\n  function thumb(url) {\n    if (!url) return '';\n    if (!/hdslb\\.com/.test(url)) return url;\n    return url + THUMB;\n  }\n\n  function idFrom(str) {\n    var m = /(?:id|item_id|suit_id|act_id)=(\\d+)/.exec(String(str || ''));\n    return m ? m[1] : '';\n  }\n\n  function jget(url) {\n    return fetch(url, { credentials: 'include' }).then(function (r) {\n      return r.json();\n    });\n  }\n\n  /* ===================== Surge 桥 ===================== */\n\n  function bget(path) {\n    return fetch(BRIDGE + path, { credentials: 'omit' }).then(function (r) {\n      return r.json();\n    });\n  }\n  function bpost(path, obj) {\n    return fetch(BRIDGE + path, {\n      method: 'POST',\n      credentials: 'omit',\n      headers: { 'Content-Type': 'text/plain' },\n      body: JSON.stringify(obj)\n    }).then(function (r) {\n      return r.json();\n    });\n  }\n\n  function bridgeSet(equip) {\n    return bpost('set', equip);\n  }\n  function bridgeGet() {\n    return bget('get');\n  }\n  function bridgeClear() {\n    return bget('clear');\n  }\n  function bridgeGallery() {\n    return bget('gallery');\n  }\n  function bridgeGalleryAdd(equip) {\n    return bpost('gallery/add', equip);\n  }\n  function bridgeSeen(since) {\n    return bget('seen?since=' + (since || 0));\n  }\n  function bridgeSelfMid(mid) {\n    return bpost('selfmid', { mid: mid });\n  }\n  function bridgeSplashList() {\n    return bget('splash/list');\n  }\n  function bridgeSplashSet(sp) {\n    return bpost('splash/set', sp);\n  }\n\n  /* ===================== B 站接口 ===================== */\n\n  function apiSuitDetail(id) {\n    return jget(API + '/x/garb/mall/item/suit/v2?part=suit&item_id=' + id).then(function (r) {\n      if (toEquip(r)) return r;\n      /* 公开接口拿不到时试内部接口——预购 / 收藏集主题套装走这条 */\n      return jget(API + '/x/garb/internal/v2/mall/suit/detail?item_id=' + id + '&part=suit');\n    });\n  }\n  /* 装扮详情（v2）。收藏集的主题套装也用这个 id 直接查。 */\n  function apiSuitDetailV2(id) {\n    return jget(API + '/x/garb/v2/mall/suit/detail?item_id=' + id + '&part=suit');\n  }\n  /* 收藏集的奖励清单（v2 才带「动态主题套装」，v1 不带）。\n     响应结构：data.collect_list.collect_infos[]（新版）或 data.collect_list[]（旧版）。 */\n  function apiCollectRewards(actId, lotteryId) {\n    var q = '/x/vas/dlc_act/lottery/home_detail/v2?act_id=' + actId;\n    if (lotteryId) q += '&lottery_id=' + lotteryId;\n    return jget(API + q);\n  }\n  /* 收藏集主页详情（权威接口，返回 collect_infos 里的兑换物） */\n  function apiLotteryDetail(actId, lotteryId) {\n    var q = '/x/vas/dlc_act/lottery_home_detail?act_id=' + actId;\n    if (lotteryId) q += '&lottery_id=' + lotteryId;\n    return jget(API + q);\n  }\n  /* 收藏集卡片的开屏信息（收藏集专属开屏动画） */\n  function apiCollectSplash(actId) {\n    return jget(API + '/x/vas/dlc_act/card/splash_info?act_id=' + actId);\n  }\n  /* 官方搜索：服务端搜，装扮(part_id=6)和收藏集(part_id=0)都会返回 */\n  function apiSearch(kw) {\n    return jget(\n      API + '/x/garb/v2/mall/home/search?key_word=' + encodeURIComponent(kw) + '&pn=1&ps=20'\n    );\n  }\n  /* 装扮目录分页：part_id=6 是装扮，全站约 3400 套 */\n  function apiCatalogPage(pn) {\n    return jget(API + '/x/garb/v2/mall/partition/item/list?part_id=6&pn=' + pn + '&sort_type=2');\n  }\n  /* 当前登录用户 mid（用于 Surge 侧只改自己的评论装扮） */\n  function apiNav() {\n    return jget(API + '/x/web-interface/nav');\n  }\n\n  /* ===================== 纯逻辑（可测试） ===================== */\n\n  /* skin 组件的配色字段 -> user_equip.data */\n  function skinData(p) {\n    p = p || {};\n    return {\n      color_mode: p.color_mode || 'light',\n      color: p.color || '#212121',\n      color_second_page: p.color_second_page || '#ffffff',\n      side_bg_color: p.side_bg_color || p.color_second_page || '#ffffff',\n      tail_color: p.tail_color || '#996c00',\n      tail_color_selected: p.tail_color_selected || '#0d6872',\n      tail_icon_ani: String(p.tail_icon_ani) === 'true',\n      tail_icon_ani_mode: p.tail_icon_ani_mode || 'once',\n      tail_icon_mode: p.tail_icon_mode || 'img'\n    };\n  }\n\n  /* 一个 suit_items 子项 -> 归一化组件对象。\n     把 properties 摊平到顶层，再补上 item_id / name，Surge 侧按类型取用。 */\n  function componentOf(kind, entry) {\n    if (!entry || typeof entry !== 'object') return null;\n    var p = entry.properties || {};\n    var out = { kind: kind, id: entry.item_id || 0, name: entry.name || '' };\n    for (var k in p) {\n      if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];\n    }\n    /* 各类型的「包/图」地址做一次归一，方便 Surge 侧统一读取 */\n    if (kind === 'loading') {\n      out.url = p.loading_url || '';\n      out.frame_url = p.loading_frame_url || '';\n    } else if (kind === 'skin') {\n      out.url = p.package_url || '';\n      out.md5 = p.package_md5 || '';\n    } else if (kind === 'space_bg') {\n      out.url = p.image1_portrait || p.image1_landscape || p.image || '';\n    } else {\n      out.url = p.image || p.image_ani || p.static_icon_image || p.image_preview || p.preview || '';\n    }\n    return out;\n  }\n\n  /* 一个「容器 + skin 子项」-> user_equip 配置。\n     同时把容器 suit_items 里的其它组件（loading/card/…）一并收进 components。 */\n  function equipFrom(container, skin) {\n    var p = (skin && skin.properties) || {};\n    if (!p.package_url) return null;\n    var item = (container && container.item) || {};\n    var equip = {\n      id: item.item_id || (container && container.item_id) || (skin && skin.item_id) || 0,\n      name: item.name || (container && container.name) || (skin && skin.name) || '',\n      preview: p.image_preview || p.image_cover || '',\n      ver: Number(p.ver) || 1700000000,\n      package_url: p.package_url,\n      package_md5: p.package_md5 || '',\n      data: skinData(p),\n      components: {}\n    };\n\n    /* 把整套套装的所有组件都收进来。没有 suit_items 时至少放进 skin 自己。 */\n    var si = (container && container.suit_items) || null;\n    if (si && typeof si === 'object') {\n      for (var i = 0; i < COMPONENTS.length; i++) {\n        var kind = COMPONENTS[i];\n        var arr = si[kind];\n        var c = componentOf(kind, Array.isArray(arr) ? arr[0] : arr);\n        if (c) equip.components[kind] = c;\n      }\n    }\n    if (!equip.components.skin) {\n      equip.components.skin = componentOf('skin', skin);\n    }\n    return equip;\n  }\n\n  /* 装扮详情响应 -> user_equip 配置 */\n  function toEquip(d) {\n    var da = d && d.data;\n    if (!da) return null;\n    var skins = (da.suit_items && da.suit_items.skin) || [];\n    return equipFrom(da, skins[0]);\n  }\n\n  /* 递归找出所有「带装扮包的容器」 */\n  function harvest(node, out, depth) {\n    if (!node || typeof node !== 'object' || depth > 9) return;\n    if (Array.isArray(node)) {\n      for (var i = 0; i < node.length; i++) harvest(node[i], out, depth + 1);\n      return;\n    }\n    if (node.suit_items && typeof node.suit_items === 'object') {\n      var skins = node.suit_items.skin;\n      if (Array.isArray(skins)) {\n        for (var j = 0; j < skins.length; j++) {\n          var e = equipFrom(node, skins[j]);\n          if (e) out.push(e);\n        }\n      }\n    }\n    for (var k in node) {\n      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;\n      try {\n        harvest(node[k], out, depth + 1);\n      } catch (err) {}\n    }\n  }\n\n  function scanState(win) {\n    var out = [];\n    var roots = [\n      win.__INITIAL_MIRROR__,\n      win.__INITIAL_STATE__,\n      win.__NUXT__,\n      win.__PRELOADED_STATE__,\n      win.__DATA__,\n      win.__GARB_DATA__\n    ];\n    for (var i = 0; i < roots.length; i++) {\n      if (roots[i]) harvest(roots[i], out, 0);\n    }\n    return out;\n  }\n\n  /* 从 URL 与 DOM 里收集「可能指向装扮」的 id */\n  function collectIds(doc, loc) {\n    var seen = {};\n    var out = [];\n    function add(v) {\n      var s = String(v == null ? '' : v).replace(/\\D/g, '');\n      if (!s || s.length < 3 || seen[s]) return;\n      seen[s] = 1;\n      out.push(s);\n    }\n\n    var s = (loc.search || '') + '&' + (loc.hash || '');\n    var re = /[?&](?:id|item_id|suit_id)=(\\d+)/g;\n    var m;\n    while ((m = re.exec(s)) !== null) add(m[1]);\n\n    try {\n      var links = doc.querySelectorAll ? doc.querySelectorAll('a[href]') : [];\n      for (var i = 0; i < links.length; i++) {\n        var href = links[i].getAttribute('href') || '';\n        if (!/suit\\/detail|mall|suit-preview|garbDetail/i.test(href)) continue;\n        add(idFrom(href));\n      }\n    } catch (e) {}\n\n    return out.slice(0, MAX_RESOLVE);\n  }\n\n  /* 从 URL 里取数字参数 */\n  function param(loc, name) {\n    var s = (loc.search || '') + '&' + (loc.hash || '');\n    var m = new RegExp('[?&]' + name + '=(\\\\d+)').exec(s);\n    return m ? m[1] : '';\n  }\n\n  /* 收藏集奖励 -> 可尝试的装扮 id。\n     type=4 Suit：redeem_item_id 本身就是装扮 id。\n     type=5 MaterialCombination（动态主题套装）：是若干子项 id，用 & 分隔。\n     兼容两种 collect_list 结构：\n       新版 data.collect_list.collect_infos[]（lottery_home_detail）\n       旧版 data.collect_list[]（lottery/home_detail/v2） */\n  function collectInfos(raw) {\n    var cl = raw && raw.data && raw.data.collect_list;\n    if (!cl) return [];\n    if (Array.isArray(cl)) return cl;\n    if (Array.isArray(cl.collect_infos)) return cl.collect_infos;\n    return [];\n  }\n\n  function mapRedeemIds(raw) {\n    var out = [];\n    var list = collectInfos(raw);\n    for (var i = 0; i < list.length; i++) {\n      var it = list[i] || {};\n      var t = Number(it.redeem_item_type);\n      if (t !== 4 && t !== 5) continue;\n      var parts = String(it.redeem_item_id || '').split('&');\n      for (var j = 0; j < parts.length; j++) {\n        var s = parts[j].replace(/\\D/g, '');\n        if (s.length >= 5) out.push(s);\n      }\n    }\n    return out;\n  }\n\n  /* 收藏集兑换物 -> 装扮候选（id + 名字 + 预览图），用于空状态里给线索 */\n  function mapRedeemItems(raw) {\n    var out = [];\n    var list = collectInfos(raw);\n    for (var i = 0; i < list.length; i++) {\n      var it = list[i] || {};\n      var t = Number(it.redeem_item_type);\n      if (t !== 4 && t !== 5) continue;\n      var name = it.redeem_item_name || '';\n      var img = it.redeem_item_image || '';\n      var jump = it.jump_url || it.garb_suit_url || '';\n      if (!name && !img && !jump) continue;\n      out.push({ name: name, preview: img, jump: jump, type: t });\n    }\n    return out;\n  }\n\n  function mergeById() {\n    var out = [];\n    var seen = {};\n    for (var i = 0; i < arguments.length; i++) {\n      var list = arguments[i] || [];\n      for (var j = 0; j < list.length; j++) {\n        var e = list[j];\n        if (!e || !e.id || !e.package_url || seen[e.id]) continue;\n        seen[e.id] = 1;\n        out.push(e);\n      }\n    }\n    return out;\n  }\n\n  /* 一套装扮带了哪些组件（用于卡片角标） */\n  function componentBadges(it) {\n    if (it && it.isSplash) return ['开屏动画'];\n    var c = it && it.components;\n    if (!c) return [];\n    var out = [];\n    for (var i = 0; i < COMPONENTS.length; i++) {\n      var k = COMPONENTS[i];\n      if (k === 'skin') continue;\n      if (c[k]) out.push(COMPONENT_LABEL[k] || k);\n    }\n    return out;\n  }\n\n  /* Surge 侧嗅探到的开屏图 -> 候选卡片。thumb 是图片地址。 */\n  function mapSplashItems(list) {\n    var out = [];\n    if (!Array.isArray(list)) return out;\n    for (var i = 0; i < list.length; i++) {\n      var it = list[i] || {};\n      if (!it.thumb) continue;\n      out.push({\n        id: 'sp' + (it.id || i),\n        name: '开屏动画 #' + (it.id || i + 1),\n        preview: it.thumb,\n        isSplash: true,\n        splash: { id: it.id, thumb: it.thumb, logo_url: it.logo_url || '', duration: 3000 }\n      });\n    }\n    return out;\n  }\n\n  /* ===================== 全量目录（兜底用） ===================== */\n\n  /* 目录条目 -> 卡片数据。只有 id / 名字 / 封面，点开再去拉装扮包。 */\n  function mapSuit(it) {\n    it = it || {};\n    var p = it.properties || {};\n    return {\n      id: it.item_id,\n      name: it.name,\n      cover: p.image_cover || '',\n      cat: it.group_name || '',\n      paid: Number(p.sale_bp_forever_raw || 0) > 0\n    };\n  }\n\n  /* 搜索响应：收藏集混在里面，只留装扮 */\n  function mapSearch(raw) {\n    var out = [];\n    var list = (raw && raw.data && raw.data.list) || [];\n    for (var i = 0; i < list.length; i++) {\n      if (list[i].part_id === 6) out.push(mapSuit(list[i]));\n    }\n    return out;\n  }\n\n  /* 搜索响应里的收藏集（part_id=0）。用户搜的常常是收藏集名，\n     收藏集不是装扮，但它的「主题套装」上线后会变成装扮。 */\n  function mapCollectHits(raw) {\n    var out = [];\n    var list = (raw && raw.data && raw.data.list) || [];\n    for (var i = 0; i < list.length; i++) {\n      var it = list[i];\n      if (it.part_id !== 0) continue;\n      var p = it.properties || {};\n      out.push({\n        id: it.item_id,\n        name: it.name,\n        upcoming: String(p.dlc_act_status) === '1',\n        startAt: Number(p.dlc_sale_start_time || 0)\n      });\n    }\n    return out;\n  }\n\n  function fmtTime(ts) {\n    if (!ts) return '';\n    var d = new Date(ts * 1000);\n    function p2(n) {\n      return (n < 10 ? '0' : '') + n;\n    }\n    return (\n      d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +\n      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())\n    );\n  }\n\n  function collectHint(hits, kw) {\n    var lines = [];\n    for (var i = 0; i < hits.length; i++) {\n      var h = hits[i];\n      lines.push(\n        '· ' + h.name + (h.upcoming && h.startAt ? '\\n    ' + fmtTime(h.startAt) + ' 开售' : '')\n      );\n    }\n    return emptyHtml(\n      '「' + kw + '」是收藏集，不是装扮。\\n收藏集的「主题套装」要等它上线后才会出现：\\n\\n' +\n        lines.join('\\n') +\n        '\\n\\n上线后再搜一次就能找到。'\n    );\n  }\n\n  function mapCatalogPage(raw) {\n    var out = [];\n    var list = (raw && raw.data && raw.data.list) || [];\n    for (var i = 0; i < list.length; i++) out.push(mapSuit(list[i]));\n    return out;\n  }\n\n  /* ===================== 候选收集 ===================== */\n\n  async function collectCandidates() {\n    var stateHits = [];\n    try {\n      stateHits = scanState(window);\n    } catch (e) {}\n\n    var sniffed = [];\n    try {\n      var r = await bridgeSeen(enterTs);\n      sniffed = (r && r.data) || [];\n    } catch (e) {}\n\n    var merged = mergeById(sniffed, stateHits);\n\n    var ids = collectIds(document, location);\n\n    /* 收藏集页：奖励清单里的 id 也一并试（「动态主题套装」在这里）。\n       act_id 在 URL 上；lottery_id 可能没有，缺了拿不到数据，两个都试一遍。 */\n    var actId = param(location, 'act_id');\n    if (actId) {\n      var rawList = [];\n      try {\n        rawList.push(await apiLotteryDetail(actId, param(location, 'lottery_id')));\n      } catch (e) {}\n      try {\n        rawList.push(await apiCollectRewards(actId, param(location, 'lottery_id')));\n      } catch (e) {}\n      for (var r2 = 0; r2 < rawList.length; r2++) {\n        var extra = mapRedeemIds(rawList[r2]);\n        for (var n = 0; n < extra.length; n++) {\n          if (ids.indexOf(extra[n]) < 0) ids.push(extra[n]);\n        }\n      }\n    }\n\n    for (var i = 0; i < ids.length; i++) {\n      var dup = false;\n      for (var k = 0; k < merged.length; k++) {\n        if (String(merged[k].id) === ids[i]) {\n          dup = true;\n          break;\n        }\n      }\n      if (dup) continue;\n      try {\n        var e = toEquip(await apiSuitDetail(ids[i]));\n        if (e) merged.push(e);\n      } catch (err) {}\n    }\n\n    /* 开屏动画候选：Surge 侧嗅探到的 x/v2/splash/brand/list */\n    try {\n      var sr = await bridgeSplashList();\n      var splashItems = mapSplashItems(sr && sr.data);\n      for (var s = 0; s < splashItems.length; s++) merged.push(splashItems[s]);\n    } catch (err2) {}\n\n    return merged;\n  }\n\n  /* 把当前登录 mid 交给 Surge，用于「只改自己的评论装扮」 */\n  function reportSelfMid() {\n    apiNav()\n      .then(function (r) {\n        var mid = r && r.data && r.data.mid;\n        if (mid) return bridgeSelfMid(mid);\n      })\n      .catch(function () {});\n  }\n\n  /* ===================== 应用 ===================== */\n\n  async function applyEquip(equip) {\n    /* 开屏动画走单独的存储与注入点 */\n    if (equip && equip.isSplash) {\n      var sr = await bridgeSplashSet(equip.splash);\n      if (!sr || sr.code !== 0) throw new Error((sr && sr.msg) || '保存失败');\n      return equip;\n    }\n    try {\n      await bridgeGalleryAdd(equip);\n    } catch (e) {}\n    var r = await bridgeSet(equip);\n    if (!r || r.code !== 0) throw new Error((r && r.msg) || '保存失败');\n    return equip;\n  }\n\n  /* ===================== 提示 ===================== */\n\n  var toastEl = null;\n  function toast(msg, ok) {\n    if (toastEl) toastEl.remove();\n    toastEl = mk(\n      'div',\n      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;' +\n        'max-width:76vw;padding:12px 18px;border-radius:12px;font-size:14px;line-height:1.5;' +\n        'color:#fff;text-align:center;white-space:pre-line;word-break:break-word;' +\n        'background:' + (ok ? 'rgba(0,0,0,.82)' : 'rgba(214,48,49,.92)') +\n        ';-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)',\n      esc(msg)\n    );\n    document.body.appendChild(toastEl);\n    setTimeout(function () {\n      if (toastEl) {\n        toastEl.remove();\n        toastEl = null;\n      }\n    }, 2400);\n  }\n\n  /* ===================== 卡片 ===================== */\n\n  function cardHtml(it) {\n    var badges = componentBadges(it);\n    var badgeHtml = badges.length\n      ? '<div style=\"position:absolute;left:6px;top:6px;display:flex;flex-wrap:wrap;gap:4px;' +\n        'max-width:90%\">' +\n        badges\n          .map(function (b) {\n            return (\n              '<span style=\"font-size:10px;line-height:16px;padding:0 6px;border-radius:8px;' +\n              'background:rgba(0,0,0,.55);color:#fff\">' +\n              esc(b) +\n              '</span>'\n            );\n          })\n          .join('') +\n        '</div>'\n      : '';\n    return (\n      '<div data-id=\"' + it.id + '\" style=\"background:#fff;border-radius:12px;overflow:hidden;' +\n      'box-shadow:0 1px 6px rgba(0,0,0,.07);cursor:pointer\">' +\n      '<div style=\"position:relative;width:100%;aspect-ratio:1/1;background:#f4f4f5;overflow:hidden\">' +\n      (it.preview\n        ? '<img src=\"' + esc(thumb(it.preview)) + '\" loading=\"lazy\" ' +\n          'style=\"display:block;width:100%;height:100%;object-fit:cover\">'\n        : '') +\n      badgeHtml +\n      '</div>' +\n      '<div style=\"padding:8px 10px 10px\">' +\n      '<div style=\"font-size:13px;line-height:1.35;color:#18191c;overflow:hidden;' +\n      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:35px\">' +\n      esc(it.name) + '</div>' +\n      '<div data-apply=\"' + it.id + '\" style=\"margin-top:8px;height:30px;line-height:30px;' +\n      'text-align:center;border-radius:15px;background:' + PINK + ';color:#fff;font-size:12px\">' +\n      '应用</div>' +\n      '</div></div>'\n    );\n  }\n\n  /* ===================== 面板 ===================== */\n\n  var panel = null;\n\n  function closePanel() {\n    if (panel) {\n      panel.remove();\n      panel = null;\n    }\n  }\n\n  /* 通用底部面板：标题 + 副标题 + 网格 + 右上角动作 */\n  function openSheet(title, subtitle, actions, bodyHtml) {\n    closePanel();\n\n    panel = mk(\n      'div',\n      'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);' +\n        'display:flex;align-items:flex-end'\n    );\n\n    var sheet = mk(\n      'div',\n      'width:100%;max-height:82vh;background:#fff;border-radius:16px 16px 0 0;' +\n        'display:flex;flex-direction:column;overflow:hidden;' +\n        'font-family:-apple-system,system-ui,sans-serif'\n    );\n\n    var actionHtml = (actions || [])\n      .map(function (a) {\n        return (\n          '<span data-act=\"' + esc(a.key) + '\" style=\"font-size:12px;color:' +\n          (a.pink ? PINK : '#9499a0') + ';margin-left:14px\">' + esc(a.label) + '</span>'\n        );\n      })\n      .join('');\n\n    sheet.innerHTML =\n      '<div style=\"flex:none;padding:16px 16px 10px\">' +\n      '<div style=\"display:flex;align-items:flex-start;justify-content:space-between\">' +\n      '<div style=\"flex:1;min-width:0\">' +\n      '<div style=\"font-size:16px;font-weight:600;color:#18191c\">' + esc(title) + '</div>' +\n      (subtitle\n        ? '<div style=\"margin-top:4px;font-size:12px;color:#9499a0\">' + esc(subtitle) + '</div>'\n        : '') +\n      '</div>' +\n      '<div style=\"flex:none;padding-left:10px\">' + actionHtml +\n      '<span data-act=\"close\" style=\"font-size:20px;color:#9499a0;margin-left:14px;' +\n      'line-height:1\">&times;</span></div>' +\n      '</div></div>' +\n      '<div id=\"bss-body\" style=\"flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;' +\n      'padding:0 16px calc(env(safe-area-inset-bottom,0px) + 20px)\">' + bodyHtml + '</div>';\n\n    panel.appendChild(sheet);\n    panel.addEventListener('click', function (e) {\n      if (e.target === panel) closePanel();\n    });\n    document.body.appendChild(panel);\n    return sheet;\n  }\n\n  function gridHtml(list) {\n    return (\n      '<div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:12px\">' +\n      list.map(cardHtml).join('') +\n      '</div>'\n    );\n  }\n\n  function emptyHtml(text) {\n    return (\n      '<div style=\"padding:44px 0;text-align:center;color:#9499a0;font-size:13px;' +\n      'line-height:1.8;white-space:pre-line\">' + esc(text) + '</div>'\n    );\n  }\n\n  /* 选中列表：1 个直接应用，多个弹选择 */\n  async function runApply() {\n    if (!launcher) return;\n    launcher.textContent = '扫描中…';\n    launcher.style.opacity = '.7';\n\n    var list;\n    try {\n      list = await collectCandidates();\n    } catch (e) {\n      list = [];\n    }\n\n    launcher.textContent = '应用装扮';\n    launcher.style.opacity = '1';\n\n    if (list.length === 0) return showEmpty();\n    if (list.length === 1) return doApply(list[0]);\n\n    openSheet('选择要应用的装扮', '本页找到 ' + list.length + ' 套，点「应用」生效', [], gridHtml(list));\n    bindGridActions(panel.querySelector('#bss-body'), list);\n  }\n\n  function bindGridActions(root, list) {\n    if (!root) return;\n    root.addEventListener('click', function (e) {\n      var ap = e.target.closest && e.target.closest('[data-apply]');\n      var card = ap || (e.target.closest && e.target.closest('[data-id]'));\n      if (!card) return;\n      var id = card.getAttribute('data-apply') || card.getAttribute('data-id');\n      var hit = null;\n      for (var i = 0; i < list.length; i++) {\n        if (String(list[i].id) === String(id)) {\n          hit = list[i];\n          break;\n        }\n      }\n      if (hit) {\n        closePanel();\n        doApply(hit);\n      }\n    });\n  }\n\n  async function doApply(equip) {\n    if (launcher) launcher.textContent = '注入中…';\n    try {\n      await applyEquip(equip);\n      if (launcher) launcher.textContent = '已应用';\n      var extra = componentBadges(equip);\n      toast(\n        '已注入「' + equip.name + '」' +\n          (extra.length ? '\\n含 ' + extra.join(' / ') : '') +\n          '\\n杀掉后台重进 B 站即可生效',\n        true\n      );\n    } catch (e) {\n      toast('失败：' + e.message);\n    }\n    setTimeout(function () {\n      if (launcher) launcher.textContent = '应用装扮';\n    }, 2600);\n  }\n\n  /* 本页没找到：给「浏览全部」兜底 + 藏馆里之前用过的 */\n  async function showEmpty() {\n    var cur = null;\n    var gal = [];\n    try {\n      var g = await bridgeGet();\n      cur = g && g.data;\n    } catch (e) {}\n    try {\n      var r = await bridgeGallery();\n      gal = (r && r.data) || [];\n    } catch (e) {}\n\n    var acts = [{ key: 'browse', label: '浏览全部装扮', pink: true }];\n    if (cur && cur.name) acts.push({ key: 'clear', label: '清除注入' });\n\n    var isCard = /digital-card/.test(location.pathname || '');\n    var tip = isCard\n      ? '收藏集页面本身不带装扮数据。\\n点「浏览全部装扮」按名字找，\\n或进收藏集的「主题套装」页再点按钮。'\n      : '本页没找到可用的装扮。\\n点「浏览全部装扮」按名字或 ID 找。';\n\n    var body =\n      emptyHtml(tip) +\n      (gal.length\n        ? '<div style=\"margin:2px 0 10px;font-size:13px;color:#61666d\">藏馆 · 之前应用过的</div>' +\n          gridHtml(gal)\n        : '');\n\n    openSheet('应用装扮', cur && cur.name ? '当前：' + cur.name : '', acts, body);\n    bindGridActions(panel.querySelector('#bss-body'), gal);\n\n    var browseBtn = panel.querySelector('[data-act=\"browse\"]');\n    if (browseBtn) {\n      browseBtn.addEventListener('click', function () {\n        openBrowse();\n      });\n    }\n\n    var clearBtn = panel.querySelector('[data-act=\"clear\"]');\n    if (clearBtn) {\n      clearBtn.addEventListener('click', async function () {\n        await bridgeClear();\n        closePanel();\n        toast('已清除注入的装扮', true);\n      });\n    }\n  }\n\n  /* 兜底：全站装扮目录（约 3400 套）。\n     搜索走服务端接口，浏览走分页 + 触底加载。 */\n  async function openBrowse() {\n    openSheet(\n      '全部装扮',\n      '搜名字，或往下翻看全部',\n      [],\n      '<input id=\"bss-q\" placeholder=\"搜索装扮名，例如「灵魂潮汐」\" ' +\n        'style=\"width:100%;box-sizing:border-box;height:36px;padding:0 14px;border:none;' +\n        'border-radius:18px;background:#f4f4f5;font-size:13px;outline:none\">' +\n        '<div id=\"bss-grid\" style=\"margin-top:12px\"></div>' +\n        '<div id=\"bss-more\" style=\"padding:18px 0;text-align:center;font-size:12px;' +\n        'color:#9499a0\"></div>'\n    );\n\n    var body = panel.querySelector('#bss-body');\n    var qEl = body.querySelector('#bss-q');\n    var gridEl = body.querySelector('#bss-grid');\n    var moreEl = body.querySelector('#bss-more');\n\n    var st = { pn: 0, done: false, loading: false, kw: '', timer: 0 };\n\n    function loadMore() {\n      if (st.loading || st.done || st.kw) return;\n      st.loading = true;\n      moreEl.textContent = '加载中…';\n      var pn = st.pn + 1;\n      apiCatalogPage(pn)\n        .then(function (raw) {\n          var list = mapCatalogPage(raw);\n          if (!list.length) {\n            st.done = true;\n            moreEl.textContent = '没有更多了';\n          } else {\n            st.pn = pn;\n            gridEl.insertAdjacentHTML('beforeend', gridHtml(list));\n            moreEl.textContent = '';\n          }\n        })\n        .catch(function (e) {\n          moreEl.textContent = '加载失败：' + e.message;\n        })\n        .then(function () {\n          st.loading = false;\n        });\n    }\n\n    function doSearch(kw) {\n      if (!kw) {\n        gridEl.innerHTML = '';\n        st.pn = 0;\n        st.done = false;\n        moreEl.textContent = '';\n        return loadMore();\n      }\n      moreEl.textContent = '搜索中…';\n      apiSearch(kw)\n        .then(function (raw) {\n          var list = mapSearch(raw);\n          if (list.length) {\n            gridEl.innerHTML = gridHtml(list);\n          } else {\n            var hits = mapCollectHits(raw);\n            gridEl.innerHTML = hits.length\n              ? collectHint(hits, kw)\n              : emptyHtml('没搜到「' + kw + '」\\n换个关键词试试');\n          }\n          moreEl.textContent = '';\n        })\n        .catch(function (e) {\n          moreEl.textContent = '搜索失败：' + e.message;\n        });\n    }\n\n    qEl.addEventListener('input', function () {\n      st.kw = qEl.value.trim();\n      clearTimeout(st.timer);\n      st.timer = setTimeout(function () {\n        doSearch(st.kw);\n      }, 400);\n    });\n\n    /* 触底加载更多 */\n    body.addEventListener('scroll', function () {\n      if (st.kw || st.loading || st.done) return;\n      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 400) loadMore();\n    });\n\n    /* 目录条目只有 id / 名字 / 封面，点了再去拉装扮包 */\n    gridEl.addEventListener('click', function (e) {\n      var ap = e.target.closest && e.target.closest('[data-apply]');\n      var card = ap || (e.target.closest && e.target.closest('[data-id]'));\n      if (!card) return;\n      var id = card.getAttribute('data-apply') || card.getAttribute('data-id');\n      closePanel();\n      applyById(id);\n    });\n\n    loadMore();\n  }\n\n  async function applyById(id) {\n    try {\n      var equip = toEquip(await apiSuitDetail(id));\n      if (!equip) throw new Error('这套装扮拿不到装扮包');\n      await doApply(equip);\n    } catch (e) {\n      if (launcher) launcher.textContent = '应用装扮';\n      toast('失败：' + e.message);\n    }\n  }\n\n  /* ===================== 悬浮按钮（可拖动） ===================== */\n\n  var launcher = null;\n\n  function mountLauncher() {\n    if (launcher) return;\n    var saved = null;\n    try {\n      saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');\n    } catch (e) {}\n\n    var pos =\n      saved && saved.left != null\n        ? 'left:' + saved.left + 'px;top:' + saved.top + 'px;'\n        : 'left:56px;top:calc(env(safe-area-inset-top,0px) + 8px);';\n\n    launcher = mk(\n      'div',\n      'position:fixed;z-index:2147483000;' + pos +\n        'padding:7px 14px;border-radius:20px;background:' + PINK + ';color:#fff;' +\n        'font-size:12px;font-weight:500;font-family:-apple-system,system-ui,sans-serif;' +\n        'box-shadow:0 4px 16px rgba(251,114,153,.45);cursor:pointer;white-space:nowrap;' +\n        'user-select:none;-webkit-user-select:none;touch-action:none;' +\n        '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)',\n      '应用装扮'\n    );\n\n    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;\n\n    function down(e) {\n      var t = e.touches ? e.touches[0] : e;\n      var r = launcher.getBoundingClientRect();\n      dragging = true;\n      moved = false;\n      sx = t.clientX;\n      sy = t.clientY;\n      ox = r.left;\n      oy = r.top;\n      launcher.style.left = ox + 'px';\n      launcher.style.top = oy + 'px';\n    }\n    function move(e) {\n      if (!dragging) return;\n      var t = e.touches ? e.touches[0] : e;\n      var dx = t.clientX - sx;\n      var dy = t.clientY - sy;\n      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;\n      moved = true;\n      if (e.cancelable) e.preventDefault();\n      var w = launcher.offsetWidth;\n      var h = launcher.offsetHeight;\n      launcher.style.left = Math.min(Math.max(ox + dx, 4), window.innerWidth - w - 4) + 'px';\n      launcher.style.top = Math.min(Math.max(oy + dy, 4), window.innerHeight - h - 4) + 'px';\n    }\n    function up() {\n      if (!dragging) return;\n      dragging = false;\n      if (moved) {\n        var r = launcher.getBoundingClientRect();\n        try {\n          localStorage.setItem(\n            POS_KEY,\n            JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })\n          );\n        } catch (e) {}\n      } else {\n        runApply();\n      }\n    }\n\n    launcher.addEventListener('touchstart', down, { passive: true });\n    launcher.addEventListener('touchmove', move, { passive: false });\n    launcher.addEventListener('touchend', up);\n    launcher.addEventListener('mousedown', down);\n    document.addEventListener('mousemove', move);\n    document.addEventListener('mouseup', up);\n\n    document.body.appendChild(launcher);\n  }\n\n  /* ===================== 路由 ===================== */\n\n  var lastPath = '';\n\n  function markEnter() {\n    enterTs = Date.now();\n  }\n\n  /* 按钮该出现的页面：\n     - /h5/mall/*                装扮商城、详情页、收藏集\n     - /blackboard/fe/suit-preview.html  收藏集的「主题套装」预览页（独立活动页）\n     - /garb/collection-hall/*   收藏集大厅\n     注意 /h5/garb/draw-card 这类抽卡页不放按钮——那里没有装扮包数据。 */\n  function isTargetPage(p) {\n    return (\n      /h5\\/mall/.test(p) ||\n      /blackboard\\/fe\\/suit-preview\\.html/.test(p) ||\n      /garb\\/collection-hall/.test(p)\n    );\n  }\n\n  function route() {\n    var p = (location.pathname || '') + (location.hash || '');\n    if (!isTargetPage(p)) {\n      if (launcher) {\n        launcher.remove();\n        launcher = null;\n      }\n      lastPath = '';\n      return;\n    }\n    var key = location.pathname + location.search + location.hash;\n    if (key === lastPath) return;\n    lastPath = key;\n    closePanel();\n    mountLauncher();\n  }\n\n  ['pushState', 'replaceState'].forEach(function (m) {\n    var orig = history[m];\n    if (typeof orig !== 'function') return;\n    history[m] = function () {\n      markEnter();\n      var r = orig.apply(this, arguments);\n      setTimeout(route, 0);\n      return r;\n    };\n  });\n  window.addEventListener('popstate', function () {\n    markEnter();\n    setTimeout(route, 0);\n  });\n  window.addEventListener('hashchange', function () {\n    markEnter();\n    setTimeout(route, 0);\n  });\n  setInterval(route, 800);\n\n  if (document.body) route();\n  else document.addEventListener('DOMContentLoaded', route);\n\n  reportSelfMid();\n\n  /* 测试钩子 */\n  window.__BSS_API__ = {\n    COMPONENTS: COMPONENTS,\n    COMPONENT_LABEL: COMPONENT_LABEL,\n    idFrom: idFrom,\n    param: param,\n    thumb: thumb,\n    isTargetPage: isTargetPage,\n    mapRedeemIds: mapRedeemIds,\n    mapRedeemItems: mapRedeemItems,\n    collectInfos: collectInfos,\n    mapSuit: mapSuit,\n    mapSearch: mapSearch,\n    mapCollectHits: mapCollectHits,\n    fmtTime: fmtTime,\n    collectHint: collectHint,\n    mapCatalogPage: mapCatalogPage,\n    equipFrom: equipFrom,\n    toEquip: toEquip,\n    harvest: harvest,\n    scanState: scanState,\n    collectIds: collectIds,\n    mergeById: mergeById,\n    componentOf: componentOf,\n    componentBadges: componentBadges,\n    mapSplashItems: mapSplashItems,\n    skinData: skinData,\n    cardHtml: cardHtml,\n    enterTs: function () {\n      return enterTs;\n    },\n    markEnter: markEnter\n  };\n})();\n";

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
