/** 搬迁前拒绝链接文章入口：备份链接本身不能恢复跟随链接改写的真实正文。 */
import fs from 'node:fs';
import path from 'node:path';

import { CliError } from './core.js';

export function assertArticleSource(articleDir) {
  for (const [target, replacement] of [[articleDir, '真实目录'], [path.join(articleDir, 'index.mdx'), '普通文件']]) {
    let stat;
    try { stat = fs.lstatSync(target); } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new CliError(`${target} 是 symlink，资源改写会跟随链接，无法保证回滚真实正文；先把链接换成${replacement}，再搬迁或改名`);
    }
  }
}

/** 直接列磁盘入口，避免正常文章枚举跳过 symlink 后漏检。 */
export function assertProjectArticleSources(articlesDir) {
  let entries;
  try { entries = fs.readdirSync(articlesDir, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink())) {
      assertArticleSource(path.join(articlesDir, entry.name));
    }
  }
}
