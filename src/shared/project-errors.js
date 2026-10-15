/**
 * project 的布局错误（docs/projects.md“读取”）：listProjects、articleCanvas、站点与工作台
 * 之间传的是对象，拼成一行字只在显示的那一头（CLI 输出、/health、站点错误条、工作台 tooltip）。
 *
 *   { code, message, path?, section?, frame?, figure?, line? }
 *   - code：错误的种类（见下面各处的字面量），给程序分辨用，不显示；
 *   - message：显示的那句话，不带文件前缀；
 *   - path：错误属于哪个文件或目录，相对 <project 根>/docs/pinpoint/（`articles/x/index.mdx`、
 *     `articles/x`、`wiki/a.md`）。project 自己的错误（根目录、project.json、撞名）没有；
 *   - section、frame、line：画布写法的错误落在哪一节、哪一帧、index.mdx 第几行；
 *   - figure：正文里的图（<Figure>）的错误落在哪个图（认得出图 id 时）。图的错误 code 以 figure_ 开头。
 *
 * 叶子模块：不 import 任何东西。
 */

/** 一条错误 → 一行字：有 path 的写成 `<path>：<message>`。 */
export function formatProjectError(error) {
  const message = String((error && error.message) ?? '');
  return error && error.path ? `${error.path}：${message}` : message;
}

/** 这条错误属不属于某一篇文章（它的目录或目录下的文件）。 */
export function isArticleError(error, articleId) {
  const p = (error && error.path) || '';
  const dir = `articles/${articleId}`;
  return p === dir || p.startsWith(`${dir}/`);
}

/** 这条错误是不是正文里某个图（<Figure>）的：站点把它显示在图的位置，不进画布卡片和页顶错误条。 */
export function isFigureError(error) {
  return /^figure_/.test(String((error && error.code) || ''));
}
