/**
 * 正文里的图（<Figure>，docs/projects.md“图”）的模型。纯函数、不 import 仓库代码：Figure.astro 用它渲染，
 * figure-client.js 用它的常量，node --test 测它。
 */

/** 图页：同源渲染端点，embed=figure（没有机壳、图注和标注客户端）。 */
export const figureSrc = (pageId, figureId) =>
  `/api/frame?page=${encodeURIComponent(pageId)}&figure=${encodeURIComponent(figureId)}&embed=figure`;

/** 图页报上来高度之前，iframe 先占的高度（px）。 */
export const FIGURE_MIN_HEIGHT = 160;

/**
 * articleCanvas 的结果 + remark 注入的序号 n → 这个图怎么显示：
 * { id, caption, title, src, errors: [message], missing }
 * - errors 不空时不出 iframe，只在图的位置列出错误（src 写坏、源文件不在、同一个图用了两次…）；
 * - 序号对不上（articleCanvas 里没有第 n 个图）也是一条错误，不该发生：两边走的是同一个 articleFigures。
 */
export function figureModel(canvas, n) {
  const index = Number.parseInt(String(n ?? ''), 10);
  const figure = Number.isInteger(index) ? (canvas?.figures || [])[index] : null;
  if (!figure) {
    return { id: '', caption: '', title: '图', src: '', missing: false, errors: [`找不到这个图（第 ${Number.isInteger(index) ? index + 1 : '?'} 个 <Figure>）`] };
  }
  const errors = (figure.errors || []).map((e) => String(e.message ?? ''));
  const id = figure.id || '';
  const caption = figure.caption || '';
  return {
    id,
    caption,
    title: caption || id || '图',
    src: id && !errors.length && canvas.pageId ? figureSrc(canvas.pageId, id) : '',
    missing: !!figure.missing,
    errors,
  };
}
