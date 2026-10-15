/**
 * 画布浮层（文章上开整张画布）：纯函数，不碰 DOM。浏览器端是 canvas-overlay-client.js，
 * node --test 守地址契约。契约在 site/README.md「画布浮层」。
 */
import { canvasHref } from './canvas-card.js';

/** 浮层地址：节、可选的帧与钉子。旧链接的 view 参数按未知参数忽略。 */
export function canvasHash(sectionId, { frame = '', ann = '' } = {}) {
  const q = new URLSearchParams({ canvas: sectionId });
  if (frame) q.set('frame', frame);
  if (ann !== '' && ann != null) q.set('ann', String(ann));
  return `#${q.toString()}`;
}

/** `#canvas=<节>[&frame=<帧>][&ann=<n>]` → { section, frame, ann }。
 * ann 是正整数或 null；旧地址 #overlay= 同样读取，其他 hash 返回 null。
 */
export function parseCanvasHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const key = raw.startsWith('canvas=') ? 'canvas' : raw.startsWith('overlay=') ? 'overlay' : '';
  if (!key) return null;
  const q = new URLSearchParams(raw);
  const section = q.get(key) || '';
  if (!section) return null;
  const frame = q.get('frame') || '';
  const n = Number(q.get('ann'));
  return {
    section,
    frame,
    ann: Number.isInteger(n) && n > 0 ? n : null,
  };
}

/**
 * 浮层里的工作台：画布视图的地址加 `embed=overlay`（src/workbench/lib/page-url.js isEmbedded）。
 * 嵌入版不出左栏和“← 文章标题”，Esc 交回文章页（src/workbench/embed.js）。
 */
export function embedCanvasSrc(pageId, sectionId) {
  return `${canvasHref(pageId, sectionId)}&embed=overlay`;
}

/** 工作台嵌入版发来的消息（src/workbench/embed.js EMBED_MESSAGE_SOURCE）；别的消息 → null。 */
export function embedMessage(data) {
  if (!data || typeof data !== 'object' || data.source !== 'pinpoint-workbench') return null;
  if (data.type === 'close') return { type: 'close' };
  if (data.type === 'section' && typeof data.section === 'string' && data.section) return { type: 'section', section: data.section };
  return null;
}

/**
 * 顶栏“画布视图”从哪一节打开：读者正在读的那一节（目录高亮的那一节）有画布就是它，
 * 否则是它后面第一个有画布的节，再没有就是最后一个有画布的节。`ids` 是有画布的节（文章顺序），
 * `order` 是全部节（文章顺序）。
 */
export function entrySection(ids, order, current) {
  const list = ids || [];
  if (!list.length) return '';
  if (list.includes(current)) return current;
  const all = order || [];
  const at = all.indexOf(current);
  if (at >= 0) {
    for (let i = at + 1; i < all.length; i += 1) if (list.includes(all[i])) return all[i];
    return list[list.length - 1];
  }
  return list[0];
}
