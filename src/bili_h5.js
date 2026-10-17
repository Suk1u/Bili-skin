/*
 * 哔哩哔哩装扮工作室 —— 注入到 www.bilibili.com/h5/mall/* 的页面脚本
 *
 * 按钮只有一个：「应用装扮」。点它就去**扫描当前页面**上出现的装扮，而不是翻全站目录。
 * 候选来自五个地方，按可靠性排序：
 *   1. Surge 嗅探到的接口响应（本页加载过的 x/garb/* x/vas/* 里含装扮包的条目）
 *   2. 页面 JS 状态（__INITIAL_MIRROR__ / __INITIAL_STATE__ 等）里递归找出的装扮对象
 *   3. DOM 里指向装扮详情页的链接
 *   4. 当前 URL 的参数
 *   5. 收藏集/抽奖页：collect_infos 里的兑换物 id，以及主题套装预览链接
 *
 * 一套「装扮套装」（suit）不只有主题皮肤。suit_items 里可能有：
 *   skin（个性主题）loading（加载动画）card（动态卡片）card_bg（评论装扮）
 *   thumbup（点赞特效）play_icon（进度条）space_bg（空间海报）emoji_package（表情包）
 * 全部一起抓，写进 equip.components，Surge 侧按类型分别注入到对应接口。
 *
 * 拿到候选后：1 个直接应用，多个弹选择列表，0 个给空状态（可清除注入 / 从藏馆里挑）。
 *
 * 与 Surge 的通信走 https://app.bilibili.com/x/surge-skin/ （由 Surge 假响应接管）
 */
(function () {
  'use strict';
  if (window.__BSS_LOADED__) return;
  window.__BSS_LOADED__ = true;

  var BRIDGE = 'https://app.bilibili.com/x/surge-skin/';
  var API = 'https://api.bilibili.com';
  var PINK = '#fb7299';
  var THUMB = '@360w_360h_1c.webp';
  var POS_KEY = 'bss_btn_pos';
  var MAX_RESOLVE = 8;

  /* suit_items 里的全部组件类型。顺序即展示顺序。
     ⚠️ pendant（头像挂件）**不在** suit_items 里 —— 实测 60 套在售装扮的
     suit_items 只有下面 8 个键。挂件是独立资产，只在收藏集兑换物
     （redeem_item_type_name = "头像挂件"）和已拥有资产列表里出现，
     由 Surge 侧抓成「只有 pendant 一个组件」的候选。 */
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

  /* 组件中文名，用于卡片上的小标签 */
  var COMPONENT_LABEL = {
    skin: '主题',
    loading: '加载动画',
    card: '动态卡片',
    card_bg: '评论装扮',
    pendant: '头像挂件',
    thumbup: '点赞特效',
    play_icon: '进度条',
    space_bg: '空间海报',
    emoji_package: '表情包'
  };

  /* 面板文案。加语言就在这里加一份。 */
  var LANGS = {
    zh: {
      apply: '应用装扮',
      scanning: '扫描中…',
      applying: '注入中…',
      applied: '已应用',
      pick: '选择要应用的装扮',
      pickSub: '本页找到 {n} 套，点「应用」生效',
      detail: '装扮详情',
      components: '组件',
      source: '来源',
      price: '价格',
      free: '免费',
      browse: '浏览全部装扮',
      clear: '清除注入',
      search: '搜索装扮名，例如「灵魂潮汐」',
      all: '全部装扮',
      allSub: '搜名字，或往下翻看全部',
      category: '分类',
      sort: '排序',
      sortNew: '最新',
      sortHot: '最热',
      byId: '按 ID 找',
      idPlaceholder: '输入装扮 ID',
      go: '查找',
      loading: '加载中…',
      noMore: '没有更多了',
      empty: '本页没找到可用的装扮。\n点「浏览全部装扮」按名字或 ID 找。',
      emptyCard: '收藏集页面本身不带装扮数据。\n点「浏览全部装扮」按名字找，\n或进收藏集的「主题套装」页再点按钮。',
      gallery: '藏馆 · 之前应用过的',
      settings: '设置',
      export: '导出配置',
      import: '导入配置',
      copyHint: '复制下面这段，换设备时粘到「导入配置」里',
      importHint: '把之前导出的内容粘进来',
      doImport: '导入',
      copied: '已复制',
      diag: '诊断',
      saved: '已保存',
      remind: '开售提醒',
      remindAdded: '已加提醒',
      removed: '已移除',
      account: '账号',
      note: '备注',
      noteHint: '给这套装扮起个名字'
    },
    en: {
      apply: 'Apply skin',
      scanning: 'Scanning…',
      applying: 'Injecting…',
      applied: 'Applied',
      pick: 'Pick a skin',
      pickSub: '{n} found on this page — tap Apply',
      detail: 'Skin detail',
      components: 'Components',
      source: 'Source',
      price: 'Price',
      free: 'Free',
      browse: 'Browse all',
      clear: 'Clear injection',
      search: 'Search by name, e.g. "灵魂潮汐"',
      all: 'All skins',
      allSub: 'Search or scroll',
      category: 'Category',
      sort: 'Sort',
      sortNew: 'Newest',
      sortHot: 'Hottest',
      byId: 'By ID',
      idPlaceholder: 'Enter skin ID',
      go: 'Go',
      loading: 'Loading…',
      noMore: 'No more',
      empty: 'No skin found on this page.\nTap "Browse all" to search by name or ID.',
      emptyCard: 'Collection pages carry no skin data.\nTap "Browse all",\nor open the collection\'s theme-suit page.',
      gallery: 'Vault · previously applied',
      settings: 'Settings',
      export: 'Export',
      import: 'Import',
      copyHint: 'Copy this; paste into Import on another device',
      importHint: 'Paste exported content here',
      doImport: 'Import',
      copied: 'Copied',
      diag: 'Diagnostics',
      saved: 'Saved',
      remind: 'Remind me',
      remindAdded: 'Reminder added',
      removed: 'Removed',
      account: 'Account',
      note: 'Note',
      noteHint: 'Name this skin'
    }
  };

  var prefs = {
    allMembers: false,
    notify: true,
    autoScan: false,
    lang: 'zh',
    splashKeepVideo: false,
    splashScratch: -1,
    grpcAll: false
  };

  function t(key, vars) {
    var L = LANGS[prefs.lang] || LANGS.zh;
    var s = L[key] || (LANGS.zh[key] || key);
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split('{' + k + '}').join(String(vars[k]));
        }
      }
    }
    return s;
  }

  /* 本页进入时间：用来过滤 Surge 嗅探到的候选，只留当前页面的。
     注入点选在 </head>，所以这个时间早于 SPA 发起请求。 */
  var enterTs = Date.now();

  /* ===================== 基础工具 ===================== */

  function mk(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.setAttribute('style', css);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function thumb(url) {
    if (!url) return '';
    if (!/hdslb\.com/.test(url)) return url;
    return url + THUMB;
  }

  function idFrom(str) {
    var m = /(?:id|item_id|suit_id|act_id)=(\d+)/.exec(String(str || ''));
    return m ? m[1] : '';
  }

  function jget(url) {
    return fetch(url, { credentials: 'include' }).then(function (r) {
      return r.json();
    });
  }

  /* ===================== Surge 桥 ===================== */

  function bget(path) {
    return fetch(BRIDGE + path, { credentials: 'omit' }).then(function (r) {
      return r.json();
    });
  }
  function bpost(path, obj) {
    return fetch(BRIDGE + path, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(obj)
    }).then(function (r) {
      return r.json();
    });
  }

  function bridgeSet(equip) {
    return bpost('set', equip);
  }
  function bridgeGet() {
    return bget('get');
  }
  function bridgeClear() {
    return bget('clear');
  }
  function bridgeGallery() {
    return bget('gallery');
  }
  function bridgeGalleryAdd(equip) {
    return bpost('gallery/add', equip);
  }
  function bridgeSeen(since) {
    return bget('seen?since=' + (since || 0));
  }
  /* 持久候选：App 原生页（收藏集 / 资产列表）里抓到的，7 天有效 */
  function bridgeFound() {
    return bget('found');
  }
  function bridgeSelfMid(mid) {
    return bpost('selfmid', { mid: mid });
  }
  function bridgeSplashList() {
    return bget('splash/list');
  }
  function bridgeSplashSet(sp) {
    return bpost('splash/set', sp);
  }
  function bridgeChronosList() {
    return bget('chronos/list');
  }
  function bridgeChronosSet(ch) {
    return bpost('chronos/set', ch);
  }
  function bridgePrefs() {
    return bget('prefs');
  }
  function bridgePrefsSet(obj) {
    return bpost('prefs/set', obj);
  }
  function bridgeExport() {
    return bget('export');
  }
  function bridgeApiLog() {
    return bget('apilog');
  }
  function bridgeImport(obj) {
    return bpost('import', obj);
  }
  function bridgeDiag() {
    return bget('diag');
  }
  function bridgeEquips() {
    return bget('equips');
  }
  function bridgeEquipUse(mid) {
    return bget('equips/use?mid=' + encodeURIComponent(mid));
  }
  function bridgeEquipRemove(mid) {
    return bget('equips/remove?mid=' + encodeURIComponent(mid));
  }
  function bridgeReminders() {
    return bget('reminders');
  }
  function bridgeReminderAdd(r) {
    return bpost('reminders/add', r);
  }

  /* 拉一次设置，失败就用默认值 */
  async function loadPrefs() {
    try {
      var r = await bridgePrefs();
      if (r && r.data && typeof r.data === 'object') {
        for (var k in r.data) {
          if (Object.prototype.hasOwnProperty.call(r.data, k)) prefs[k] = r.data[k];
        }
      }
    } catch (e) {}
    return prefs;
  }

  async function savePrefs(patch) {
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) prefs[k] = patch[k];
    }
    try {
      await bridgePrefsSet(patch);
    } catch (e) {}
    return prefs;
  }

  /* ===================== B 站接口 ===================== */

  function apiSuitDetail(id) {
    return jget(API + '/x/garb/mall/item/suit/v2?part=suit&item_id=' + id).then(function (r) {
      if (toEquip(r)) return r;
      /* 公开接口拿不到时试内部接口——预购 / 收藏集主题套装走这条 */
      return jget(API + '/x/garb/internal/v2/mall/suit/detail?item_id=' + id + '&part=suit');
    });
  }
  /* 装扮详情（v2）。收藏集的主题套装也用这个 id 直接查。 */
  function apiSuitDetailV2(id) {
    return jget(API + '/x/garb/v2/mall/suit/detail?item_id=' + id + '&part=suit');
  }
  /* 依次试多个接口，返回第一个 code==0 的响应。
     收藏集接口在 App 与 web 端不一样，多试几个总比只试一个强。 */
  async function tryEndpoints(urls) {
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await jget(urls[i]);
        if (r && r.code === 0) return r;
      } catch (e) {}
    }
    return null;
  }
  /* 收藏集的奖励清单。
     App 侧真实接口是 x/vas/dlc_act/*（不是 web 的 lottery_home_detail）；
     响应结构：data.collect_list.collect_infos[]（新版）或 data.collect_list[]（旧版）。 */
  function apiCollectRewards(actId, lotteryId) {
    var base = 'act_id=' + actId + (lotteryId ? '&lottery_id=' + lotteryId : '');
    return tryEndpoints([
      API + '/x/vas/dlc_act/lottery/home_detail/v2?' + base,
      API + '/x/vas/dlc_act/act/basic/v2?' + base,
      API + '/x/vas/dlc_act/module/list?' + base,
      API + '/x/vas/dlc_act/asset_bag_list?' + base,
      API + '/x/vas/dlc_act/asset_bag_v2?' + base
    ]);
  }
  /* 收藏集主页详情（返回 collect_infos 里的兑换物） */
  function apiLotteryDetail(actId, lotteryId) {
    var base = 'act_id=' + actId + (lotteryId ? '&lottery_id=' + lotteryId : '');
    return tryEndpoints([
      API + '/x/vas/dlc_act/lottery/home_detail/v2?' + base,
      API + '/x/vas/dlc_act/act/basic/v2?' + base,
      API + '/x/vas/dlc_act/act/card/detail?' + base,
      API + '/x/vas/dlc_act/card/widget_info_v2?' + base,
      API + '/x/vas/dlc_act/lottery_home_detail?' + base
    ]);
  }
  /* 收藏集卡片的开屏信息（收藏集专属开屏动画） */
  function apiCollectSplash(actId) {
    return jget(API + '/x/vas/dlc_act/card/splash_info?act_id=' + actId);
  }
  /* 官方搜索：服务端搜，装扮(part_id=6)和收藏集(part_id=0)都会返回 */
  function apiSearch(kw) {
    return jget(
      API + '/x/garb/v2/mall/home/search?key_word=' + encodeURIComponent(kw) + '&pn=1&ps=20'
    );
  }
  /* 装扮目录分页：part_id 默认 6（装扮），sort_type 默认 2。全站约 3400 套 */
  function apiCatalogPage(pn, partId, sortType) {
    var p = partId || 6;
    var s = sortType === undefined || sortType === null ? 2 : sortType;
    return jget(
      API +
        '/x/garb/v2/mall/partition/item/list?part_id=' +
        p +
        '&pn=' +
        pn +
        '&sort_type=' +
        s
    );
  }
  /* 当前登录用户 mid（用于 Surge 侧只改自己的评论装扮） */
  function apiNav() {
    return jget(API + '/x/web-interface/nav');
  }

  /* ===================== 纯逻辑（可测试） ===================== */

  /* skin 组件的配色字段 -> user_equip.data */
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

  /* 一个 suit_items 子项 -> 归一化组件对象。
     把 properties 摊平到顶层，再补上 item_id / name，Surge 侧按类型取用。 */
  function componentOf(kind, entry) {
    if (!entry || typeof entry !== 'object') return null;
    var p = entry.properties || {};
    var out = { kind: kind, id: entry.item_id || 0, name: entry.name || '' };
    for (var k in p) {
      if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
    }
    /* 各类型的「包/图」地址做一次归一，方便 Surge 侧统一读取 */
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

  /* 一个「容器 + skin 子项」-> user_equip 配置。
     同时把容器 suit_items 里的其它组件（loading/card/…）一并收进 components。 */
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

    /* 把整套套装的所有组件都收进来。没有 suit_items 时至少放进 skin 自己。 */
    var si = (container && container.suit_items) || null;
    if (si && typeof si === 'object') {
      for (var i = 0; i < COMPONENTS.length; i++) {
        var kind = COMPONENTS[i];
        var arr = si[kind];
        var c = componentOf(kind, Array.isArray(arr) ? arr[0] : arr);
        if (c) equip.components[kind] = c;
      }
    }
    if (!equip.components.skin) {
      equip.components.skin = componentOf('skin', skin);
    }
    return equip;
  }

  /* 装扮详情响应 -> user_equip 配置 */
  function toEquip(d) {
    var da = d && d.data;
    if (!da) return null;
    var skins = (da.suit_items && da.suit_items.skin) || [];
    return equipFrom(da, skins[0]);
  }

  /* 递归找出所有「带装扮包的容器」 */
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

  function scanState(win) {
    var out = [];
    var roots = [
      win.__INITIAL_MIRROR__,
      win.__INITIAL_STATE__,
      win.__NUXT__,
      win.__PRELOADED_STATE__,
      win.__DATA__,
      win.__GARB_DATA__
    ];
    for (var i = 0; i < roots.length; i++) {
      if (roots[i]) harvest(roots[i], out, 0);
    }
    return out;
  }

  /* 从 URL 与 DOM 里收集「可能指向装扮」的 id */
  function collectIds(doc, loc) {
    var seen = {};
    var out = [];
    function add(v) {
      var s = String(v == null ? '' : v).replace(/\D/g, '');
      if (!s || s.length < 3 || seen[s]) return;
      seen[s] = 1;
      out.push(s);
    }

    var s = (loc.search || '') + '&' + (loc.hash || '');
    var re = /[?&](?:id|item_id|suit_id)=(\d+)/g;
    var m;
    while ((m = re.exec(s)) !== null) add(m[1]);

    try {
      var links = doc.querySelectorAll ? doc.querySelectorAll('a[href]') : [];
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (!/suit\/detail|mall|suit-preview|garbDetail/i.test(href)) continue;
        add(idFrom(href));
      }
    } catch (e) {}

    return out.slice(0, MAX_RESOLVE);
  }

  /* 从 URL 里取数字参数 */
  function param(loc, name) {
    var s = (loc.search || '') + '&' + (loc.hash || '');
    var m = new RegExp('[?&]' + name + '=(\\d+)').exec(s);
    return m ? m[1] : '';
  }

  /* 收藏集奖励 -> 可尝试的装扮 id。
     type=4 Suit：redeem_item_id 本身就是装扮 id。
     type=5 MaterialCombination（动态主题套装）：是若干子项 id，用 & 分隔。
     兼容两种 collect_list 结构：
       新版 data.collect_list.collect_infos[]（lottery_home_detail）
       旧版 data.collect_list[]（lottery/home_detail/v2） */
  function collectInfos(raw) {
    var cl = raw && raw.data && raw.data.collect_list;
    if (!cl) return [];
    if (Array.isArray(cl)) return cl;
    if (Array.isArray(cl.collect_infos)) return cl.collect_infos;
    return [];
  }

  function mapRedeemIds(raw) {
    var out = [];
    var list = collectInfos(raw);
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var t = Number(it.redeem_item_type);
      if (t !== 4 && t !== 5) continue;
      var parts = String(it.redeem_item_id || '').split('&');
      for (var j = 0; j < parts.length; j++) {
        var s = parts[j].replace(/\D/g, '');
        if (s.length >= 5) out.push(s);
      }
    }
    return out;
  }

  /* 收藏集兑换物 -> 装扮候选（id + 名字 + 预览图），用于空状态里给线索 */
  function mapRedeemItems(raw) {
    var out = [];
    var list = collectInfos(raw);
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var t = Number(it.redeem_item_type);
      if (t !== 4 && t !== 5) continue;
      var name = it.redeem_item_name || '';
      var img = it.redeem_item_image || '';
      var jump = it.jump_url || it.garb_suit_url || '';
      if (!name && !img && !jump) continue;
      out.push({ name: name, preview: img, jump: jump, type: t });
    }
    return out;
  }

  /* 有没有任何一个组件（收藏集 / 资产列表抓到的「单组件」候选没有 package_url） */
  function hasAnyComponent(e) {
    var c = e && e.components;
    if (!c || typeof c !== 'object') return false;
    for (var k in c) {
      if (Object.prototype.hasOwnProperty.call(c, k)) return true;
    }
    return false;
  }

  /* 兑换物类型名 -> 组件。B站自己就是按 redeem_item_type_name 显示的，
     数字类型各活动不统一（实测见过 1/3/4/5/1001），所以按名字映射最稳。 */
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
    var s = String(name == null ? '' : name).trim();
    if (!s) return '';
    if (TYPE_NAME_COMPONENT[s]) return TYPE_NAME_COMPONENT[s];
    for (var k in TYPE_NAME_COMPONENT) {
      if (s.indexOf(k) >= 0) return TYPE_NAME_COMPONENT[k];
    }
    return '';
  }

  /* 收藏集卡片列表 (card_list) 提取为动态卡片候选 */
  function mapCollectionCards(raw) {
    var out = [];
    var list = (raw && raw.data && raw.data.card_list) || [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var img = c.card_img || '';
      if (!isHttpUrl(img)) continue;
      var cid = c.card_type_id || c.id || (i + 1);
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
    return out;
  }

  /* 收藏集兑换物 -> 单组件候选。
     头像挂件 / 评论背景 / 动态卡片 这类**不是套装**，拿 id 去查详情查不到，
     但 collect_infos 里直接给了 redeem_item_image —— 有图就能当候选用。
     主题套装那种只带 id，标 needResolve 交给上层去拉详情。 */
  function mapRedeemComponents(raw) {
    var out = [];
    var list = collectInfos(raw);
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var kind = kindOfTypeName(it.redeem_item_type_name);
      var img = it.redeem_item_image || it.redeem_detail_image || '';
      var idStr = String(it.redeem_item_id || '');
      var name = it.redeem_item_name || '';
      var id = /^\d+$/.test(idStr) ? Number(idStr) : idStr;
      var hasImg = /^https?:\/\//.test(img);

      if (!kind || kind === 'skin' || !hasImg) {
        if (id) {
          var fb = {};
          if (hasImg) {
            fb.card = { id: id || 0, name: name, image: img, url: img };
            fb.card_bg = { id: id || 0, name: name, image: img, url: img };
            if (kind === 'skin') fb.skin = { id: id || 0, name: name, preview: img };
          }
          out.push({
            id: id,
            name: name,
            preview: hasImg ? img : '',
            components: fb,
            from: 'collect',
            needResolve: true,
            typeName: it.redeem_item_type_name || ''
          });
        }
        continue;
      }

      var comp = { id: id || 0, name: name, url: img };
      if (kind === 'pendant') comp.image = img;
      var comps = {};
      comps[kind] = comp;
      out.push({
        id: id || name,
        name: name,
        preview: img,
        ver: 1700000000,
        components: comps,
        from: 'collect',
        partial: true,
        typeName: it.redeem_item_type_name || ''
      });
    }
    return out;
  }

  function mergeById() {
    var out = [];
    var seen = {};
    for (var i = 0; i < arguments.length; i++) {
      var list = arguments[i] || [];
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!e || !e.id || seen[e.id]) continue;
        /* 只带 id 的（收藏集主题套装）也留，后面补一次详情 */
        if (!e.package_url && !e.needResolve && !hasAnyComponent(e)) continue;
        seen[e.id] = 1;
        out.push(e);
      }
    }
    return out;
  }

  /* 一套装扮带了哪些组件（用于卡片角标） */
  function componentBadges(it) {
    if (it && it.isChronos) return ['Chronos 开屏'];
    if (it && it.isSplash) return ['开屏动画'];
    var c = it && it.components;
    if (!c) return [];
    var out = [];
    for (var i = 0; i < COMPONENTS.length; i++) {
      var k = COMPONENTS[i];
      if (k === 'skin') continue;
      if (c[k]) out.push(COMPONENT_LABEL[k] || k);
    }
    return out;
  }

  /* Surge 侧捕获到的 Chronos 包 -> 候选卡片。
     注意：包体有 RSA 签名，只能回放服务端发过的，不能凭空造。 */
  function mapChronosItems(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      if (!it.url || !it.sign) continue;
      out.push({
        id: 'ch' + (it.id || i),
        name: 'Chronos 开屏' + (it.service_key ? ' · ' + it.service_key : '') + ' #' + (i + 1),
        preview: '',
        isChronos: true,
        chronos: {
          id: it.id,
          service_key: it.service_key || '',
          url: it.url,
          md5: it.md5 || '',
          sign: it.sign
        }
      });
    }
    return out;
  }

  /* Surge 侧嗅探到的开屏 -> 候选卡片。brand=品牌开屏，event=活动开屏。 */
  function mapSplashItems(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      if (!it.thumb) continue;
      var kind = it.kind === 'event' ? 'event' : 'brand';
      out.push({
        id: 'sp' + kind + (it.id || i),
        name: (kind === 'event' ? '活动开屏' : '开屏动画') + ' #' + (it.id || i + 1),
        preview: it.thumb,
        isSplash: true,
        splash: {
          kind: kind,
          id: it.id,
          thumb: it.thumb,
          logo_url: it.logo_url || '',
          duration: 3000
        }
      });
    }
    return out;
  }

  /* ===================== 全量目录（兜底用） ===================== */

  /* 目录条目 -> 卡片数据。只有 id / 名字 / 封面，点开再去拉装扮包。 */
  function mapSuit(it) {
    it = it || {};
    var p = it.properties || {};
    var price = Number(p.sale_bp_forever_raw || 0) || 0;
    return {
      id: it.item_id,
      name: it.name,
      cover: p.image_cover || '',
      preview: p.image_cover || p.image_preview || '',
      cat: it.group_name || '',
      paid: price > 0,
      salePrice: price,
      owner_uid: p.owner_uid || ''
    };
  }

  /* 搜索响应：收藏集混在里面，只留装扮 */
  function mapSearch(raw) {
    var out = [];
    var list = (raw && raw.data && raw.data.list) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].part_id === 6) out.push(mapSuit(list[i]));
    }
    return out;
  }

  /* 搜索响应里的收藏集（part_id=0）。用户搜的常常是收藏集名，
     收藏集不是装扮，但它的「主题套装」上线后会变成装扮。 */
  function mapCollectHits(raw) {
    var out = [];
    var list = (raw && raw.data && raw.data.list) || [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.part_id !== 0) continue;
      var p = it.properties || {};
      out.push({
        id: it.item_id,
        name: it.name,
        upcoming: String(p.dlc_act_status) === '1',
        startAt: Number(p.dlc_sale_start_time || 0)
      });
    }
    return out;
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000);
    function p2(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return (
      d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
    );
  }

  function collectHint(hits, kw) {
    var lines = [];
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      lines.push(
        '· ' +
          h.name +
          (h.upcoming && h.startAt ? '\n    ' + fmtTime(h.startAt) + ' 开售' : '') +
          (h.upcoming
            ? '\n    <span data-remind="' +
              esc(h.id || h.name) +
              '" data-remind-name="' +
              esc(h.name) +
              '" data-remind-at="' +
              (h.startAt || 0) +
              '" style="color:' +
              PINK +
              '">' +
              esc(t('remind')) +
              '</span>'
            : '')
      );
    }
    return emptyHtml(
      '「' + kw + '」是收藏集，不是装扮。\n收藏集的「主题套装」要等它上线后才会出现：\n\n' +
        lines.join('\n') +
        '\n\n上线后再搜一次就能找到。'
    );
  }

  function mapCatalogPage(raw) {
    var out = [];
    var list = (raw && raw.data && raw.data.list) || [];
    for (var i = 0; i < list.length; i++) out.push(mapSuit(list[i]));
    return out;
  }

  /* ===================== 候选收集 ===================== */

  async function collectCandidates() {
    var stateHits = [];
    try {
      stateHits = scanState(window);
    } catch (e) {}

    /* 1) 本页嗅探到的（since = 进入本页的时刻） */
    var sniffed = [];
    try {
      var r = await bridgeSeen(enterTs);
      sniffed = (r && r.data) || [];
    } catch (e) {}

    /* 2) 之前在 App 原生页逛的时候抓到的（30 分钟内，不限本页）。
       收藏集是原生页，逛完再回面板，enterTs 早就过去了 —— 不带上这批就永远「没获取到」。 */
    var recent = [];
    try {
      var r2 = await bridgeSeen(0);
      recent = (r2 && r2.data) || [];
    } catch (e) {}

    /* 3) 持久候选：收藏集兑换物 / 已拥有资产列表，7 天有效。
       数量上限单独收一下，免得面板一开就是几十张卡。 */
    var found = [];
    try {
      var r3 = await bridgeFound();
      found = ((r3 && r3.data) || []).slice(0, 40);
    } catch (e) {}

    var merged = mergeById(sniffed, stateHits, found, recent);

    var ids = collectIds(document, location);

    /* 收藏集页：奖励清单里的 id 也一并试（「动态主题套装」在这里）。
       act_id 在 URL 上；lottery_id 可能没有，缺了拿不到数据，两个都试一遍。 */
    var actId = param(location, 'act_id');
    if (actId) {
      var rawList = [];
      try {
        rawList.push(await apiLotteryDetail(actId, param(location, 'lottery_id')));
      } catch (e) {}
      try {
        rawList.push(await apiCollectRewards(actId, param(location, 'lottery_id')));
      } catch (e) {}
      for (var r2i = 0; r2i < rawList.length; r2i++) {
        var extra = mapRedeemIds(rawList[r2i]);
        for (var n = 0; n < extra.length; n++) {
          if (ids.indexOf(extra[n]) < 0) ids.push(extra[n]);
        }
        /* 收藏集卡片列表 (card_list) 也是组件候选 */
        var cardHits = mapCollectionCards(rawList[r2i]);
        for (var ch = 0; ch < cardHits.length; ch++) {
          var dupC = false;
          for (var qc = 0; qc < merged.length; qc++) {
            if (String(merged[qc].id) === String(cardHits[ch].id)) {
              dupC = true;
              break;
            }
          }
          if (!dupC) merged.push(cardHits[ch]);
        }
        /* 头像挂件 / 评论背景这类不是套装，id 查不出详情，直接按图拼候选 */
        var partials = mapRedeemComponents(rawList[r2i]);
        for (var p = 0; p < partials.length; p++) {
          var dupP = false;
          for (var q = 0; q < merged.length; q++) {
            if (String(merged[q].id) === String(partials[p].id)) {
              dupP = true;
              break;
            }
          }
          if (!dupP) merged.push(partials[p]);
        }
      }
    }

    /* 只有 id 的候选（收藏集的主题套装）：在页面里补一次详情 */
    var pending = [];
    for (var m0 = 0; m0 < merged.length; m0++) {
      if (merged[m0] && merged[m0].needResolve && merged[m0].id) pending.push(m0);
    }
    for (var m1 = 0; m1 < pending.length && m1 < MAX_RESOLVE; m1++) {
      var idx = pending[m1];
      try {
        var full = toEquip(await apiSuitDetail(merged[idx].id));
        if (full) merged[idx] = full;
      } catch (e) {}
    }

    for (var i = 0; i < ids.length; i++) {
      var dup = false;
      for (var k = 0; k < merged.length; k++) {
        if (String(merged[k].id) === ids[i]) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      try {
        var e = toEquip(await apiSuitDetail(ids[i]));
        if (e) merged.push(e);
      } catch (err) {}
    }

    /* 补不出详情的（只有 id、也没图）丢掉，免得点「应用」才报错 */
    merged = merged.filter(function (x) {
      return x && (x.package_url || x.isSplash || x.isChronos || hasAnyComponent(x));
    });

    /* 开屏动画候选：Surge 侧嗅探到的 x/v2/splash/brand/list 与 event/list2 */
    try {
      var sr = await bridgeSplashList();
      var splashItems = mapSplashItems(sr && sr.data);
      for (var s = 0; s < splashItems.length; s++) merged.push(splashItems[s]);
    } catch (err2) {}

    /* Chronos 开屏包候选：Surge 侧捕获的 {url,md5,sign}（只能回放，不能造） */
    try {
      var cr = await bridgeChronosList();
      var chItems = mapChronosItems(cr && cr.data);
      for (var c2 = 0; c2 < chItems.length; c2++) merged.push(chItems[c2]);
    } catch (err3) {}

    return merged;
  }

  /* 把当前登录 mid 交给 Surge，用于「只改自己的评论装扮」 */
  function reportSelfMid() {
    apiNav()
      .then(function (r) {
        var mid = r && r.data && r.data.mid;
        if (mid) return bridgeSelfMid(mid);
      })
      .catch(function () {});
  }

  /* ===================== 应用 ===================== */

  async function applyEquip(equip) {
    /* Chronos 开屏包走单独的存储（回放服务端发过的三件套） */
    if (equip && equip.isChronos) {
      var cr = await bridgeChronosSet(equip.chronos);
      if (!cr || cr.code !== 0) throw new Error((cr && cr.msg) || '保存失败');
      return equip;
    }
    /* 开屏动画走单独的存储与注入点 */
    if (equip && equip.isSplash) {
      var sr = await bridgeSplashSet(equip.splash);
      if (!sr || sr.code !== 0) throw new Error((sr && sr.msg) || '保存失败');
      return equip;
    }
    try {
      await bridgeGalleryAdd(equip);
    } catch (e) {}
    var r = await bridgeSet(equip);
    if (!r || r.code !== 0) throw new Error((r && r.msg) || '保存失败');
    return equip;
  }

  /* ===================== 提示 ===================== */

  var toastEl = null;
  function toast(msg, ok) {
    if (toastEl) toastEl.remove();
    toastEl = mk(
      'div',
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;' +
        'max-width:76vw;padding:12px 18px;border-radius:12px;font-size:14px;line-height:1.5;' +
        'color:#fff;text-align:center;white-space:pre-line;word-break:break-word;' +
        'background:' + (ok ? 'rgba(0,0,0,.82)' : 'rgba(214,48,49,.92)') +
        ';-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)',
      esc(msg)
    );
    document.body.appendChild(toastEl);
    setTimeout(function () {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
    }, 2400);
  }

  /* ===================== 卡片 ===================== */

  function cardHtml(it) {
    var badges = componentBadges(it);
    var badgeHtml = badges.length
      ? '<div style="position:absolute;left:6px;top:6px;display:flex;flex-wrap:wrap;gap:4px;' +
        'max-width:90%">' +
        badges
          .map(function (b) {
            return (
              '<span style="font-size:10px;line-height:16px;padding:0 6px;border-radius:8px;' +
              'background:rgba(0,0,0,.55);color:#fff">' +
              esc(b) +
              '</span>'
            );
          })
          .join('') +
        '</div>'
      : '';
    var note = it.note
      ? '<div style="margin-top:2px;font-size:11px;color:#9499a0;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap">' +
        esc(it.note) +
        '</div>'
      : '';
    return (
      '<div data-id="' +
      it.id +
      '" data-name="' +
      esc(it.name || '') +
      '" data-detail="1" style="background:#fff;border-radius:12px;overflow:hidden;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.07);cursor:pointer">' +
      '<div style="position:relative;width:100%;aspect-ratio:1/1;background:#f4f4f5;overflow:hidden">' +
      (it.preview
        ? '<img src="' + esc(thumb(it.preview)) + '" loading="lazy" ' +
          'style="display:block;width:100%;height:100%;object-fit:cover">'
        : '') +
      badgeHtml +
      '</div>' +
      '<div style="padding:8px 10px 10px">' +
      '<div style="font-size:13px;line-height:1.35;color:#18191c;overflow:hidden;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:35px">' +
      esc(it.name) + '</div>' +
      note +
      '<div data-apply="' + it.id + '" style="margin-top:8px;height:30px;line-height:30px;' +
      'text-align:center;border-radius:15px;background:' + PINK + ';color:#fff;font-size:12px">' +
      t('apply') +
      '</div>' +
      '</div></div>'
    );
  }

  /* 装扮详情：大图 + 组件清单 + 来源 / 价格。没有预览图时退化成纯文字。 */
  function detailHtml(it) {
    var rows = [];
    if (it.components) {
      for (var i = 0; i < COMPONENTS.length; i++) {
        var k = COMPONENTS[i];
        var c = it.components[k];
        if (!c) continue;
        rows.push(
          '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f4f4f5">' +
            '<div style="flex:none;width:84px;font-size:12px;color:#61666d">' +
            esc(COMPONENT_LABEL[k] || k) +
            '</div>' +
            '<div style="flex:1;min-width:0;font-size:12px;color:#18191c;word-break:break-all">' +
            esc(c.name || c.id || '-') +
            '</div></div>'
        );
      }
    }
    var meta = [];
    if (it.owner_uid) meta.push('UP ' + it.owner_uid);
    if (it.salePrice) meta.push(t('price') + ' ' + it.salePrice);
    else if (it.paid === false) meta.push(t('free'));

    return (
      (it.preview
        ? '<div style="width:100%;aspect-ratio:1/1;background:#f4f4f5;border-radius:12px;' +
          'overflow:hidden;margin-bottom:12px"><img src="' + esc(it.preview) + '" ' +
          'style="display:block;width:100%;height:100%;object-fit:cover"></div>'
        : '') +
      (rows.length
        ? '<div style="margin-bottom:10px">' +
          '<div style="font-size:13px;color:#61666d;margin-bottom:2px">' + t('components') + '</div>' +
          rows.join('') +
          '</div>'
        : '') +
      (meta.length
        ? '<div style="font-size:12px;color:#9499a0">' + esc(meta.join(' · ')) + '</div>'
        : '')
    );
  }

  function openDetail(it) {
    openSheet(it.name || t('detail'), t('detail'), [], detailHtml(it));
    var body = panel.querySelector('#bss-body');
    var btn = mk(
      'div',
      'margin-top:16px;height:38px;line-height:38px;text-align:center;border-radius:19px;' +
        'background:' + PINK + ';color:#fff;font-size:14px',
      t('apply')
    );
    btn.addEventListener('click', function () {
      closePanel();
      doApply(it);
    });
    body.appendChild(btn);
  }

  /* ===================== 面板 ===================== */

  var panel = null;

  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  /* 通用底部面板：标题 + 副标题 + 网格 + 右上角动作 */
  function openSheet(title, subtitle, actions, bodyHtml) {
    closePanel();

    panel = mk(
      'div',
      'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);' +
        'display:flex;align-items:flex-end'
    );

    var sheet = mk(
      'div',
      'width:100%;max-height:82vh;background:#fff;border-radius:16px 16px 0 0;' +
        'display:flex;flex-direction:column;overflow:hidden;' +
        'font-family:-apple-system,system-ui,sans-serif'
    );

    var actionHtml = (actions || [])
      .map(function (a) {
        return (
          '<span data-act="' + esc(a.key) + '" style="font-size:12px;color:' +
          (a.pink ? PINK : '#9499a0') + ';margin-left:14px">' + esc(a.label) + '</span>'
        );
      })
      .join('');

    sheet.innerHTML =
      '<div style="flex:none;padding:16px 16px 10px">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between">' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-size:16px;font-weight:600;color:#18191c">' + esc(title) + '</div>' +
      (subtitle
        ? '<div style="margin-top:4px;font-size:12px;color:#9499a0">' + esc(subtitle) + '</div>'
        : '') +
      '</div>' +
      '<div style="flex:none;padding-left:10px">' + actionHtml +
      '<span data-act="close" style="font-size:20px;color:#9499a0;margin-left:14px;' +
      'line-height:1">&times;</span></div>' +
      '</div></div>' +
      '<div id="bss-body" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
      'padding:0 16px calc(env(safe-area-inset-bottom,0px) + 20px)">' + bodyHtml + '</div>';

    panel.appendChild(sheet);
    panel.addEventListener('click', function (e) {
      if (e.target === panel) closePanel();
    });
    document.body.appendChild(panel);
    return sheet;
  }

  function gridHtml(list) {
    return (
      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">' +
      list.map(cardHtml).join('') +
      '</div>'
    );
  }

  function emptyHtml(text) {
    return (
      '<div style="padding:44px 0;text-align:center;color:#9499a0;font-size:13px;' +
      'line-height:1.8;white-space:pre-line">' + esc(text) + '</div>'
    );
  }

  /* 选中列表：1 个直接应用，多个弹选择 */
  async function runApply() {
    if (!launcher) return;
    launcher.textContent = t('scanning');
    launcher.style.opacity = '.7';

    var list;
    try {
      list = await collectCandidates();
    } catch (e) {
      list = [];
    }

    launcher.textContent = t('apply');
    launcher.style.opacity = '1';

    if (list.length === 0) return showEmpty();
    if (list.length === 1) return doApply(list[0]);

    openSheet(
      t('pick'),
      t('pickSub', { n: list.length }),
      [],
      gridHtml(list)
    );
    bindGridActions(panel.querySelector('#bss-body'), list);
  }

  /* 自动扫描：设置里开了之后，进页面若有唯一候选就直接注入，不打扰。 */
  var autoScanned = '';
  async function autoScanOnce() {
    if (!prefs.autoScan) return;
    var key = location.pathname + location.search;
    if (key === autoScanned) return;
    autoScanned = key;
    var list;
    try {
      list = await collectCandidates();
    } catch (e) {
      return;
    }
    if (list.length === 1) doApply(list[0]);
  }

  function bindGridActions(root, list) {
    if (!root) return;
    root.addEventListener('click', function (e) {
      var ap = e.target.closest && e.target.closest('[data-apply]');
      var card = e.target.closest && e.target.closest('[data-id]');
      if (!card) return;
      var id = (ap || card).getAttribute('data-apply') || card.getAttribute('data-id');
      var hit = null;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) {
          hit = list[i];
          break;
        }
      }
      if (!hit) return;
      /* 点「应用」直接注入；点卡片看详情 */
      if (ap) {
        closePanel();
        doApply(hit);
        return;
      }
      if (card.getAttribute('data-detail')) {
        openDetail(hit);
        return;
      }
      closePanel();
      doApply(hit);
    });
  }

  async function doApply(equip) {
    if (launcher) launcher.textContent = t('applying');
    try {
      await applyEquip(equip);
      if (launcher) launcher.textContent = t('applied');
      var extra = componentBadges(equip);
      toast(
        '已注入「' + equip.name + '」' +
          (extra.length ? '\n含 ' + extra.join(' / ') : '') +
          '\n杀掉后台重进 B 站即可生效',
        true
      );
    } catch (e) {
      toast('失败：' + e.message);
    }
    setTimeout(function () {
      if (launcher) launcher.textContent = t('apply');
    }, 2600);
  }

  /* 本页没找到：给「浏览全部」兜底 + 藏馆里之前用过的 + 设置入口 */
  async function showEmpty() {
    var cur = null;
    var gal = [];
    var equips = {};
    var rems = [];
    try {
      var g = await bridgeGet();
      cur = g && g.data;
    } catch (e) {}
    try {
      var r = await bridgeGallery();
      gal = (r && r.data) || [];
    } catch (e) {}
    try {
      var eq = await bridgeEquips();
      equips = (eq && eq.data) || {};
    } catch (e) {}
    try {
      var rm = await bridgeReminders();
      rems = (rm && rm.data) || [];
    } catch (e) {}

    var acts = [
      { key: 'browse', label: t('browse'), pink: true },
      { key: 'settings', label: t('settings') }
    ];
    if (cur && cur.name) acts.push({ key: 'clear', label: t('clear') });

    var isCard = /digital-card/.test(location.pathname || '');
    var tip = isCard ? t('emptyCard') : t('empty');

    var galList = groupGallery(gal, equips);

    var body = emptyHtml(tip);

    if (rems.length) {
      body +=
        '<div style="margin:2px 0 10px;font-size:13px;color:#61666d">' +
        esc(t('remind')) +
        '</div>' +
        rems
          .map(function (x) {
            return (
              '<div style="padding:8px 0;font-size:13px;color:#18191c">' +
              esc(x.name) +
              (x.startAt ? ' · ' + esc(fmtTime(x.startAt)) : '') +
              '</div>'
            );
          })
          .join('');
    }

    if (galList.length) {
      body +=
        '<div style="margin:2px 0 10px;font-size:13px;color:#61666d">' +
        esc(t('gallery')) +
        '</div>' +
        gridHtml(galList);
    }

    openSheet(t('apply'), cur && cur.name ? '当前：' + cur.name : '', acts, body);
    bindGridActions(panel.querySelector('#bss-body'), galList);

    var browseBtn = panel.querySelector('[data-act="browse"]');
    if (browseBtn) {
      browseBtn.addEventListener('click', function () {
        openBrowse();
      });
    }

    var setBtn = panel.querySelector('[data-act="settings"]');
    if (setBtn) {
      setBtn.addEventListener('click', function () {
        openSettings();
      });
    }

    var clearBtn = panel.querySelector('[data-act="clear"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', async function () {
        await bridgeClear();
        closePanel();
        toast('已清除注入的装扮', true);
      });
    }
  }

  /* 兜底：全站装扮目录（约 3400 套）。
     搜索走服务端；分类用已加载条目的 group_name 做前端筛选；
     排序走 sort_type；还能直接输 ID。 */
  async function openBrowse() {
    openSheet(
      t('all'),
      t('allSub'),
      [{ key: 'byid', label: t('byId') }],
      '<input id="bss-q" placeholder="' + esc(t('search')) + '" ' +
        'style="width:100%;box-sizing:border-box;height:36px;padding:0 14px;border:none;' +
        'border-radius:18px;background:#f4f4f5;font-size:13px;outline:none">' +
        '<div id="bss-tools" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;' +
        'align-items:center;font-size:12px"></div>' +
        '<div id="bss-cats" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px"></div>' +
        '<div id="bss-grid" style="margin-top:12px"></div>' +
        '<div id="bss-more" style="padding:18px 0;text-align:center;font-size:12px;' +
        'color:#9499a0"></div>'
    );

    var body = panel.querySelector('#bss-body');
    var qEl = body.querySelector('#bss-q');
    var toolsEl = body.querySelector('#bss-tools');
    var catsEl = body.querySelector('#bss-cats');
    var gridEl = body.querySelector('#bss-grid');
    var moreEl = body.querySelector('#bss-more');

    var st = {
      pn: 0,
      done: false,
      loading: false,
      kw: '',
      timer: 0,
      sort: 2,
      cat: '',
      all: [],
      shown: []
    };

    function chip(label, active, onTap) {
      var el = mk(
        'span',
        'padding:3px 10px;border-radius:12px;cursor:pointer;' +
          'background:' + (active ? PINK : '#f4f4f5') + ';' +
          'color:' + (active ? '#fff' : '#61666d'),
        esc(label)
      );
      el.addEventListener('click', onTap);
      return el;
    }

    function renderTools() {
      toolsEl.innerHTML = '';
      toolsEl.appendChild(chip(t('sortNew'), st.sort === 2, function () {
        st.sort = 2;
        reset();
      }));
      toolsEl.appendChild(chip(t('sortHot'), st.sort === 1, function () {
        st.sort = 1;
        reset();
      }));
      var idWrap = mk('span', 'display:inline-flex;gap:6px;align-items:center');
      idWrap.innerHTML =
        '<input id="bss-id" placeholder="' + esc(t('idPlaceholder')) + '" ' +
        'style="width:96px;height:26px;padding:0 10px;border:none;border-radius:13px;' +
        'background:#f4f4f5;font-size:12px;outline:none">' +
        '<span id="bss-idgo" style="color:' + PINK + ';cursor:pointer">' + esc(t('go')) + '</span>';
      toolsEl.appendChild(idWrap);
      var idEl = toolsEl.querySelector('#bss-id');
      var goEl = toolsEl.querySelector('#bss-idgo');
      goEl.addEventListener('click', function () {
        var v = (idEl.value || '').replace(/\D/g, '');
        if (v) {
          closePanel();
          applyById(v);
        }
      });
    }

    function renderCats() {
      catsEl.innerHTML = '';
      var names = [];
      var seen = {};
      for (var i = 0; i < st.all.length; i++) {
        var g = st.all[i].cat;
        if (g && !seen[g]) {
          seen[g] = 1;
          names.push(g);
        }
      }
      if (!names.length) return;
      catsEl.appendChild(chip('全部', !st.cat, function () {
        st.cat = '';
        applyFilter();
      }));
      for (var j = 0; j < names.length && j < 12; j++) {
        (function (name) {
          catsEl.appendChild(chip(name, st.cat === name, function () {
            st.cat = name;
            applyFilter();
          }));
        })(names[j]);
      }
    }

    function applyFilter() {
      var list = st.all;
      if (st.cat) {
        list = list.filter(function (x) {
          return x.cat === st.cat;
        });
      }
      st.shown = list;
      gridEl.innerHTML = list.length ? gridHtml(list) : emptyHtml('没有匹配的装扮');
      renderCats();
    }

    function reset() {
      st.pn = 0;
      st.done = false;
      st.all = [];
      st.cat = '';
      gridEl.innerHTML = '';
      moreEl.textContent = '';
      renderTools();
      renderCats();
      loadMore();
    }

    function loadMore() {
      if (st.loading || st.done || st.kw) return;
      st.loading = true;
      moreEl.textContent = t('loading');
      var pn = st.pn + 1;
      apiCatalogPage(pn, 6, st.sort)
        .then(function (raw) {
          var list = mapCatalogPage(raw);
          if (!list.length) {
            st.done = true;
            moreEl.textContent = t('noMore');
          } else {
            st.pn = pn;
            for (var i = 0; i < list.length; i++) st.all.push(list[i]);
            applyFilter();
            moreEl.textContent = '';
          }
        })
        .catch(function (e) {
          moreEl.textContent = '加载失败：' + e.message;
        })
        .then(function () {
          st.loading = false;
        });
    }

    function doSearch(kw) {
      if (!kw) {
        reset();
        return;
      }
      moreEl.textContent = t('loading');
      apiSearch(kw)
        .then(function (raw) {
          var list = mapSearch(raw);
          if (list.length) {
            st.all = list;
            st.cat = '';
            applyFilter();
            moreEl.textContent = '';
          } else {
            var hits = mapCollectHits(raw);
            gridEl.innerHTML = hits.length
              ? collectHint(hits, kw)
              : emptyHtml('没搜到「' + kw + '」\n换个关键词试试');
            catsEl.innerHTML = '';
            moreEl.textContent = '';
          }
        })
        .catch(function (e) {
          moreEl.textContent = '搜索失败：' + e.message;
        });
    }

    qEl.addEventListener('input', function () {
      st.kw = qEl.value.trim();
      clearTimeout(st.timer);
      st.timer = setTimeout(function () {
        doSearch(st.kw);
      }, 400);
    });

    /* 触底加载更多 */
    body.addEventListener('scroll', function () {
      if (st.kw || st.loading || st.done) return;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 400) loadMore();
    });

    /* 目录条目只有 id / 名字 / 封面，点了再去拉装扮包 */
    gridEl.addEventListener('click', function (e) {
      var rem = e.target.closest && e.target.closest('[data-remind]');
      if (rem) {
        bridgeReminderAdd({
          id: rem.getAttribute('data-remind'),
          name: rem.getAttribute('data-remind-name'),
          startAt: Number(rem.getAttribute('data-remind-at')) || 0
        }).then(function () {
          toast(t('remindAdded'), true);
        });
        return;
      }
      var ap = e.target.closest && e.target.closest('[data-apply]');
      var card = e.target.closest && e.target.closest('[data-id]');
      if (!card) return;
      var id = (ap || card).getAttribute('data-apply') || card.getAttribute('data-id');
      if (ap) {
        closePanel();
        applyById(id);
        return;
      }
      /* 目录里只有封面，没有组件；点开就先拉详情再展示 */
      openCatalogDetail(id, card.getAttribute('data-name') || '');
    });

    renderTools();
    loadMore();
  }

  /* 目录条目点开：先拉详情，再弹详情面板 */
  async function openCatalogDetail(id, name) {
    toast(t('loading'));
    var equip = null;
    try {
      equip = toEquip(await apiSuitDetail(id));
    } catch (e) {}
    if (!equip) {
      toast('这套装扮拿不到装扮包');
      return;
    }
    if (name && !equip.name) equip.name = name;
    openDetail(equip);
  }

  async function applyById(id) {
    try {
      var equip = toEquip(await apiSuitDetail(id));
      if (!equip) throw new Error('这套装扮拿不到装扮包');
      await doApply(equip);
    } catch (e) {
      if (launcher) launcher.textContent = '应用装扮';
      toast('失败：' + e.message);
    }
  }

  /* ===================== 设置 / 导出导入 ===================== */

  /* 自定义开屏图：品牌开屏那条路会把我们塞的条目 unshift 进 data.list / data.show，
     不依赖服务端下发候选 —— 所以随便给一张图就能当开屏用。
     活动开屏要 md5 校验，改图得先把图拉下来算 md5，这一步 Surge 侧会做；
     Chronos 开屏有服务端 RSA 签名，只能从候选里回放。 */
  function openSplashSet() {
    openSheet(
      '自定义开屏图',
      '填一张图片直链（竖图更好看）。保存后杀掉后台重进 B站。',
      [
        { key: 'save', label: '保存', pink: true },
        { key: 'clear', label: '清除' }
      ],
      '<input id="bss-sp" placeholder="https://i0.hdslb.com/bfs/....jpg" ' +
        'style="width:100%;box-sizing:border-box;height:40px;padding:0 12px;border:none;' +
        'border-radius:10px;background:#f4f4f5;font-size:12px;outline:none">' +
        '<div style="margin-top:10px;font-size:12px;color:#9499a0;line-height:1.7">' +
        '只走「品牌开屏」通道。活动开屏 / Chronos 开屏需要服务端签名或 md5，' +
        '只能从下面候选里挑。</div>'
    );

    var el = panel.querySelector('#bss-sp');
    var save = panel.querySelector('[data-act="save"]');
    if (save) {
      save.addEventListener('click', async function () {
        var v = el ? String(el.value || '').trim() : '';
        if (!/^https?:\/\//.test(v)) return toast('要一个 http(s) 图片直链');
        try {
          var r = await bridgeSplashSet({
            kind: 'brand',
            id: 900000001,
            thumb: v,
            duration: 3000
          });
          if (r && r.code === 0) {
            toast('已设为开屏图\n杀掉后台重进 B站生效', true);
            closePanel();
          } else {
            toast('保存失败：' + ((r && r.msg) || '未知'));
          }
        } catch (e) {
          toast('保存失败：' + e.message);
        }
      });
    }
    var clr = panel.querySelector('[data-act="clear"]');
    if (clr) {
      clr.addEventListener('click', async function () {
        try {
          await bget('splash/clear');
        } catch (e) {}
        toast('已清除', true);
        closePanel();
      });
    }
  }

  /* 设置面板：开关 + 导出/导入 + 诊断 */
  async function openSettings() {
    var diag = null;
    try {
      var d = await bridgeDiag();
      diag = d && d.data;
    } catch (e) {}

    function toggleRow(key, label) {
      return (
        '<div data-toggle="' + key + '" style="display:flex;align-items:center;' +
        'justify-content:space-between;padding:12px 0;border-bottom:1px solid #f4f4f5;' +
        'font-size:14px;color:#18191c;cursor:pointer">' +
        '<span>' + esc(label) + '</span>' +
        '<span style="font-size:12px;color:' + (prefs[key] ? PINK : '#9499a0') + '">' +
        (prefs[key] ? '开' : '关') + '</span></div>'
      );
    }

    var diagHtml = diag
      ? '<div style="margin-top:14px;padding:12px;border-radius:10px;background:#f4f4f5;' +
        'font-size:12px;line-height:1.9;color:#61666d;white-space:pre-line">' +
        esc(
          t('diag') + '\n' +
            '当前装扮: ' + (diag.equip ? diag.equip.name + ' (#' + diag.equip.id + ')' : '无') + '\n' +
            '组件: ' + (diag.equip && diag.equip.components.length ? diag.equip.components.join('/') : '—') + '\n' +
            '主题/加载动画: ' + (diag.equip ? (diag.equip.hasSkin ? '有' : '无') + ' / ' + (diag.equip.hasLoading ? '有' : '无') : '—') + '\n' +
            '我的 mid: ' + (diag.selfMid || '未知') + '\n' +
            '本页嗅探: ' + diag.seen + ' 条\n' +
            '持久候选: ' + (diag.found || 0) + ' 条（收藏集 / 资产列表，7 天）\n' +
            '藏馆: ' + diag.gallery + ' 套\n' +
            'Chronos 候选: ' + diag.chronos
        ) +
        '</div>'
      : '';

    openSheet(
      t('settings'),
      '',
      [
        { key: 'export', label: t('export'), pink: true },
        { key: 'import', label: t('import') },
        { key: 'splashset', label: '自定义开屏图' },
        { key: 'apilog', label: '导出接口日志' }
      ],
      toggleRow('allMembers', '评论装扮改所有人（默认只改自己）') +
        toggleRow('notify', '应用成功发系统通知') +
        toggleRow('autoScan', '进页面自动扫描') +
        toggleRow('grpcAll', 'gRPC 兜底：换掉所有 garb 图') +
        '<div data-toggle="lang" style="display:flex;align-items:center;justify-content:space-between;' +
        'padding:12px 0;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18191c;cursor:pointer">' +
        '<span>语言 / Language</span><span style="font-size:12px;color:' + PINK + '">' +
        (prefs.lang === 'en' ? 'EN' : '中文') +
        '</span></div>' +
        diagHtml
    );

    var body = panel.querySelector('#bss-body');
    body.addEventListener('click', async function (e) {
      var row = e.target.closest && e.target.closest('[data-toggle]');
      if (!row) return;
      var key = row.getAttribute('data-toggle');
      if (key === 'lang') {
        await savePrefs({ lang: prefs.lang === 'en' ? 'zh' : 'en' });
        openSettings();
        return;
      }
      var patch = {};
      patch[key] = !prefs[key];
      await savePrefs(patch);
      openSettings();
    });

    var expBtn = panel.querySelector('[data-act="export"]');
    if (expBtn) expBtn.addEventListener('click', openExport);
    var impBtn = panel.querySelector('[data-act="import"]');
    if (impBtn) impBtn.addEventListener('click', openImport);
    var spBtn = panel.querySelector('[data-act="splashset"]');
    if (spBtn) spBtn.addEventListener('click', openSplashSet);
    var logBtn = panel.querySelector('[data-act="apilog"]');
    if (logBtn) {
      logBtn.addEventListener('click', async function () {
        var r = null;
        try {
          r = await bridgeApiLog();
        } catch (e) {}
        var list = (r && r.data) || [];
        if (!list.length) {
          return toast('还没有接口日志。\n先去开屏 / 空间 / 收藏集页逛一圈再回来。');
        }
        var text = JSON.stringify(list, null, 1);
        openSheet(
          '接口日志',
          '共 ' + list.length + ' 条，长按全选复制',
          [],
          '<textarea readonly style="width:100%;box-sizing:border-box;height:320px;' +
            'border:1px solid #e3e5e7;border-radius:10px;padding:10px;font-size:11px;' +
            'line-height:1.5;font-family:monospace;color:#18191c;background:#fafafa">' +
            esc(text) +
            '</textarea>'
        );
      });
    }
  }

  /* 导出：把整份配置吐成文本，方便换设备 */
  async function openExport() {
    var txt = '';
    try {
      var r = await bridgeExport();
      txt = JSON.stringify(r && r.data);
    } catch (e) {
      txt = '导出失败：' + e.message;
    }
    openSheet(
      t('export'),
      t('copyHint'),
      [],
      '<textarea id="bss-exp" readonly style="width:100%;box-sizing:border-box;height:220px;' +
        'padding:12px;border:none;border-radius:10px;background:#f4f4f5;font-size:11px;' +
        'font-family:ui-monospace,Menlo,monospace;resize:none;outline:none">' +
        esc(txt) +
        '</textarea>' +
        '<div id="bss-copy" style="margin-top:12px;height:38px;line-height:38px;text-align:center;' +
        'border-radius:19px;background:' + PINK + ';color:#fff;font-size:14px">' +
        esc(t('copied')) +
        '</div>'
    );
    var el = panel.querySelector('#bss-exp');
    var cp = panel.querySelector('#bss-copy');
    if (cp) {
      cp.addEventListener('click', function () {
        if (el) {
          el.select();
          try {
            document.execCommand('copy');
          } catch (e) {}
        }
        toast(t('copied'), true);
      });
    }
  }

  /* 导入：粘一段之前导出的内容 */
  function openImport() {
    openSheet(
      t('import'),
      t('importHint'),
      [],
      '<textarea id="bss-imp" placeholder="' +
        esc(t('importHint')) +
        '" style="width:100%;box-sizing:border-box;height:220px;padding:12px;border:none;' +
        'border-radius:10px;background:#f4f4f5;font-size:11px;' +
        'font-family:ui-monospace,Menlo,monospace;resize:none;outline:none"></textarea>' +
        '<div id="bss-doimp" style="margin-top:12px;height:38px;line-height:38px;text-align:center;' +
        'border-radius:19px;background:' + PINK + ';color:#fff;font-size:14px">' +
        esc(t('doImport')) +
        '</div>'
    );
    var el = panel.querySelector('#bss-imp');
    var btn = panel.querySelector('#bss-doimp');
    if (btn) {
      btn.addEventListener('click', async function () {
        var raw = el ? el.value.trim() : '';
        if (!raw) return;
        var obj;
        try {
          obj = JSON.parse(raw);
        } catch (e) {
          toast('不是合法的导出内容');
          return;
        }
        try {
          var r = await bridgeImport(obj);
          if (r && r.code === 0) {
            toast('已导入 ' + ((r.data && r.data.sections) || 0) + ' 段配置\n杀后台重进生效', true);
            closePanel();
          } else {
            toast('导入失败：' + ((r && r.msg) || '未知'));
          }
        } catch (e) {
          toast('导入失败：' + e.message);
        }
      });
    }
  }

  /* 藏馆按账号分组 */
  function groupGallery(gal, equips) {
    var map = {};
    var mids = equips && typeof equips === 'object' ? Object.keys(equips) : [];
    for (var i = 0; i < mids.length; i++) {
      var mid = mids[i];
      var e = equips[mid];
      if (e && e.id) map[String(e.id)] = mid;
    }
    var out = [];
    for (var j = 0; j < gal.length; j++) {
      var it = gal[j];
      it.mid = map[String(it.id)] || '';
      out.push(it);
    }
    return out;
  }

  /* ===================== 悬浮按钮（可拖动） ===================== */

  var launcher = null;

  function mountLauncher() {
    if (launcher) return;
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    } catch (e) {}

    var pos =
      saved && saved.left != null
        ? 'left:' + saved.left + 'px;top:' + saved.top + 'px;'
        : 'left:56px;top:calc(env(safe-area-inset-top,0px) + 8px);';

    launcher = mk(
      'div',
      'position:fixed;z-index:2147483000;' + pos +
        'padding:7px 14px;border-radius:20px;background:' + PINK + ';color:#fff;' +
        'font-size:12px;font-weight:500;font-family:-apple-system,system-ui,sans-serif;' +
        'box-shadow:0 4px 16px rgba(251,114,153,.45);cursor:pointer;white-space:nowrap;' +
        'user-select:none;-webkit-user-select:none;touch-action:none;' +
        '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)',
      t('apply')
    );

    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;

    function down(e) {
      var t = e.touches ? e.touches[0] : e;
      var r = launcher.getBoundingClientRect();
      dragging = true;
      moved = false;
      sx = t.clientX;
      sy = t.clientY;
      ox = r.left;
      oy = r.top;
      launcher.style.left = ox + 'px';
      launcher.style.top = oy + 'px';
    }
    function move(e) {
      if (!dragging) return;
      var t = e.touches ? e.touches[0] : e;
      var dx = t.clientX - sx;
      var dy = t.clientY - sy;
      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      moved = true;
      if (e.cancelable) e.preventDefault();
      var w = launcher.offsetWidth;
      var h = launcher.offsetHeight;
      launcher.style.left = Math.min(Math.max(ox + dx, 4), window.innerWidth - w - 4) + 'px';
      launcher.style.top = Math.min(Math.max(oy + dy, 4), window.innerHeight - h - 4) + 'px';
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        var r = launcher.getBoundingClientRect();
        try {
          localStorage.setItem(
            POS_KEY,
            JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })
          );
        } catch (e) {}
      } else {
        runApply();
      }
    }

    launcher.addEventListener('touchstart', down, { passive: true });
    launcher.addEventListener('touchmove', move, { passive: false });
    launcher.addEventListener('touchend', up);
    launcher.addEventListener('mousedown', down);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);

    document.body.appendChild(launcher);
  }

  /* ===================== 路由 ===================== */

  var lastPath = '';

  function markEnter() {
    enterTs = Date.now();
  }

  /* 按钮该出现的页面：
     - /h5/mall/*                装扮商城、详情页、收藏集
     - /h5/garb/*                抽卡/数字藏品/装扮页
     - /blackboard/fe/*          收藏集的「主题套装」预览页与相关活动页
     - /garb/*                   收藏集大厅等 */
  function isTargetPage(p) {
    return (
      /h5\/(?:mall|garb)/.test(p) ||
      /blackboard\/fe\//.test(p) ||
      /garb\//.test(p)
    );
  }

  function route() {
    var p = (location.pathname || '') + (location.hash || '');
    if (!isTargetPage(p)) {
      if (launcher) {
        launcher.remove();
        launcher = null;
      }
      lastPath = '';
      return;
    }
    var key = location.pathname + location.search + location.hash;
    if (key === lastPath) return;
    lastPath = key;
    closePanel();
    mountLauncher();
    setTimeout(autoScanOnce, 300);
  }

  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    if (typeof orig !== 'function') return;
    history[m] = function () {
      markEnter();
      var r = orig.apply(this, arguments);
      setTimeout(route, 0);
      return r;
    };
  });
  window.addEventListener('popstate', function () {
    markEnter();
    setTimeout(route, 0);
  });
  window.addEventListener('hashchange', function () {
    markEnter();
    setTimeout(route, 0);
  });
  setInterval(route, 800);

  /* 先把设置拉下来（语言等），再决定按钮和路由 */
  loadPrefs().then(function () {
    if (document.body) route();
    else document.addEventListener('DOMContentLoaded', route);
  });

  reportSelfMid();

  /* 测试钩子 */
  window.__BSS_API__ = {
    COMPONENTS: COMPONENTS,
    COMPONENT_LABEL: COMPONENT_LABEL,
    idFrom: idFrom,
    param: param,
    thumb: thumb,
    isTargetPage: isTargetPage,
    mapRedeemIds: mapRedeemIds,
    mapRedeemItems: mapRedeemItems,
    mapRedeemComponents: mapRedeemComponents,
    kindOfTypeName: kindOfTypeName,
    collectInfos: collectInfos,
    mapSuit: mapSuit,
    mapSearch: mapSearch,
    mapCollectHits: mapCollectHits,
    fmtTime: fmtTime,
    collectHint: collectHint,
    mapCatalogPage: mapCatalogPage,
    equipFrom: equipFrom,
    toEquip: toEquip,
    harvest: harvest,
    scanState: scanState,
    collectIds: collectIds,
    mergeById: mergeById,
    componentOf: componentOf,
    componentBadges: componentBadges,
    mapSplashItems: mapSplashItems,
    mapChronosItems: mapChronosItems,
    detailHtml: detailHtml,
    groupGallery: groupGallery,
    LANGS: LANGS,
    skinData: skinData,
    cardHtml: cardHtml,
    enterTs: function () {
      return enterTs;
    },
    markEnter: markEnter
  };
})();
