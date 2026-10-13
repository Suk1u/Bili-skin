# Bili-skin · B站装扮工作室

一个 Surge 模块，让哔哩哔哩 App 用上**任意装扮**——包括付费的，也包括已下架的（后者有前提，见「已知限制」）。

## 安装

Surge → 首页 → 模块 → 安装新模块：

```
https://raw.githubusercontent.com/Suk1u/Bili-skin/main/BiliSkinStudio.sgmodule
```

安装后确认 `app.bilibili.com` 和 `www.bilibili.com` 已在 MITM 主机名列表里（模块会自动追加）。

## 使用

按钮只有一个：**「应用装扮」**。

1. 打开 B站 App，进装扮商城、装扮详情页或收藏集页面
2. 页面**左上角**出现「应用装扮」，点一下
3. 模块会扫描**当前页面**上出现的装扮：
   - 只有一套 → 直接注入
   - 多套 → 弹出列表，点「应用」挑一套
   - 一套都没有 → 提示，并列出「藏馆」里之前用过的
4. **杀掉后台，重新打开 B站** —— 装扮生效

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

模块做四件事：

| 环节 | 实现 |
|---|---|
| 嗅探 | 拦截 `api.bilibili.com/x/garb/*` 与 `x/vas/*`，把当前页加载过的装扮记进本地 |
| 注入 | 在 H5 页面注入「应用装扮」按钮，点击时汇总候选并写进 Surge |
| 生效 | 拦截 `x/resource/show/skin`，用存好的配置替换 `user_equip` |
| 通信 | H5 与 Surge 通过 `app.bilibili.com/x/surge-skin/*` 对话——Surge 直接返回假响应，请求不出网 |

## 已知限制

**收藏集（抽奖）的装扮不一定拿得到。** 收藏集和装扮是两套独立体系——收藏集 id 问装扮接口只会返回空，两者 id 也不互通。模块的做法是：当你在收藏集页面时，把该页加载过的接口响应和页面里指向装扮的链接都捞一遍。如果收藏集页压根没加载装扮数据（比如要再点一次「获得主题套装」才跳转），那就得跳到装扮详情页再点按钮。

**已下架的装扮大部分用不了。** B站服务端已经不再下发下架装扮的图片包——抽样测试 60 个非在售 ID，没有一个能取到 `package_url`。没有图片包就无法渲染。模块带「藏馆」兜底：每次成功应用过的装扮会自动存进本地，之后即使下架也能继续用。

**只改客户端渲染的部分。** App 内的底栏、顶栏、主题色会变；但个人空间、动态卡片这些由服务端下发的部分不会变，别人看你的主页也看不到。

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
| `scripts/build-bili.js` | 构建脚本 |
| `scripts/test-bili-skin.js` | Surge 侧 41 个 mock 场景 |
| `scripts/test-bili-h5.js` | H5 纯逻辑 31 个场景 |

`bili_skin.js` 是产物但**必须入库**——Surge 要从这个 URL 下载它。改完 `src/` 后记得重新构建并推送。

## 免责声明

仅供个人学习研究。修改客户端展示属于对服务条款的灰色操作，由此产生的风险由使用者自行承担。装扮素材版权归哔哩哔哩及原作者所有。
