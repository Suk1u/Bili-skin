#!/usr/bin/env node
/**
 * 构建 B站装扮工作室的两件产物：
 *
 *   1. dist/bili_skin.js             —— Surge 实际下载并执行的脚本
 *       把 src/bili_h5.js 内联进 src/bili_skin.src.js 的 __H5_PAYLOAD__ 占位符。
 *       为什么必须内联：Surge 脚本读不了本地文件，注入用的页面脚本只能以字符串常量存在。
 *
 *   2. dist/BiliSkinStudio.sgmodule  —— 可直接安装的模块
 *       把仓库里的 REPLACE_ME 占位符换成你自己的 raw URL。
 *
 * 用法：
 *   npm run build:bili                              # 只产脚本，模块保留占位符
 *   npm run build:bili -- --repo user/repo          # 烘焙 raw URL
 *   npm run build:bili -- --url https://.../bili_skin.js
 *   npm run build:bili -- --check                   # 校验模块与脚本是否对齐
 *
 * 环境变量：BILI_REPO / BILI_RAW_URL
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC_H5 = path.join(ROOT, 'src', 'bili_h5.js');
const SRC_TPL = path.join(ROOT, 'src', 'bili_skin.src.js');
const SRC_MODULE = path.join(ROOT, 'BiliSkinStudio.sgmodule');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_JS = path.join(DIST_DIR, 'bili_skin.js');
const DIST_MODULE = path.join(DIST_DIR, 'BiliSkinStudio.sgmodule');

const PLACEHOLDER = 'REPLACE_ME/surge-bili-skin';
const SCRIPT_NAME = 'bili_skin.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function rawUrlFor(repo) {
  return 'https://raw.githubusercontent.com/' + repo + '/dist/' + SCRIPT_NAME;
}

/* ---------- 1. 生成脚本 ---------- */

function buildScript() {
  const tpl = fs.readFileSync(SRC_TPL, 'utf8');
  const h5 = fs.readFileSync(SRC_H5, 'utf8');

  if (tpl.indexOf('__H5_PAYLOAD__') < 0) {
    throw new Error('模板缺少 __H5_PAYLOAD__ 占位符: ' + SRC_TPL);
  }
  if (h5.indexOf('(function () {') < 0) {
    throw new Error('页面脚本格式异常（找不到 IIFE 开头）: ' + SRC_H5);
  }

  // 页面脚本会被塞进 <script>...</script>，必须先打断 </script 序列，
  // 否则 HTML 解析器会提前闭合标签。
  const safe = h5.replace(/<\/script/gi, '<\\/script');

  // JSON.stringify 会把反斜杠再转义一层，最终写进 HTML 的仍是 <\/script
  const out = tpl.replace('__H5_PAYLOAD__', JSON.stringify(safe));

  if (out.indexOf('__H5_PAYLOAD__') >= 0) {
    throw new Error('占位符未被替换');
  }
  new vm.Script(out, { filename: DIST_JS });

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST_JS, out, 'utf8');
  return { size: out.length, payload: safe.length };
}

/* ---------- 2. 生成模块 ---------- */

function buildModule(rawUrl) {
  let module = fs.readFileSync(SRC_MODULE, 'utf8');

  if (rawUrl) {
    const before = module;
    module = module.replace(/script-path=https?:\/\/\S+?\.js/g, 'script-path=' + rawUrl);
    if (module === before) {
      throw new Error('模块里找不到可替换的 script-path: ' + SRC_MODULE);
    }
    if (module.indexOf(PLACEHOLDER) >= 0) {
      throw new Error('模块里仍残留 REPLACE_ME 占位符');
    }
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST_MODULE, module, 'utf8');
  return module;
}

/* ---------- 3. 校验模式 ---------- */

function check() {
  // 校验的是「可安装的那份」——优先看 dist，没有才回落到源模块
  const target = fs.existsSync(DIST_MODULE) ? DIST_MODULE : SRC_MODULE;
  const module = fs.readFileSync(target, 'utf8');
  const urls = [];
  const re = /script-path=(https?:\/\/\S+?\.js)/g;
  let m;
  while ((m = re.exec(module)) !== null) urls.push(m[1]);

  const unique = Array.from(new Set(urls));
  console.log('检查文件                 : ' + path.relative(ROOT, target));
  console.log('模块里的 script-path 行数 : ' + urls.length);
  console.log('去重后的 URL 数量        : ' + unique.length);
  unique.forEach(function (u) {
    console.log('  ' + u);
  });

  if (module.indexOf(PLACEHOLDER) >= 0) {
    console.log('\n模块仍是 REPLACE_ME 占位符，无法直接安装。');
    console.log('先跑：npm run build:bili -- --repo <用户名>/<仓库名>');
    process.exit(2);
  }
  if (urls.length !== 3) {
    console.log('\n预期 3 条 [Script] 行，实际 ' + urls.length + ' 条，检查一下。');
    process.exit(2);
  }
  if (unique.length !== 1) {
    console.log('\n三条 [Script] 行的 script-path 不一致，检查一下。');
    process.exit(2);
  }
  if (!fs.existsSync(DIST_JS)) {
    console.log('\ndist/bili_skin.js 不存在，先跑 npm run build:bili。');
    process.exit(2);
  }

  const local = fs.readFileSync(DIST_JS, 'utf8');
  const hash = require('crypto').createHash('sha256').update(local).digest('hex').slice(0, 12);
  console.log('\n本地 dist/bili_skin.js sha256 : ' + hash);
  console.log('脚本字节数                    : ' + local.length);
  console.log('\n三条 [Script] 行都指向同一个 URL，可以安装。');
  console.log('提醒：改完 src 必须重新构建并推送到该 URL，Surge 才会拿到新版');
  console.log('（模块已带 script-update-interval=86400，最长一天内自动更新）。');
}

/* ---------- 主流程 ---------- */

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) return check();

  const explicit = args.url || process.env.BILI_RAW_URL;
  const repo = args.repo || process.env.BILI_REPO;
  const rawUrl = explicit || (repo ? rawUrlFor(repo) : null);

  const s = buildScript();
  buildModule(rawUrl);

  console.log('OK  dist/bili_skin.js             %d bytes (payload %d bytes)',
    s.size, s.payload);
  console.log('OK  dist/BiliSkinStudio.sgmodule');

  if (rawUrl) {
    console.log('\nscript-path -> ' + rawUrl);
    console.log('\n接下来：');
    console.log('  1. 把 dist/ 下的这两个文件提交到 GitHub');
    console.log('  2. Surge 里安装：');
    console.log('     https://raw.githubusercontent.com/' + (repo || '<user>/<repo>') +
      '/dist/BiliSkinStudio.sgmodule');
  } else {
    console.log('\n未指定 --repo / --url，模块仍是 REPLACE_ME 占位符。');
    console.log('正式分发前请跑：npm run build:bili -- --repo <用户名>/<仓库名>');
  }
}

try {
  main();
} catch (e) {
  console.error('构建失败：' + e.message);
  process.exit(1);
}
