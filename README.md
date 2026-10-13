# Bili-skin · B站装扮工作室

一个 Surge 模块，让哔哩哔哩 App 用上**任意装扮**——包括付费的，也包括已下架的（后者有前提，见「已知限制」）。

## 安装

Surge → 首页 → 模块 → 安装新模块：

```
https://raw.githubusercontent.com/Suk1u/Bili-skin/main/BiliSkinStudio.sgmodule
```

安装后确认 `app.bilibili.com` 和 `www.bilibili.com` 已在 MITM 主机名列表里（模块会自动追加）。

## 使用

1. 打开 B站 App，进「我的 → 装扮」
2. 页面**右下角**出现「全部装扮」按钮，点开可浏览全部装扮，支持按分类筛选和关键词搜索
3. 点任意一套进详情页，**左上角**出现「应用此装扮」，点一下即注入
   - 也可以直接在列表卡片上点「应用」，省掉进详情页这一步
4. **杀掉后台，重新打开 B站** —— 装扮生效

两个按钮都可以拖动，位置会记住。挡住内容的话拖到一边即可。

**清除**：打开「全部装扮」面板，点右上角「清除注入」，再重启 App 就回到原装扮。

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

模块做三件事：

| 环节 | 实现 |
|---|---|
| 浏览 | 在装扮商城 H5 页面注入脚本，调 `x/garb/mall/suit/all` 拉全量装扮目录 |
| 注入 | 在详情页注入按钮，调 `x/garb/mall/item/suit/v2` 解析出配置，存进 Surge |
| 生效 | 拦截 `x/resource/show/skin`，用存好的配置替换 `user_equip` |

H5 页面和 Surge 之间通过 `app.bilibili.com/x/surge-skin/*` 通信——Surge 直接返回假响应，请求不出网。

## 已知限制

**已下架的装扮大部分用不了。** B站服务端已经不再下发下架装扮的图片包——抽样测试 60 个非在售 ID，没有一个能取到 `package_url`。没有图片包就无法渲染。

模块带一个「藏馆」机制兜底：每次成功应用过的装扮会自动存进本地，之后即使下架也能继续用。但救不了从未取到过的。

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
| `src/bili_h5.js` | 注入到 B站 H5 页面的脚本（UI + 数据组装） |
| `src/bili_skin.src.js` | Surge 侧脚本模板，含 `__H5_PAYLOAD__` 占位符 |
| `bili_skin.js` | **构建产物**，Surge 实际下载的文件，由上面两个生成 |
| `scripts/build-bili.js` | 构建脚本 |
| `scripts/test-bili-skin.js` | Surge 侧 28 个 mock 场景 |
| `scripts/test-bili-h5.js` | H5 纯逻辑 21 个场景 |

`bili_skin.js` 是产物但**必须入库**——Surge 要从这个 URL 下载它。改完 `src/` 后记得重新构建并推送。

## 免责声明

仅供个人学习研究。修改客户端展示属于对服务条款的灰色操作，由此产生的风险由使用者自行承担。装扮素材版权归哔哩哔哩及原作者所有。
