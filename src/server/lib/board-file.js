/**
 * pageDir 的 board.json 读取（2026-09-22 切片 4 收拢）：读不到 / 坏 JSON 返回
 * null。此前 page-compiler、frame-doc、sites-api、offline-page-builder 各写
 * 各的 try/catch + JSON.parse。要区分「文件没有」还是「文件坏了」的调用方自己
 * existsSync 先判（后者只在导出构建里出现）。
 */
import fs from 'node:fs';
import path from 'node:path';

export function readBoard(pageDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pageDir, 'board.json'), 'utf8'));
  } catch {
    return null;
  }
}
