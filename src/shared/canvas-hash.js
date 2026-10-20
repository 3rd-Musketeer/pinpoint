/**
 * 画布浮层 hash 的格式化与解析（site/README.md「画布浮层」）：纯函数，不碰 DOM。
 * 文章页浮层（site/src/lib/canvas-overlay*.js）与正文评论右栏（src/client/prose-comments.js）
 * 共用这一份，字节一致。
 */

/** 浮层地址：节、可选的帧与钉子。旧链接的 view 参数按未知参数忽略。 */
export function canvasHash(sectionId, { frame = '', ann = '' } = {}) {
  const q = new URLSearchParams({ canvas: sectionId });
  if (frame) q.set('frame', frame);
  if (ann !== '' && ann != null) q.set('ann', String(ann));
  return `#${q.toString()}`;
}

/** `#canvas=<节>[&frame=<帧>][&ann=<n>]` → { section, frame, ann }。
 * ann 是正整数或 null；其他 hash 返回 null。
 */
export function parseCanvasHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('canvas=')) return null;
  const q = new URLSearchParams(raw);
  const section = q.get('canvas') || '';
  if (!section) return null;
  const frame = q.get('frame') || '';
  const n = Number(q.get('ann'));
  return {
    section,
    frame,
    ann: Number.isInteger(n) && n > 0 ? n : null,
  };
}
