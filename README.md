# Bili-skin · B站装扮工作室

一个 Surge 模块，让哔哩哔哩 App 用上**任意装扮**——包括付费的，也包括已下架的（后者有前提，见「已知限制」）。

一套装扮（套装）不只有主题皮肤，还可能有**加载动画 / 动态卡片 / 评论装扮 / 头像挂件 / 点赞特效 / 进度条 / 空间海报 / 表情包**。
本模块会整套抓下来，按组件类型分别注入到对应接口（除表情包外都能生效）。

面板还带：**详情页**（大图 + 组件清单 + 来源价格）、**分类筛选 / 排序 / ID 直输**、
**藏馆按账号分组**、**开屏（品牌 / 活动 / Chronos）**、**收藏集开售提醒**、
**配置导出导入**（换设备）、**设置 / 诊断**、中英文切换。

> 各类型的**获取来源 / 数据接口 / 注入位置**逐条说明见
> [`docs/装扮资源-来源接口注入.md`](docs/装扮资源-来源接口注入.md)。

## 安装

Surge → 首页 → 模块 → 安装新模块：

```
https://raw.githubusercontent.com/Suk1u/Bili-skin/main/BiliSkinStudio.sgmodule
```

安装后确认这些主机已在 MITM 主机名列表里（模块会自动追加）：

```
app.bilibili.com, api.bilibili.com, www.bilibili.com,
grpc.biliapi.net, *.hdslb.com, *.bilivideo.com, *.bilivideo.net
```

**全部功能都在这一个模块里。** 其中两条规则代价较大，出问题可以单独删掉那一行：

| 规则 | 代价 | 删掉的后果 |
|---|---|---|
| `BiliSkinGrpc`（第 9 条） | 让 Surge 解密 `grpc.biliapi.net` | 评论 / 动态里 gRPC 那条路径上的装扮不生效（HTTP 那条仍然生效） |
| `BiliSkinCache`（第 10 条） | 让 Surge 解密 B站 CDN | Chronos 开屏包不再本地缓存（回放仍可用，只要 CDN 还在） |

删 `BiliSkinCache` 时顺手把 MITM 里的 `*.hdslb.com, *.bilivideo.com, *.bilivideo.net` 也去掉。

## 使用

按钮只有一个：**「应用装扮」**。

1. 打开 B站 App，进装扮商城、装扮详情页、收藏集页面，或收藏集里的**「主题套装」预览页**
2. 页面**左上角**出现「应用装扮」，点一下
3. 模块会扫描**当前页面**上出现的装扮：
   - 只有一套 → 直接注入
   - 多套 → 弹出列表，点「应用」挑一套
   - 一套都没有 → 给「**浏览全部装扮**」兜底入口（**全站约 3400 套**，服务端搜索 + 触底翻页），
     外加「藏馆」里之前用过的
4. **杀掉后台，重新打开 B站** —— 装扮生效

**所以永远不会卡住**：本页找不到就点「浏览全部装扮」，全站装扮都在里面。

按钮可以拖动，位置会记住。挡住内容的话拖到一边即可。

**清除**：本页没找到装扮时，面板右上角会出现「清除注入」；点掉再重启 App 就回到原装扮。

## 它是怎么找到「当前页面的装扮」的

候选来自四个地方，按可靠性排序：

| 来源 | 说明 |
|---|---|
| 接口嗅探 | Surge 拦截 `api.bilibili.com/x/garb/*` 和 `x/vas/*` 的响应，凡是含装扮包的条目都记下来 |
| 页面状态 | 递归扫 `__INITIAL_MIRROR__` / `__INITIAL_STATE__` 等全局对象，找出里面的装扮 |
| DOM 链接 | 页面里指向装扮详情页的 `<a href>` |
| URL 参数 | `id` / `item_id` / `suit_id` |

只有当前页面加载过的才会进候选——用页面进入时刻做时间过滤，所以不会串页。

**支持哪些页面**：`www.bilibili.com/h5/mall/*`（商城、详情、收藏集），
以及 `www.bilibili.com/blackboard/fe/suit-preview.html`（收藏集的「主题套装」预览页——
它是独立活动页，不在 mall 路径下，接口走 `x/garb/v2/mall/suit/detail`）。

## 原理

B站装扮是**客户端渲染**的。App 进前台时会请求：

```
app.bilibili.com/x/resource/show/skin
```

响应里的 `data.user_equip` 决定它当前画哪套装扮：

```json
{
  "id": 67790,
  "name": "2024愚人节·小会员",
  "package_url": "https://i0.hdslb.com/bfs/garb/zip/xxx.zip",
  "package_md5": "8dd1d048a8d3377674f89ba4f8dc68e9",
  "data": { "color": "#ffffff", "color_mode": "dark", "tail_color": "#ffffff" }
}
```

App 拿到它就去下载那个 ZIP（里面是 `head_bg.jpg`、`tail_icon_*.png` 等 17 张图），再按配色画出来。

**把这段 JSON 换掉，App 就会画另一套装扮。**

模块做这几件事：

| 环节 | 实现 |
|---|---|
| 嗅探 | 拦截 `api.bilibili.com/x/garb/*` 与 `x/vas/*`，把这一路见过的装扮资源记进本地。三个来源：整套 `suit_items`、收藏集 `collect_infos[].redeem_item_*`、已拥有资产 `x/garb/user/asset/list` / `x/garb/user/pendant/list`。后两类另存一份 **7 天**的「持久候选」，所以在 App 原生页逛完收藏集，回到商城面板还能直接应用 |
| 注入 | 在 H5 页面注入「应用装扮」按钮，点击时汇总候选（本页 + 最近 30 分钟 + 7 天持久）并写进 Surge |
| 生效·主题 | 拦截 `x/resource/show/skin`，用存好的配置替换 `user_equip` |
| 生效·加载动画 | 同一条 `x/resource/show/skin` 响应，替换 `load_equip`；空间页 / 我的页里的 `loading_url` 也按字段名换 |
| 生效·评论装扮 / 挂件 | 拦截评论 / 动态响应（含 `x/polymer/web-dynamic` 信息流的 `modules.module_author`），替换**自己**的 `member.user_sailing_v2.card_bg`、`member.user_sailing.pendant`。**注意：普通装扮套装里没有头像挂件**，挂件只能来自收藏集兑换物或已拥有挂件列表 |
| 生效·开屏动画 | 拦截 `x/v2/splash/brand/list` 与 `x/v2/splash/event/list2`，把选中的开屏图插进 `list` / `show` 或元素图字段（活动开屏带 md5 校验，模块会先算好）；设置里还能直接填「自定义开屏图」 |
| 生效·Chronos 开屏 | 拦截 `x/chronos/package/obtain`，把响应换成捕获过的 `{url, md5, sign}`（包体有 RSA 签名，只能回放） |
| 生效·空间海报 / 点赞 / 进度条 | 拦截空间响应，**按字段名**把 `image1..9_portrait`、`image_ani`、`static_icon_image` 等换成装扮里的图 |
| 设置 / 诊断 / 导出导入 | 桥的 `prefs` `diag` `export` `import` `equips/*` `reminders/*` `found` 路由，全部走假响应不出网 |
| 生效·gRPC | 改 `grpc.biliapi.net` 上 `bilibili.vas.garb.service` 的 protobuf，只改自己那条 |
| 通信 | H5 与 Surge 通过 `app.bilibili.com/x/surge-skin/*` 对话——Surge 直接返回假响应，请求不出网 |

## 已知限制

**收藏集里的东西现在会自动记下来。** 收藏集详情接口 `x/vas/dlc_act/lottery_home_detail`
的 `collect_list.collect_infos[]` 带 `redeem_item_*` 一组字段。实测（`act_id=114713&lottery_id=114714`）：

| `redeem_item_type` | `redeem_item_type_name` | 处理 |
|---|---|---|
| 1001 | 评论背景 | 用 `redeem_item_image` 当 `card_bg` |
| 3 | **头像挂件** | 用 `redeem_item_image` 当 `pendant` |
| 1 | 典藏卡 | 不是装扮组件，丢弃 |
| 4 / 5 | 主题套装 | `redeem_item_id` 是装扮 id，拉 `suit/detail` 解析 |

**type 数字各活动不统一**，所以按 `redeem_item_type_name` 中文名映射，不猜数字。
抓到的候选会存 **7 天**，在 App 原生页逛完收藏集再回商城面板就能直接应用。

- 收藏集的**「主题套装」预览页**（`blackboard/fe/suit-preview.html`）→ 按钮直接能用 ✅
- 收藏集的**卡片主页**（`h5/mall/digital-card/home`）→ 页面数据里没有 `act_id` 时靠
  Surge 侧嗅探兜底（原生页逛过就有）✅

**头像挂件（头像框）为什么以前一直不生效。** 对在售装扮抽样 60 套，
`suit_items` 的键并集只有 `card / card_bg / emoji_package / loading / play_icon / skin / space_bg / thumbup`
—— **没有 `pendant`**。挂件是独立资产，所以模块现在从收藏集兑换物、
`x/garb/user/pendant/list`、`x/garb/user/asset/list` 三处抓，抓成「只有挂件一个组件」的候选再注入。

**目录接口用的是 `x/garb/v2/mall/partition/item/list?part_id=6`，全站 3374 套**；
`x/garb/mall/suit/all` 那个接口只有 464 套，是残缺的子集，别用。

**已下架的装扮大部分用不了。** B站服务端已经不再下发下架装扮的图片包——抽样测试 60 个非在售 ID，没有一个能取到 `package_url`。没有图片包就无法渲染。模块带「藏馆」兜底：每次成功应用过的装扮会自动存进本地，之后即使下架也能继续用。

**能注入的 / 不能注入的。** 主题、加载动画、评论装扮、头像挂件、品牌开屏、活动开屏都能改；
Chronos 开屏只能**回放**（包体有 RSA 签名，伪造不了）；
走 gRPC 的那条路径也一起改了。
但**点赞特效、播放器进度条、空间海报**的注入点还没找到（数据都抓到了，卡片带角标），
**表情包**要服务端确认「拥有」才能发，才是真不可行。
下一步能加什么见 [`docs/可加功能清单.md`](docs/可加功能清单.md)。

**只改客户端渲染的部分。** 别人看你的主页 / 评论时看到的仍是账号原装扮；改动只在你自己的设备上生效。

**仅本地生效。** 装扮不会同步到账号，换设备或重装后需要重新注入。

## 开发

```bash
npm run build:bili                 # 重建 bili_skin.js（保留模块里已有的 URL）
npm run build:bili -- --repo u/r   # 把 raw URL 烘焙进模块
npm run build:bili -- --check      # 校验模块与远端脚本是否对齐
```

源码结构：

| 文件 | 说明 |
|---|---|
| `src/bili_h5.js` | 注入到 B站 H5 页面的脚本（按钮、候选收集、选择面板） |
| `src/bili_skin.src.js` | Surge 侧脚本模板，含 `__H5_PAYLOAD__` 占位符 |
| `bili_skin.js` | **构建产物**，Surge 实际下载的文件，由上面两个生成 |
| `BiliSkinStudio.sgmodule` | **模块本体**（10 条 `[Script]`，全部功能都在这里） |
| `docs/装扮资源-来源接口注入.md` | 各装扮类型的来源 / 接口 / 注入位置逐条说明 |
| `docs/可加功能清单.md` | 功能清单与状态（含已判定不可行的项） |
| `scripts/build-bili.js` | 构建脚本 |
| `scripts/test-bili-skin.js` | Surge 侧 94 个 mock 场景 |
| `scripts/test-bili-h5.js` | H5 纯逻辑 64 个场景 |

`bili_skin.js` 是产物但**必须入库**——Surge 要从这个 URL 下载它。改完 `src/` 后记得重新构建并推送。

## 免责声明

仅供个人学习研究。修改客户端展示属于对服务条款的灰色操作，由此产生的风险由使用者自行承担。装扮素材版权归哔哩哔哩及原作者所有。
