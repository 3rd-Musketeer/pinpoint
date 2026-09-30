#!/usr/bin/env node
// 汇总 ~/.pinpoint/diagnostics/canvas.ndjson* 里的拖动 / 滚动帧率：
//   node scripts/canvas-diag-summary.mjs [分钟数，默认 60]
// 每个输入方式给 maxFrameGap 分位；慢样本（>50ms）再拆成“标注层自己慢 / 有长帧 / 无脚本归因”三类，
// 并列出长帧里出现最多的脚本。数据由 src/workbench/canvas-diagnostics.js 每 250ms 采一条 viewport。
import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from '../src/server/lib/annotate-data-dir.js';

const minutes = Number(process.argv[2]) || 60;
const since = Date.now() - minutes * 60_000;
const dir = path.join(dataRoot(), 'diagnostics');
const rows = [];
for (const name of ['canvas.ndjson.1', 'canvas.ndjson']) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let batch; try { batch = JSON.parse(line); } catch { continue; }
    for (const e of batch.events) if (e.type === 'viewport' && e.at >= since && typeof e.maxFrameGap === 'number') rows.push(e);
  }
}
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const byInput = new Map();
for (const e of rows) { const k = e.input || 'unknown'; (byInput.get(k) || byInput.set(k, []).get(k)).push(e); }
console.log(`最近 ${minutes} 分钟，${rows.length} 个样本（每样本约 250ms）`);
for (const [input, list] of byInput) {
  const gaps = list.map(e => e.maxFrameGap).sort((a, b) => a - b);
  const slow = list.filter(e => e.maxFrameGap > 50);
  console.log(`\n${input}: n=${list.length} p50=${q(gaps, .5)} p90=${q(gaps, .9)} p99=${q(gaps, .99)} max=${gaps.at(-1)}ms  慢样本(>50ms)=${slow.length}`);
  if (!slow.length) continue;
  const withAttr = slow.filter(e => 'loaf' in e);
  if (!withAttr.length) { console.log('  （这些样本没有归因字段：数据来自旧版本）'); continue; }
  const annSlow = withAttr.filter(e => e.annMax > 8).length;
  const loaf = withAttr.filter(e => e.loaf > 0).length;
  const none = withAttr.filter(e => !e.loaf && !e.longTasks).length;
  console.log(`  标注层单帧 >8ms: ${annSlow}  有长帧记录: ${loaf}  无长帧(主线程空闲，多半是合成 / GPU / 整机负载): ${none}`);
  const scripts = new Map();
  for (const e of withAttr) if (e.loafScript) scripts.set(e.loafScript, (scripts.get(e.loafScript) || 0) + 1);
  console.log('  长帧脚本 top:', [...scripts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join('  ') || '-');
  console.log(`  标注层 marks 中位数=${q(withAttr.map(e => e.marks).sort((a, b) => a - b), .5)}  zoom 中位数=${q(withAttr.map(e => e.zoom).sort((a, b) => a - b), .5)}`);
}
