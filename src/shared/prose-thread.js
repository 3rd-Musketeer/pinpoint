/**
 * 正文评论的行与线程（pp3 M2）。纯数据、不碰 DOM：注入客户端与 node 测试共用。
 *
 * 一条正文评论是 @prose 账本里的一行（与画布标注同桶、同一套 #n 与状态机）：
 *   { id, n, type: 'prose', status, content, quote: { exact, prefix, suffix },
 *     section, path, created_at, messages: [{ who: 'owner' | 'agent', text, at }] }
 * content 是 owner 的第一句（列表、ppnt check 照常读它）；之后的来回在 messages。
 * agent 的消息只经服务端 /reply 写（ppnt reply），不改状态。
 *
 * 客户端的写入是“操作”而不是整份快照：保存撞上 409（agent 刚回了一句、另一个
 * 标签页刚存过）时，把还没落盘的操作重放到磁盘上的最新版本再存，别人的改动
 * 不会被这一边的旧快照盖掉。
 */

export const PROSE_LEDGER = '@prose';

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
    quote: { exact: quote.exact, prefix: quote.prefix || '', suffix: quote.suffix || '' },
    section: section || '',
    path: path || '',
    created_at: at,
    messages: [],
  };
}

/**
 * 把操作依次作用到行列表上，返回新列表（不改传入的行）。操作：
 *   { op: 'create', row }                新评论（id 已存在就跳过）
 *   { op: 'reply', id, text, at }        owner 回一句：追加消息，状态回 open
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
      next = { ...row, status: 'open', messages: [...messages, { who: 'owner', text: String(op.text ?? ''), at: op.at }] };
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
