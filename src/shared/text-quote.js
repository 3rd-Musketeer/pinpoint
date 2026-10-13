/**
 * 正文评论的锚点（pp3 M2）：W3C TextQuote 式 —— 选中文字本身（exact）加前后各
 * 一小段上下文（prefix / suffix），另带 section id 作提示。纯函数、不碰 DOM：
 * 客户端先把正文抽成一条“规范化文本”（空白连成一个空格，见
 * src/client/prose-comments.js 的 buildTextIndex），这里只在那条文本上取引文与
 * 重新定位。注入客户端与 node 测试共用这一份。
 *
 * 重新定位：在文本里找 exact 的每一处出现，按与 prefix 的公共后缀长度 + 与
 * suffix 的公共前缀长度打分，落在提示的 section 里再加一点（只用来在上下文
 * 相同时分胜负：句子挪到别的节，上下文仍然说了算）。exact 一处都找不到 =
 * 定位不到（界面上标“失效”）。不做模糊匹配：引文本身被改了，评论指的就不再是
 * 那句话，诚实地标失效比猜一个位置好。
 */

/** prefix / suffix 各取多少个字符。 */
export const QUOTE_CONTEXT = 32;

/** 落在提示的 section 里的加分：上下文差距在 8 个字符以内时它分胜负，再大就是上下文说了算。 */
export const SECTION_HINT_SCORE = 8;

const WS = /\s/;

/** 空白（含换行、全角空格）连成一个半角空格；不去首尾。 */
export function collapseWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ');
}

/**
 * 规范化文本上 [start, end) 的引文。首尾空白先剥掉；剥完为空返回 null。
 * 返回 { exact, prefix, suffix, start, end }（start / end 是剥空白后的区间）。
 */
export function quoteFromText(text, start, end, context = QUOTE_CONTEXT) {
  const source = String(text ?? '');
  let from = Math.max(0, Math.min(start, end));
  let to = Math.min(source.length, Math.max(start, end));
  while (from < to && WS.test(source[from])) from += 1;
  while (to > from && WS.test(source[to - 1])) to -= 1;
  if (from >= to) return null;
  return {
    exact: source.slice(from, to),
    prefix: source.slice(Math.max(0, from - context), from),
    suffix: source.slice(to, to + context),
    start: from,
    end: to,
  };
}

function commonSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function commonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * 在规范化文本里重新定位一条引文。options：
 *   section     评论时所在的 section id（提示）
 *   sectionAt   (offset) => 该位置所在的 section id
 * 返回 { start, end, score } 或 null（exact 为空或一处都找不到）。
 */
export function locateQuote(text, quote, options = {}) {
  const source = String(text ?? '');
  const exact = quote && typeof quote.exact === 'string' ? quote.exact : '';
  if (!exact) return null;
  const prefix = typeof quote.prefix === 'string' ? quote.prefix : '';
  const suffix = typeof quote.suffix === 'string' ? quote.suffix : '';
  const { section = '', sectionAt = null } = options;
  let best = null;
  for (let at = source.indexOf(exact); at >= 0; at = source.indexOf(exact, at + 1)) {
    const end = at + exact.length;
    let score = commonSuffixLength(source.slice(Math.max(0, at - prefix.length), at), prefix)
      + commonPrefixLength(source.slice(end, end + suffix.length), suffix);
    if (section && sectionAt && sectionAt(at) === section) score += SECTION_HINT_SCORE;
    if (!best || score > best.score) best = { start: at, end, score };
  }
  return best;
}
