/** 文章桶迁移：预先计算文档账本与附件的新身份，冲突在搬文章之前报错。 */
import fs from 'node:fs';
import path from 'node:path';

import { articleCanvas } from '../../src/server/lib/article-board.js';
import { readBucketLedgers } from '../../src/server/lib/orphans.js';
import { pageKeyFromPathname } from '../../src/shared/annotate-page-key.js';
import { annotationSlug } from '../../src/shared/annotation-slug.js';
import { CliError } from './core.js';

export function htmlPathnames(project, article, registry) {
  return articleCanvas(project, article, { registry }).sections
    .flatMap((section) => section.frames.map((frame) => frame.url).filter(Boolean));
}

export function planMovedBucket(bucket, move) {
  const fromPath = `/${move.fromProject}/${move.fromArticle || move.articleId}/`;
  const toPath = `/${move.toProject}/${move.toArticle || move.articleId}/`;
  const siteFrom = `/sites/${move.fromId}/`;
  const siteTo = `/sites/${move.toId}/`;
  const files = [];
  const images = [];
  const imagesDir = path.join(bucket, 'images');
  const imageNames = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir) : [];
  for (const { name, doc } of readBucketLedgers(bucket)) {
    if (!doc || typeof doc !== 'object') continue;
    let next = { ...doc };
    let target = name;
    if (typeof doc.path === 'string' && doc.path.startsWith(siteFrom)) {
      // doc.path 已解码；hash 必须用 iframe 实际加载的编码 URL。
      const candidates = (move.htmlPathnames || []).filter((url) => decodeURIComponent(url) === doc.path);
      // 失效帧可能已不在文章里；只接受能重现原账本名的标准编码形式。
      candidates.push(doc.path.split('/').map((part) => part.startsWith('@') ? part : encodeURIComponent(part)).join('/'));
      const pathname = candidates.find((url) => `${annotationSlug(pageKeyFromPathname(url))}.json` === name);
      if (!pathname) throw new CliError(`无法确认账本 ${path.join(bucket, name)} 的原始 URL 编码，未搬迁`);
      const newPathname = siteTo + pathname.slice(siteFrom.length);
      const key = annotationSlug(pageKeyFromPathname(newPathname));
      next.path = siteTo + doc.path.slice(siteFrom.length);
      next.page = key;
      target = `${key}.json`;
      const prefix = `${name.slice(0, -5)}-`;
      const renamedImages = new Map();
      for (const image of imageNames.filter((file) => file.startsWith(prefix))) {
        const to = `${key}-${image.slice(prefix.length)}`;
        images.push({ from: path.join('images', image), to: path.join('images', to) });
        renamedImages.set(image, to);
      }
      // images[].file 也可能出现在历史消息里，保留其余字段与线程字节的含义。
      next = JSON.parse(JSON.stringify(next, (key, value) => key === 'file' && renamedImages.has(value) ? renamedImages.get(value) : value));
    } else if (typeof doc.path === 'string' && (doc.path === fromPath.slice(0, -1) || doc.path.startsWith(fromPath))) {
      next.path = toPath + doc.path.slice(fromPath.length);
    }
    if (Array.isArray(doc.annotations)) {
      next.annotations = next.annotations.map((row) => row && row.pageId === move.fromId ? { ...row, pageId: move.toId } : row);
    }
    if (JSON.stringify(next) !== JSON.stringify(doc) || target !== name) {
      files.push({ from: name, to: target, content: JSON.stringify(next, null, 2) + '\n' });
    }
  }
  const destinations = new Set();
  for (const item of [...files, ...images]) {
    if (destinations.has(item.to) || (item.from !== item.to && fs.existsSync(path.join(bucket, item.to)))) {
      throw new CliError(`迁移目标已存在：${path.join(bucket, item.to)}；未搬迁，不覆盖账本或附件`);
    }
    destinations.add(item.to);
  }
  return { files, images };
}

export function rewriteMovedBucket(bucket, move, { writeFile = fs.writeFileSync, rename = fs.renameSync, remove = (file) => fs.rmSync(file, { force: true }) } = {}) {
  const plan = planMovedBucket(bucket, move);
  for (const item of plan.files) {
    const target = path.join(bucket, item.to);
    const tmp = `${target}.rename-${process.pid}.tmp`;
    try {
      writeFile(tmp, item.content);
      rename(tmp, target);
    } finally {
      remove(tmp);
    }
    if (item.from !== item.to) remove(path.join(bucket, item.from));
  }
  for (const item of plan.images) rename(path.join(bucket, item.from), path.join(bucket, item.to));
  return plan.files.map((item) => item.to);
}
