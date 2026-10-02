#!/usr/bin/env node
// 素材瘦身：原圖備份到 art/originals/（不進 git），public/assets/ 換成壓縮版
// 無透明 → JPEG；有透明 → 縮小後保留 PNG（有 pngquant 就再壓）
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'scripts/asset_manifest.json'), 'utf-8'));
let n = 0;
for (const it of manifest.items) {
  const src = path.join(ROOT, 'public/assets', it.cat, `${it.id}.png`);
  const orig = path.join(ROOT, 'art/originals', it.cat, `${it.id}.png`);
  if (existsSync(src) && !existsSync(orig)) {
    mkdirSync(path.dirname(orig), { recursive: true });
    copyFileSync(src, orig);
  }
  if (!existsSync(orig)) continue;
  if (!it.alpha) {
    const out = path.join(ROOT, 'public/assets', it.cat, `${it.id}.jpg`);
    if (existsSync(out)) continue;
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78', orig, '--out', out], { stdio: 'ignore' });
    if (existsSync(src)) rmSync(src);
  } else {
    execFileSync('sips', ['-Z', '512', src], { stdio: 'ignore' });
    try {
      execFileSync('pngquant', ['--force', '--skip-if-larger', '--quality', '60-85', '--output', src, src], { stdio: 'ignore' });
    } catch {
      /* 沒有 pngquant 就保留縮小後的 PNG */
    }
  }
  n++;
}
console.log(`處理 ${n} 張`);
