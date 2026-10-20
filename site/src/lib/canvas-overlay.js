/**
 * 画布浮层（文章上开整张画布）：纯函数，不碰 DOM。浏览器端是 canvas-overlay-client.js，
 * node --test 守地址契约。契约在 site/README.md「画布浮层」。
 */
import { canvasViewHref } from '../../../src/shared/workbench-url.js';

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

/**
 * 浮层里的工作台：画布视图的地址加 `embed=overlay`（src/workbench/lib/page-url.js isEmbedded）。
 * `gen` 是文档代次：重试换 src 时递增，工作台原样回传（index.html 在文档起点存的 window.__wbGen），文章页
 * 据此丢掉旧文档迟到的消息。嵌入版不出左栏和“← 文章标题”，Esc 交回文章页（src/workbench/embed.js）。
 */
export function embedCanvasSrc(pageId, sectionId, gen = '') {
  const mark = gen !== '' && gen != null ? `&gen=${Number(gen)}` : '';
  return `${canvasViewHref(pageId, sectionId)}&embed=overlay${mark}`;
}

/** 工作台嵌入版发来的消息（src/workbench/embed.js EMBED_MESSAGE_SOURCE）；别的消息 → null。
 * 就绪三条（C1）带 `gen` 与（ready 时的）`pageId`，原样透传给客户端核对。 */
export function embedMessage(data) {
  if (!data || typeof data !== 'object' || data.source !== 'pinpoint-workbench') return null;
  if (data.type === 'close') return { type: 'close' };
  if (data.type === 'section' && typeof data.section === 'string' && data.section) return { type: 'section', section: data.section };
  // 停驻回执（E2）：工作台暂停 / 恢复完成后回一条，文章页据此把预热中收成停驻。
  // 不带代次：停驻是这一份 iframe 的事，重试换文档时整段作废，旧回执对不上新文档。
  if (data.type === 'parked') return { type: 'parked' };
  if (data.type === 'ready' || data.type === 'board-error' || data.type === 'boot-error') {
    const gen = Number(data.gen);
    return {
      type: data.type,
      gen: Number.isFinite(gen) && gen > 0 ? gen : 0,
      ...(data.type === 'ready' && typeof data.pageId === 'string' ? { pageId: data.pageId } : {}),
    };
  }
  return null;
}

/**
 * 文档就绪状态机（纯函数，C1）：`state` 是浮层对当前 iframe 文档的就绪状态，
 * `msg` 是核对过 `gen` / `pageId` 之后的 embedMessage 产物。返回新状态：
 * - 'loading'：等工作台的主动信号（不靠时长猜失败）；
 * - 'ready'：板和预览都落定，收起准备态、放行定位；
 * - 'board-error'：工作台画了自己的错误面板，收起准备态让出面板；
 * - 'retry'：文档加载失败或入口脚本报了加载失败，显示「重试」。
 * 任何状态下收到 ready 都收起（显示重试之后观察也不停）；boot-error 一律算失败。
 */
export function overlayDocNext(state, msg) {
  if (!msg) return state;
  if (msg.type === 'ready') return 'ready';
  if (msg.type === 'boot-error') return 'retry';
  if (msg.type === 'board-error') return state === 'retry' ? state : 'board-error';
  return state;
}

/**
 * 画布浮层的生命周期（E2）。状态：
 * - absent  还没建 iframe；
 * - warming 正在按打开时的布局尺寸预热（停驻容器里，不在开着的 dialog 里）；
 * - parked  预热完成或关闭后停驻：保持打开时的布局尺寸，工作台暂停；
 * - open    浮层开着，工作台恢复。
 * 关闭中又打开、预热中打开都走 open；换节不换文档，状态不动。深链落点跳过预热，直接 open。
 */
const OVERLAY_PHASES = ['absent', 'warming', 'parked', 'open'];

export function overlayPhaseNext(phase, event) {
  const cur = OVERLAY_PHASES.includes(phase) ? phase : 'absent';
  if (event === 'prewarm') return cur === 'absent' ? 'warming' : cur;
  if (event === 'park') return cur === 'warming' || cur === 'open' ? 'parked' : cur;
  if (event === 'open') return cur === 'open' ? cur : 'open';
  if (event === 'discard') return 'absent';
  return cur;
}

/**
 * 预热从哪一节开：视口里靠前的可见卡片。一张都不在视口里（还没排版、
 * 卡片在折叠下）就用顶栏入口的那一节（`entrySection`）。`visibleIds` 是可见卡片的节 id，
 * 顺序不限；`ids` 是有画布的节（文章顺序）。
 */
export function prewarmSection(ids, visibleIds, fallback) {
  const list = ids || [];
  if (!list.length) return '';
  const seen = new Set(visibleIds || []);
  const hit = list.find((id) => seen.has(id));
  if (hit) return hit;
  return list.includes(fallback) ? fallback : list[0];
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
