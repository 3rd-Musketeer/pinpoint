/**
 * Frame-scoped anchor normalization (阶段 5 文档 mention 活 frame + 标注双向透传).
 *
 * 锚点事实（client/annotate.js cssPath）：标注 selector 是「所在文档的绝对 CSS
 * 路径」，`tag.cls:nth-of-type(n)` 段链向上走到 body，遇 id 短路。画布上它穿过
 * `#lib-<section> > .wb-sec-body > .wb-screen[data-screen] > .ios-stage > …`，
 * 因此 section 重排不断、frame 换序/跨 section 移动会断（nth-of-type 漂移）。
 *
 * 透传不新增存储字段：frame 在每个承载面（画布板文档、/api/frame 嵌入页、导出
 * 快照）都由同一个 stage 根类（.ios-stage / .wb-comp-stage / .wb-html-stage）
 * 包裹同一份 fragment，stage 以下的链由共享机壳（lib/frame-shell.js）逐字节同构。
 * 所以「frame 内相对路径」可以从既有绝对 selector 纯字符串派生 —— 切到 stage 段、
 * 取其后缀，拼成 `:scope` 相对链。两端解析时各自把 `:scope` 绑定到本视图的
 * stage 根，即得 canonical = pageId + screenId + frame 内路径，存量标注零迁移，
 * frame 移动后锚点自愈（不再靠 nth-of-type 找 frame）。
 *
 * 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。
 */

/** Frame 内容在任意承载面的 stage 根类（与 annotate.js FRAME_SEL 对齐）。 */
export const FRAME_STAGE_CLASSES = ['ios-stage', 'wb-comp-stage', 'wb-html-stage', 'wb-screen-err'];

/** querySelector 形态：找某容器内的 frame stage 根。 */
export const FRAME_STAGE_SELECTOR = FRAME_STAGE_CLASSES.map((c) => '.' + c).join(', ');

// cssPath 段形：`tag.cls:nth-of-type(n)`（cls 取 classList[0]）。stage 根的第一
// 个类恒为 stage 类名（机壳由 loader 生成，无前置自定义类）。
const STAGE_SEGMENT_RE = /^[a-z][a-z0-9-]*\.(ios-stage|wb-comp-stage|wb-html-stage|wb-screen-err)(?=[:.]|$)/;

/**
 * 从绝对 selector 派生 frame 内相对选择器。
 * 命中 stage 段：其后缀拼成 `:scope > …`；锚点就是 stage 根本身时返回 `:scope`。
 * 无法派生（无 stage 段 —— 例如 fragment 元素 id 短路成的 `#foo > …`，此类
 * selector 在各视图天然同 key，不需要归一）返回 null。
 */
export function frameInternalSelector(selector) {
  const sel = String(selector || '');
  if (!sel) return null;
  const segments = sel.split(' > ');
  for (let i = 0; i < segments.length; i++) {
    if (STAGE_SEGMENT_RE.test(segments[i])) {
      const rest = segments.slice(i + 1);
      return rest.length ? ':scope > ' + rest.join(' > ') : ':scope';
    }
  }
  return null;
}

/**
 * 在 stage 根上解析 frame 内相对选择器。`:scope` 即根自身。
 * 返回元素或 null；非法 selector 安静落空（与 annotate.js resolve() 同约）。
 */
export function queryFrameScope(stageRoot, internalSelector) {
  if (!stageRoot || !internalSelector) return null;
  if (internalSelector === ':scope') return stageRoot;
  try {
    return stageRoot.querySelector(internalSelector);
  } catch {
    return null;
  }
}
