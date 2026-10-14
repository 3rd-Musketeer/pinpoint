/**
 * 正文评论的锚点（pp3）：W3C TextQuote 式 —— 选中文字本身（exact）加前后各
 * 一小段上下文（prefix / suffix），另带 section id 与选中时的位置 start 作提示。
 * 纯函数、不碰 DOM：客户端先把正文抽成一条“规范化文本”（normalizeWhitespace，见
 * src/client/prose-comments.js 的 buildTextIndex），这里只在那条文本上取引文与
 * 重新定位。注入客户端与 node 测试共用这一份。
 *
 * 规范化（两边同一条规则）：一段空白（换行、制表、全角空格、块元素边界）夹在两个
 * CJK 字之间时算没有，其余情况连成一个半角空格；首尾的空白不留。中文段落里的软换行
 * 因此不进引文，源文件改了折行（拆行 / 并行）评论照样定位；中英交界、英文词间的
 * 空格是真空格，留一个。存下的引文在定位前也按这条规则规范化一遍，旧客户端存的
 * “换行变空格”的引文照样能定位。
 *
 * 重新定位：在文本里找 exact 的每一处出现，按与 prefix 的公共后缀长度 + 与
 * suffix 的公共前缀长度打分，落在提示的 section 里再加一点（只用来在上下文
 * 相同时分胜负：句子挪到别的节，上下文仍然说了算）；还平分时取离 start 最近的一处
 * （表格里上下文完全相同的重复行）。exact 一处都找不到 = 定位不到（界面上标“失效”）。
 * 不做模糊匹配：引文本身被改了，评论指的就不再是那句话，诚实地标失效比猜一个位置好。
 */

/** prefix / suffix 各取多少个字符。 */
export const QUOTE_CONTEXT = 32;

/** 落在提示的 section 里的加分：上下文差距在 8 个字符以内时它分胜负，再大就是上下文说了算。 */
export const SECTION_HINT_SCORE = 8;

const WS = /\s/;

// CJK：汉字（含扩展区与兼容区）、假名、注音、CJK 符号与标点、全角形式。韩文按词用
// 空格断开，不算。代理对（扩展 B 起的汉字）按完整码位判断。
const CJK = /^[\u2e80-\u2fdf\u3001-\u303f\u3040-\u30ff\u3100-\u312f\u31a0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{3fffd}]$/u;

function isCjk(ch) {
  return CJK.test(ch);
}

/**
 * 规范化文本（规则见文件头）。返回 { text, map }：map 长度 = 原文长度 + 1，
 * map[k] = 原文第 k 个字符在 text 里的位置（空白字符取它前一个字之后的位置）。
 */
export function normalizeWhitespace(raw) {
  const source = String(raw ?? '');
  const map = new Array(source.length + 1);
  let out = '';
  let pending = false;
  let lastCjk = false;
  for (let k = 0; k < source.length; k += 1) {
    const ch = source[k];
    if (WS.test(ch)) {
      map[k] = out.length;
      if (out) pending = true;
      continue;
    }
    const code = source.codePointAt(k);
    const full = String.fromCodePoint(code);
    const cjk = isCjk(full);
    if (pending && !(lastCjk && cjk)) out += ' ';
    pending = false;
    for (let j = 0; j < full.length; j += 1) map[k + j] = out.length + j;
    out += full;
    lastCjk = cjk;
    k += full.length - 1;
  }
  map[source.length] = out.length;
  return { text: out, map };
}

/**
 * 存下的引文 → 规范化后的 { exact, prefix, suffix }。三段连起来规范化再切开，
 * 段与段交界处的空白按两边的字判断。
 */
export function normalizeQuote(quote) {
  const exact = quote && typeof quote.exact === 'string' ? quote.exact : '';
  const prefix = quote && typeof quote.prefix === 'string' ? quote.prefix : '';
  const suffix = quote && typeof quote.suffix === 'string' ? quote.suffix : '';
  const { text, map } = normalizeWhitespace(prefix + exact + suffix);
  const from = map[prefix.length];
  const to = Math.max(from, map[prefix.length + exact.length]);
  return { exact: text.slice(from, to).trim(), prefix: text.slice(0, from), suffix: text.slice(to) };
}

/**
 * 规范化文本上 [start, end) 的引文。首尾空白先剥掉；剥完为空返回 null。
 * 返回 { exact, prefix, suffix, start, end }（start / end 是剥空白后的区间；start 随
 * 引文存下，作重复引文的位置提示）。
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
 * 在规范化文本（normalizeWhitespace 的 text）里重新定位一条引文。引文先规范化。options：
 *   section     评论时所在的 section id（提示）
 *   sectionAt   (offset) => 该位置所在的 section id
 * quote.start（可选）是选中时的位置：前后文与节都平分时取离它最近的一处。
 * 返回 { start, end, score } 或 null（exact 为空或一处都找不到）。
 */
export function locateQuote(text, quote, options = {}) {
  const source = String(text ?? '');
  if (!quote) return null;
  const { exact, prefix, suffix } = normalizeQuote(quote);
  if (!exact) return null;
  const hint = Number.isInteger(quote.start) ? quote.start : null;
  const { section = '', sectionAt = null } = options;
  let best = null;
  for (let at = source.indexOf(exact); at >= 0; at = source.indexOf(exact, at + 1)) {
    const end = at + exact.length;
    let score = commonSuffixLength(source.slice(Math.max(0, at - prefix.length), at), prefix)
      + commonPrefixLength(source.slice(end, end + suffix.length), suffix);
    if (section && sectionAt && sectionAt(at) === section) score += SECTION_HINT_SCORE;
    const closer = best && score === best.score && hint !== null && Math.abs(at - hint) < Math.abs(best.start - hint);
    if (!best || score > best.score || closer) best = { start: at, end, score };
  }
  return best;
}
