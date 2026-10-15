#!/usr/bin/env node
/**
 * 构建 B站装扮工作室的分发文件。
 *
 * 产物（都放在仓库根目录，Surge 直接从这里下载）：
 *   bili_skin.js               —— Surge 实际下载并执行的脚本
 *   BiliSkinStudio.sgmodule    —— 安装入口，script-path 指向上面那个文件的 raw URL
 *
 * bili_skin.js 由 src/bili_h5.js 内联进 src/bili_skin.src.js 生成。
 * 为什么必须内联：Surge 脚本读不了本地文件，注入用的页面脚本只能以字符串常量存在。
 *
 * 用法：
 *   npm run build:bili -- --repo Suk1u/Bili-skin     # 烘焙 raw URL（分发前必跑）
 *   npm run build:bili -- --url https://.../bili_skin.js
 *   npm run build:bili -- --branch dev               # 换分支，默认 main
 *   npm run build:bili -- --check                    # 校验模块与脚本是否对齐
 *   npm run build:bili                               # 只重建脚本，保留模块里已有的 URL
 *
 * 环境变量：BILI_REPO / BILI_RAW_URL / BILI_BRANCH
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC_H5 = path.join(ROOT, 'src', 'bili_h5.js');
const SRC_TPL = path.join(ROOT, 'src', 'bili_skin.src.js');
const OUT_JS = path.join(ROOT, 'bili_skin.js');
const OUT_MODULE = path.join(ROOT, 'BiliSkinStudio.sgmodule');

const PLACEHOLDER = 'REPLACE_ME';
const SCRIPT_NAME = 'bili_skin.js';
const SCRIPT_PATH_RE = /script-path=https?:\/\/\S+?\.js/g;
const SCRIPT_PATH_CAP = /script-path=(https?:\/\/\S+?\.js)/g;

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

function rawUrlFor(repo, branch) {
  return (
    'https://raw.githubusercontent.com/' + repo + '/' + (branch || 'main') + '/' + SCRIPT_NAME
  );
}

function collectScriptPaths(module) {
  const urls = [];
  let m;
  SCRIPT_PATH_CAP.lastIndex = 0;
  while ((m = SCRIPT_PATH_CAP.exec(module)) !== null) urls.push(m[1]);
  return urls;
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

  if (out.indexOf('__H5_PAYLOAD__') >= 0) throw new Error('占位符未被替换');
  new vm.Script(out, { filename: OUT_JS });

  fs.writeFileSync(OUT_JS, out, 'utf8');
  return { size: Buffer.byteLength(out, 'utf8'), payload: Buffer.byteLength(safe, 'utf8') };
}

/* ---------- 2. 生成模块 ---------- */

function buildModule(rawUrl) {
  let module = fs.readFileSync(OUT_MODULE, 'utf8');
  const existing = collectScriptPaths(module);
  const isPlaceholder = module.indexOf(PLACEHOLDER) >= 0;

  if (rawUrl) {
    module = module.replace(SCRIPT_PATH_RE, 'script-path=' + rawUrl);
    if (module.indexOf(PLACEHOLDER) >= 0) throw new Error('模块里仍残留 REPLACE_ME 占位符');
    fs.writeFileSync(OUT_MODULE, module, 'utf8');
    return { changed: true, url: rawUrl };
  }

  // 没给 --repo：不要用占位符覆盖已经烘焙好的地址
  if (isPlaceholder) return { changed: false, url: null };
  return { changed: false, url: existing[0] || null };
}

/* ---------- 3. 校验模式 ---------- */

function check() {
  const module = fs.readFileSync(OUT_MODULE, 'utf8');
  const urls = collectScriptPaths(module);
  const unique = Array.from(new Set(urls));

  console.log('模块文件                 : ' + path.relative(ROOT, OUT_MODULE));
  console.log('script-path 行数         : ' + urls.length);
  unique.forEach(function (u) {
    console.log('  -> ' + u);
  });

  let bad = false;
  if (module.indexOf(PLACEHOLDER) >= 0) {
    console.log('\n[FAIL] 模块还是 REPLACE_ME 占位符，装上去必然 404。');
    console.log('       跑：npm run build:bili -- --repo <用户名>/<仓库名>');
    bad = true;
  }
  if (urls.length !== 8) {
    console.log('\n[FAIL] 预期 8 条 [Script] 行，实际 ' + urls.length + ' 条。');
    bad = true;
  }
  if (unique.length !== 1) {
    console.log('\n[FAIL] 四条 [Script] 行的 script-path 不一致。');
    bad = true;
  }
  if (!fs.existsSync(OUT_JS)) {
    console.log('\n[FAIL] ' + SCRIPT_NAME + ' 不存在，先跑 npm run build:bili。');
    bad = true;
  }
  if (bad) process.exit(2);

  const local = fs.readFileSync(OUT_JS, 'utf8');
  const hash = require('crypto').createHash('sha256').update(local).digest('hex').slice(0, 12);
  console.log('\n本地 ' + SCRIPT_NAME + ' 字节数 : ' + Buffer.byteLength(local, 'utf8'));
  console.log('本地 sha256 前 12 位    : ' + hash);

  // 顺手确认远端拿到的和本地一致（联网失败不阻塞）
  const url = unique[0];
  console.log('\n正在比对远端 ' + url + ' ...');
  const https = require('https');
  https
    .get(url, function (res) {
      if (res.statusCode !== 200) {
        console.log('[FAIL] 远端返回 HTTP ' + res.statusCode + '，说明脚本还没推上去。');
        res.resume();
        process.exit(2);
      }
      const chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        const remote = Buffer.concat(chunks).toString('utf8');
        const rh = require('crypto').createHash('sha256').update(remote).digest('hex').slice(0, 12);
        if (remote === local) {
          console.log('[OK]   远端与本地逐字节一致，可以安装。');
        } else {
          console.log('[WARN] 远端 ' + remote.length + ' 字节 / ' + rh + '，与本地不一致。');
          console.log('       本地改完要重新推到那个 URL，Surge 才会拿到新版。');
        }
      });
    })
    .on('error', function (e) {
      console.log('[SKIP] 联网比对失败（' + e.message + '），跳过。');
    });
}

/* ---------- 主流程 ---------- */

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.check) return check();

  const explicit = args.url || process.env.BILI_RAW_URL;
  const repo = args.repo || process.env.BILI_REPO;
  const branch = args.branch || process.env.BILI_BRANCH || 'main';
  const rawUrl = explicit || (repo ? rawUrlFor(repo, branch) : null);

  const s = buildScript();
  const m = buildModule(rawUrl);

  console.log('OK  ' + SCRIPT_NAME + '  ' + s.size + ' bytes (payload ' + s.payload + ' bytes)');
  if (m.changed) {
    console.log('OK  BiliSkinStudio.sgmodule  script-path -> ' + m.url);
  } else if (m.url) {
    console.log('OK  BiliSkinStudio.sgmodule  保留已有 script-path -> ' + m.url);
  } else {
    console.log('WARN BiliSkinStudio.sgmodule 仍是 REPLACE_ME 占位符');
    console.log('     分发前请跑：npm run build:bili -- --repo <用户名>/<仓库名>');
    return;
  }

  console.log('\n接下来把这两个文件提交到 GitHub：');
  console.log('  ' + SCRIPT_NAME);
  console.log('  BiliSkinStudio.sgmodule');
  console.log('\nSurge 安装地址：');
  console.log('  https://raw.githubusercontent.com/' +
    (repo || '<用户名>/<仓库名>') + '/' + branch + '/BiliSkinStudio.sgmodule');
}

try {
  main();
} catch (e) {
  console.error('构建失败：' + e.message);
  process.exit(1);
}
