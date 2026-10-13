/*
 * 哔哩哔哩装扮工作室 —— 注入到 www.bilibili.com/h5/mall/* 的页面脚本
 *
 * 按钮只有一个：「应用装扮」。点它就去**扫描当前页面**上出现的装扮，而不是翻全站目录。
 * 候选来自四个地方，按可靠性排序：
 *   1. Surge 嗅探到的接口响应（本页加载过的 x/garb/* x/vas/* 里含装扮包的条目）
 *   2. 页面 JS 状态（__INITIAL_MIRROR__ / __INITIAL_STATE__ 等）里递归找出的装扮对象
 *   3. DOM 里指向装扮详情页的链接
 *   4. 当前 URL 的参数
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

  /* ===================== B 站接口 ===================== */

  function apiSuitDetail(id) {
    return jget(API + '/x/garb/mall/item/suit/v2?part=suit&item_id=' + id).then(function (r) {
      if (toEquip(r)) return r;
      /* 公开接口拿不到时试内部接口——预购 / 收藏集主题套装走这条 */
      return jget(API + '/x/garb/internal/v2/mall/suit/detail?item_id=' + id + '&part=suit');
    });
  }
  /* 收藏集的奖励清单（v2 才带「动态主题套装」，v1 不带） */
  function apiCollectRewards(actId, lotteryId) {
    var q = '/x/vas/dlc_act/lottery/home_detail/v2?act_id=' + actId;
    if (lotteryId) q += '&lottery_id=' + lotteryId;
    return jget(API + q);
  }
  /* 官方搜索：服务端搜，装扮(part_id=6)和收藏集(part_id=0)都会返回 */
  function apiSearch(kw) {
    return jget(
      API + '/x/garb/v2/mall/home/search?key_word=' + encodeURIComponent(kw) + '&pn=1&ps=20'
    );
  }
  /* 装扮目录分页：part_id=6 是装扮，全站约 3400 套 */
  function apiCatalogPage(pn) {
    return jget(API + '/x/garb/v2/mall/partition/item/list?part_id=6&pn=' + pn + '&sort_type=2');
  }

  /* ===================== 纯逻辑（可测试） ===================== */

  /* 一个「容器 + skin 子项」-> user_equip 配置 */
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
      } catch (e) {}
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
        if (!/suit\/detail|mall/i.test(href)) continue;
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
     type=5 MaterialCombination（动态主题套装）：是若干子项 id，用 & 分隔，
     能不能直接解析出父装扮待验证，先一并试。 */
  function mapRedeemIds(raw) {
    var out = [];
    var list = (raw && raw.data && raw.data.collect_list) || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i].redeem_item_type;
      if (t !== 4 && t !== 5) continue;
      var parts = String(list[i].redeem_item_id || '').split('&');
      for (var j = 0; j < parts.length; j++) {
        var s = parts[j].replace(/\D/g, '');
        if (s.length >= 5) out.push(s);
      }
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
        if (!e || !e.id || !e.package_url || seen[e.id]) continue;
        seen[e.id] = 1;
        out.push(e);
      }
    }
    return out;
  }

  /* ===================== 全量目录（兜底用） ===================== */

  /* 目录条目 -> 卡片数据。只有 id / 名字 / 封面，点开再去拉装扮包。 */
  function mapSuit(it) {
    it = it || {};
    var p = it.properties || {};
    return {
      id: it.item_id,
      name: it.name,
      cover: p.image_cover || '',
      cat: it.group_name || '',
      paid: Number(p.sale_bp_forever_raw || 0) > 0
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
        '· ' + h.name + (h.upcoming && h.startAt ? '\n    ' + fmtTime(h.startAt) + ' 开售' : '')
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

    var sniffed = [];
    try {
      var r = await bridgeSeen(enterTs);
      sniffed = (r && r.data) || [];
    } catch (e) {}

    var merged = mergeById(sniffed, stateHits);

    var ids = collectIds(document, location);

    /* 收藏集页：奖励清单里的 id 也一并试（「动态主题套装」在这里） */
    var actId = param(location, 'act_id');
    if (actId) {
      try {
        var extra = mapRedeemIds(
          await apiCollectRewards(actId, param(location, 'lottery_id'))
        );
        for (var n = 0; n < extra.length; n++) {
          if (ids.indexOf(extra[n]) < 0) ids.push(extra[n]);
        }
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

    return merged;
  }

  /* ===================== 应用 ===================== */

  async function applyEquip(equip) {
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
    return (
      '<div data-id="' + it.id + '" style="background:#fff;border-radius:12px;overflow:hidden;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.07);cursor:pointer">' +
      '<div style="position:relative;width:100%;aspect-ratio:1/1;background:#f4f4f5;overflow:hidden">' +
      (it.preview
        ? '<img src="' + esc(thumb(it.preview)) + '" loading="lazy" ' +
          'style="display:block;width:100%;height:100%;object-fit:cover">'
        : '') +
      '</div>' +
      '<div style="padding:8px 10px 10px">' +
      '<div style="font-size:13px;line-height:1.35;color:#18191c;overflow:hidden;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:35px">' +
      esc(it.name) + '</div>' +
      '<div data-apply="' + it.id + '" style="margin-top:8px;height:30px;line-height:30px;' +
      'text-align:center;border-radius:15px;background:' + PINK + ';color:#fff;font-size:12px">' +
      '应用</div>' +
      '</div></div>'
    );
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
    launcher.textContent = '扫描中…';
    launcher.style.opacity = '.7';

    var list;
    try {
      list = await collectCandidates();
    } catch (e) {
      list = [];
    }

    launcher.textContent = '应用装扮';
    launcher.style.opacity = '1';

    if (list.length === 0) return showEmpty();
    if (list.length === 1) return doApply(list[0]);

    openSheet('选择要应用的装扮', '本页找到 ' + list.length + ' 套，点「应用」生效', [], gridHtml(list));
    bindGridActions(panel.querySelector('#bss-body'), list);
  }

  function bindGridActions(root, list) {
    if (!root) return;
    root.addEventListener('click', function (e) {
      var ap = e.target.closest && e.target.closest('[data-apply]');
      var card = ap || (e.target.closest && e.target.closest('[data-id]'));
      if (!card) return;
      var id = card.getAttribute('data-apply') || card.getAttribute('data-id');
      var hit = null;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) {
          hit = list[i];
          break;
        }
      }
      if (hit) {
        closePanel();
        doApply(hit);
      }
    });
  }

  async function doApply(equip) {
    if (launcher) launcher.textContent = '注入中…';
    try {
      await applyEquip(equip);
      if (launcher) launcher.textContent = '已应用';
      toast('已注入「' + equip.name + '」\n杀掉后台重进 B 站即可生效', true);
    } catch (e) {
      toast('失败：' + e.message);
    }
    setTimeout(function () {
      if (launcher) launcher.textContent = '应用装扮';
    }, 2600);
  }

  /* 本页没找到：给「浏览全部」兜底 + 藏馆里之前用过的 */
  async function showEmpty() {
    var cur = null;
    var gal = [];
    try {
      var g = await bridgeGet();
      cur = g && g.data;
    } catch (e) {}
    try {
      var r = await bridgeGallery();
      gal = (r && r.data) || [];
    } catch (e) {}

    var acts = [{ key: 'browse', label: '浏览全部装扮', pink: true }];
    if (cur && cur.name) acts.push({ key: 'clear', label: '清除注入' });

    var isCard = /digital-card/.test(location.pathname || '');
    var tip = isCard
      ? '收藏集页面本身不带装扮数据。\n点「浏览全部装扮」按名字找，\n或进收藏集的「主题套装」页再点按钮。'
      : '本页没找到可用的装扮。\n点「浏览全部装扮」按名字或 ID 找。';

    var body =
      emptyHtml(tip) +
      (gal.length
        ? '<div style="margin:2px 0 10px;font-size:13px;color:#61666d">藏馆 · 之前应用过的</div>' +
          gridHtml(gal)
        : '');

    openSheet('应用装扮', cur && cur.name ? '当前：' + cur.name : '', acts, body);
    bindGridActions(panel.querySelector('#bss-body'), gal);

    var browseBtn = panel.querySelector('[data-act="browse"]');
    if (browseBtn) {
      browseBtn.addEventListener('click', function () {
        openBrowse();
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
     搜索走服务端接口，浏览走分页 + 触底加载。 */
  async function openBrowse() {
    openSheet(
      '全部装扮',
      '搜名字，或往下翻看全部',
      [],
      '<input id="bss-q" placeholder="搜索装扮名，例如「灵魂潮汐」" ' +
        'style="width:100%;box-sizing:border-box;height:36px;padding:0 14px;border:none;' +
        'border-radius:18px;background:#f4f4f5;font-size:13px;outline:none">' +
        '<div id="bss-grid" style="margin-top:12px"></div>' +
        '<div id="bss-more" style="padding:18px 0;text-align:center;font-size:12px;' +
        'color:#9499a0"></div>'
    );

    var body = panel.querySelector('#bss-body');
    var qEl = body.querySelector('#bss-q');
    var gridEl = body.querySelector('#bss-grid');
    var moreEl = body.querySelector('#bss-more');

    var st = { pn: 0, done: false, loading: false, kw: '', timer: 0 };

    function loadMore() {
      if (st.loading || st.done || st.kw) return;
      st.loading = true;
      moreEl.textContent = '加载中…';
      var pn = st.pn + 1;
      apiCatalogPage(pn)
        .then(function (raw) {
          var list = mapCatalogPage(raw);
          if (!list.length) {
            st.done = true;
            moreEl.textContent = '没有更多了';
          } else {
            st.pn = pn;
            gridEl.insertAdjacentHTML('beforeend', gridHtml(list));
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
        gridEl.innerHTML = '';
        st.pn = 0;
        st.done = false;
        moreEl.textContent = '';
        return loadMore();
      }
      moreEl.textContent = '搜索中…';
      apiSearch(kw)
        .then(function (raw) {
          var list = mapSearch(raw);
          if (list.length) {
            gridEl.innerHTML = gridHtml(list);
          } else {
            var hits = mapCollectHits(raw);
            gridEl.innerHTML = hits.length
              ? collectHint(hits, kw)
              : emptyHtml('没搜到「' + kw + '」\n换个关键词试试');
          }
          moreEl.textContent = '';
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
      var ap = e.target.closest && e.target.closest('[data-apply]');
      var card = ap || (e.target.closest && e.target.closest('[data-id]'));
      if (!card) return;
      var id = card.getAttribute('data-apply') || card.getAttribute('data-id');
      closePanel();
      applyById(id);
    });

    loadMore();
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
      '应用装扮'
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
     - /blackboard/fe/suit-preview.html  收藏集的「主题套装」预览页（独立活动页） */
  function isTargetPage(p) {
    return /h5\/mall/.test(p) || /blackboard\/fe\/suit-preview\.html/.test(p);
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

  if (document.body) route();
  else document.addEventListener('DOMContentLoaded', route);

  /* 测试钩子 */
  window.__BSS_API__ = {
    idFrom: idFrom,
    param: param,
    thumb: thumb,
    isTargetPage: isTargetPage,
    mapRedeemIds: mapRedeemIds,
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
    cardHtml: cardHtml,
    enterTs: function () {
      return enterTs;
    },
    markEnter: markEnter
  };
})();
