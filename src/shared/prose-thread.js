/**
 * 正文评论的行与线程（pp3）。纯数据、不碰 DOM：注入客户端与 node 测试共用。
 *
 * 一条正文评论是 @prose 账本里的一行（与画布标注同桶、同一套 #n 与状态机）：
 *   { id, n, type: 'prose', status, content, quote: { exact, prefix, suffix, start? },
 *     section, path, created_at, messages: [{ who: 'owner' | 'agent', text, at }] }
 * content 是 owner 的第一句（列表、ppnt check 照常读它）；之后的来回在 messages。
 * agent 的消息只经服务端 /reply 写（ppnt reply），不改状态。
 *
 * 客户端的写入是“操作”而不是整份快照：保存撞上 409（agent 刚回了一句、另一个
 * 标签页刚存过）时，把还没落盘的操作重放到磁盘上的最新版本再存，别人的改动
 * 不会被这一边的旧快照盖掉。
 */

export { PROSE_LEDGER } from './project-ids.js';

export function isProseRow(row) {
  return Boolean(row && row.type === 'prose');
}

/** 新评论的行。status 恒为 open、n 由服务端发（这里不带）。 */
export function newProseRow({ id, content, quote, section = '', path = '', at }) {
  return {
    id,
    type: 'prose',
    status: 'open',
    content: String(content ?? ''),
    quote: {
      exact: quote.exact,
      prefix: quote.prefix || '',
      suffix: quote.suffix || '',
      // 选中时在规范化文本里的位置：只在重复引文平分时作提示（src/shared/text-quote.js）。
      ...(Number.isInteger(quote.start) ? { start: quote.start } : {}),
    },
    section: section || '',
    path: path || '',
    created_at: at,
    messages: [],
  };
}

/**
 * 把操作依次作用到行列表上，返回新列表（不改传入的行）。操作：
 *   { op: 'create', row }                新评论（id 已存在就跳过）
 *   { op: 'reply', id, text, at }        owner 回一句：追加消息，状态回 open；同一条（原文与 at 相同）已在就跳过
 *   { op: 'edit', id, content }          owner 改第一句（content）：状态回 open（服务端对改 content 同一条规则）
 *   { op: 'status', id, status }         owner 关闭 / 重新打开（close / open）
 * 目标行已经不在（别处删了）的操作跳过。
 */
export function applyProseOps(rows, ops) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  for (const op of ops || []) {
    if (!op) continue;
    if (op.op === 'create') {
      if (!out.some((row) => row && row.id === op.row.id)) out = [...out, { ...op.row }];
      continue;
    }
    const index = out.findIndex((row) => row && row.id === op.id);
    if (index < 0) continue;
    const row = out[index];
    let next = row;
    if (op.op === 'reply') {
      const messages = Array.isArray(row.messages) ? row.messages : [];
      const text = String(op.text ?? '');
      // 同一条回复（owner、原文、at 都相同）已经在盘上：重放不再追加。离开页面时补发的
      // 那份先落了盘、409 后重放剩下的操作，就是这种情况。
      if (op.at && messages.some((m) => m && m.who === 'owner' && m.text === text && m.at === op.at)) continue;
      next = { ...row, status: 'open', messages: [...messages, { who: 'owner', text, at: op.at }] };
    } else if (op.op === 'edit') {
      next = { ...row, status: 'open', content: String(op.content ?? '') };
    } else if (op.op === 'status') {
      next = { ...row, status: op.status };
    }
    out = out.slice();
    out[index] = next;
  }
  return out;
}

/** 线程的全部消息：owner 的第一句（content）在前，之后是 messages。 */
export function threadMessages(row) {
  if (!row) return [];
  const first = row.content ? [{ who: 'owner', text: row.content, at: row.created_at || '' }] : [];
  const rest = Array.isArray(row.messages) ? row.messages.filter((m) => m && typeof m.text === 'string') : [];
  return [...first, ...rest];
}

/** 作者的显示名：本机评论只有 owner 自己写，所以 owner 叫“你”。 */
export function authorLabel(who) {
  return who === 'agent' ? 'agent' : '你';
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

/** 消息时间的显示：刚刚 / N 分钟前 / 今天 HH:MM / M月D日 HH:MM（本地时区）。 */
export function formatWhen(iso, now = new Date()) {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return '';
  const diff = now.getTime() - at.getTime();
  if (diff >= -60_000 && diff < 60_000) return '刚刚';
  if (diff > 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const hm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  if (sameDay) return hm;
  return `${at.getMonth() + 1}月${at.getDate()}日 ${hm}`;
}

/** 已关闭 = owner 点了完成（close）。open / check / done 都还在等 owner 验收，不算。 */
export function isProseClosed(row) {
  return ((row && row.status) || 'open') === 'close';
}

/**
 * 右栏一列的顺序：按 orderKey(row)（正文里的位置，定位不到给 Infinity）排，同位或都
 * 定位不到时按 #n，还没发号的排最后。已关闭的不挪位置，留在原处收成一行。不改传入数组。
 */
export function railOrder(rows, orderKey = () => Infinity) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  return list.slice().sort((a, b) => {
    const d = orderKey(a) - orderKey(b);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return (Number.isInteger(a.n) ? a.n : Infinity) - (Number.isInteger(b.n) ? b.n : Infinity) || 0;
  });
}

/**
 * 输入框里这次按键是不是“发送”：Enter 发送，Shift+Enter 换行。输入法组字中按的
 * Enter 是确认候选词，不发送（isComposing；Safari 组字结束那一下 keyCode 是 229）。
 * 参数是 KeyboardEvent 或同形状的普通对象。
 */
export function isSendKey(e) {
  if (!e || e.key !== 'Enter') return false;
  if (e.shiftKey || e.isComposing || e.keyCode === 229) return false;
  return true;
}

/**
 * 右栏里穿插的画布标注（2026-10-15）：@canvas 账本里落在本篇画布卡片上的行。
 * `cards` 是正文里的画布卡片，文章顺序：[{ section, page, frames: [{ id, title }] }]。
 * 一行按帧 id（screenId）归到它所在的那张卡片；不在任何卡片上的（帧删了、别的页的行）不进右栏。
 * → [{ row, section, frameId, frameTitle, card }]，card 是卡片在文章里的序号，排序键由调用方按它取。
 */
export function canvasRailItems(rows, cards) {
  const byFrame = new Map();
  (cards || []).forEach((card, index) => {
    for (const f of card.frames || []) {
      if (f && f.id && !byFrame.has(f.id)) byFrame.set(f.id, { card: index, section: card.section, page: card.page || '', title: f.title || f.id });
    }
  });
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row || isProseRow(row)) return false;
    const at = byFrame.get(row.screenId);
    return Boolean(at && (!row.pageId || !at.page || row.pageId === at.page));
  }).map((row) => {
    const at = byFrame.get(row.screenId);
    return { row, section: at.section, frameId: row.screenId, frameTitle: at.title, card: at.card };
  });
}

/**
 * 画布标注正文里的目标记号 `[@t:iN]` 换成它指着的元素文字（“…”），找不到就去掉；
 * 右栏只读不改，存盘的正文不动。
 */
export function canvasContentText(row) {
  const targets = Array.isArray(row && row.targets) ? row.targets : [];
  return String((row && row.content) || '').replace(/\[@t:(i[1-9][0-9]*)\]/g, (_, ref) => {
    const t = targets.find((x) => x && x.ref === ref);
    const text = t && typeof t.text === 'string' ? t.text.trim() : '';
    return text ? `“${text.length > 24 ? `${text.slice(0, 23)}…` : text}”` : '';
  }).replace(/[ \t]{2,}/g, ' ').trim();
}
