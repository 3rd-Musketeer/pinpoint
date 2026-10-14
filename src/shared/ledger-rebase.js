/**
 * 画布客户端（annotate.js）的保存撞上 409 时，把本窗口的改动接到盘上的最新版上再存。
 * 纯函数、不碰 DOM：serve 时内联进 /annotate.js，node 测试直接 import。
 *
 *   local  = 本窗口现在的行（含还没落盘的改动）
 *   base   = 本窗口最后一次确认的盘上版本（水合、保存应答、远端同步时记下）
 *   server = 盘上的最新版（409 带回的文档，或保存在途时经 SSE 先到的那版）
 *
 * 逐行三方合并：
 *   - owner 改过的部分（local 与 base 不同）用 local；没改过的用 server。
 *   - status：owner 在这一边改过（关闭、重新打开）用 local，否则用 server，agent 经状态端点
 *     写的 check / done 就留下了。owner 改了正文或目标时，服务端按状态机把它回 open。
 *   - messages：server 的全部（agent 的回复只经 /reply 写），再接上 local 有、server 没有的。
 *   - n：用 server 的（取号权在服务端）。
 *   - owner 在这一边删掉的行不回来；别处新加的行留下；别处删掉、这一边没新建的行不回来；
 *     这一边新建、还没落盘的行接在最后。
 */

// 不算 owner 编辑的字段：n、status、messages 各有规则；lastRect 是锚点几何缓存。
const NOT_OWNER_FIELDS = new Set(['n', 'status', 'messages', 'lastRect']);

/** 键排序后的 JSON：同一份数据不因键的先后不同而判成改过。 */
function stable(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((out, k) => { out[k] = v[k]; return out; }, {})
    : v));
}

function ownerPart(row) {
  const out = {};
  for (const key of Object.keys(row || {})) if (!NOT_OWNER_FIELDS.has(key)) out[key] = row[key];
  return stable(out);
}

function sameMessage(a, b) {
  return Boolean(a && b && a.who === b.who && a.text === b.text && a.at === b.at);
}

function statusOf(row) {
  return (row && row.status) || 'open';
}

function mergeRow(local, base, server) {
  const ownerEdited = !base || ownerPart(local) !== ownerPart(base);
  const row = ownerEdited ? { ...local } : { ...server };
  if (!ownerEdited && 'lastRect' in local && stable(local.lastRect) !== stable(base.lastRect)) row.lastRect = local.lastRect;
  if (Number.isInteger(server.n)) row.n = server.n;
  row.status = base && statusOf(local) !== statusOf(base) ? statusOf(local) : statusOf(server);
  const messages = Array.isArray(server.messages) ? server.messages.slice() : [];
  for (const m of Array.isArray(local.messages) ? local.messages : []) {
    if (!messages.some((x) => sameMessage(x, m))) messages.push(m);
  }
  if (messages.length || 'messages' in server || 'messages' in local) row.messages = messages;
  return row;
}

/** 返回合并后的行列表（新对象；不改传入的行）。 */
export function rebaseAnnotations(local, base, server) {
  const localRows = (Array.isArray(local) ? local : []).filter(Boolean);
  const serverRows = (Array.isArray(server) ? server : []).filter(Boolean);
  const baseById = new Map((Array.isArray(base) ? base : []).filter((row) => row && row.id).map((row) => [row.id, row]));
  const localById = new Map(localRows.filter((row) => row.id).map((row) => [row.id, row]));
  const onServer = new Set(serverRows.filter((row) => row.id).map((row) => row.id));
  const out = [];
  for (const row of serverRows) {
    const mine = row.id ? localById.get(row.id) : null;
    if (!mine) {
      if (!row.id || !baseById.has(row.id)) out.push({ ...row });
      continue;
    }
    out.push(mergeRow(mine, baseById.get(row.id), row));
  }
  for (const row of localRows) {
    if (row.id && (onServer.has(row.id) || baseById.has(row.id))) continue;
    out.push({ ...row });
  }
  return out;
}
