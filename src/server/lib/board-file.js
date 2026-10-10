/**
 * pageDir 的 board.json 读取（2026-09-22 切片 4 收拢）：读不到 / 坏 JSON 返回
 * null。此前 page-compiler、frame-doc、sites-api、offline-page-builder 各写
 * 各的 try/catch + JSON.parse。要区分「文件没有」还是「文件坏了」的调用方自己
 * existsSync 先判（后者只在导出构建里出现）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { flattenTabs } from '../../workbench/lib/board-tabs.js';

/** 磁盘原样（不摊平 tabs）：只有要把 board 整个交给 validateBoard 的调用方需要它。 */
export function readBoardRaw(pageDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pageDir, 'board.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 读侧归一（ADR 0041）：页 tab 摊平成「sections（每个带 tabId）+ tabs 元数据」，服务端各
 * 消费者（编译、frame-doc、导出、ann-query、ppnt CLI）照旧只认 sections；没写 tabs 的存量
 * board 原样返回。
 */
export function readBoard(pageDir) {
  return flattenTabs(readBoardRaw(pageDir));
}
