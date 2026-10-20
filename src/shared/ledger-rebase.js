/**
 * 画布客户端（annotate.js）的保存撞上 409 时，把本窗口的改动接到盘上的最新版上再存。
 * 纯函数、不碰 DOM：serve 时内联进 /annotate.js，node 测试直接 import。
 *
 *   local  = 本窗口现在的行（含还没落盘的改动）
 *   base   = 本窗口最后一次确认的盘上版本（水合、保存应答、远端同步时记下）
 *   server = 盘上的最新版（409 带回的文档，或保存在途时经 SSE 先到的那版）
 *
 * 逐行、逐字段三方合并（2026-10-14 之前按整行取：owner 在本窗口只改正文，也会把另一个窗口
 * 改过的目标、附图盖回旧值）：
 *   - owner 字段一个一个比 local 与 base：改过（含删掉）的用 local，没改过的用 server。几个字段
 *     互相跟着走时算一组、整组取一边：目标组是 targets、顶层 selector / text（targets[0] 的镜像）
 *     和目标所在的 section / sectionLabel / screenId / indicatorKind；正文组是 content、遗留名
 *     comment 和从正文抽出的 mentions。目标组只比 ref + selector + text，只补了 ppId 不算改目标
 *     （与服务端的目标指纹同一口径）。
 *   - lastRect 是锚点几何缓存，同一条规则：本窗口变了用本窗口的。
 *   - status：owner 在这一边改过（关闭、重新打开）用 local，否则用 server，agent 经状态端点
 *     写的 check / done 就留下了。owner 改了正文或目标时，服务端按状态机把它回 open。
 *   - messages：server 的全部（agent 的回复只经 /reply 写），再接上 local 有、server 没有的。
 *   - n：用 server 的（取号权在服务端）。
 *   - owner 在这一边删掉的行不回来；别处新加的行留下；别处删掉、这一边没新建的行不回来；
 *     这一边新建、还没落盘的行接在最后。
 */

// 不按 owner 字段合并的：n、status、messages 各有规则（见上）。
import { annStatusOf } from './ann-status.js';
const OWN_RULE_FIELDS = new Set(['n', 'status', 'messages']);

// 一起改、一起取的字段组；不在组里的字段各自成组。
const FIELD_GROUPS = [
  ['targets', 'selector', 'text', 'section', 'sectionLabel', 'screenId', 'indicatorKind'],
  ['content', 'mentions'],
];
const GROUP_OF = new Map(FIELD_GROUPS.flatMap((keys) => keys.map((key) => [key, keys])));

/** 键排序后的 JSON：同一份数据不因键的先后不同而判成改过。 */
function stable(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((out, k) => { out[k] = v[k]; return out; }, {})
    : v));
}

/** 比较用的目标：ppId 是锚点的补充信息，补上它不算换了目标。 */
function comparableTargets(targets) {
  if (!Array.isArray(targets)) return targets;
  return targets.map((t) => (t && typeof t === 'object' ? { ref: t.ref, selector: t.selector, text: t.text } : t));
}

/** 一组字段在一行上的样子（缺的键不出现，删掉一个字段也算改过）。 */
function groupPart(row, keys) {
  const out = {};
  for (const key of keys) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, key)) continue;
    out[key] = key === 'targets' ? comparableTargets(row[key]) : row[key];
  }
  return stable(out);
}

function sameMessage(a, b) {
  return Boolean(a && b && a.who === b.who && a.text === b.text && a.at === b.at);
}

function mergeRow(local, base, server) {
  const row = {};
  const done = new Set(OWN_RULE_FIELDS);
  for (const key of [...Object.keys(server), ...Object.keys(local), ...Object.keys(base || {})]) {
    if (done.has(key)) continue;
    const keys = GROUP_OF.get(key) || [key];
    for (const k of keys) done.add(k);
    // 没有 base（本窗口建的行、底还没记下）：本窗口的就是 owner 的改动。
    // lastRect 本窗口没有时用盘上的：没算出几何不等于把它删了。
    const mine = !base || (groupPart(local, keys) !== groupPart(base, keys) && !(key === 'lastRect' && !('lastRect' in local)));
    const from = mine ? local : server;
    for (const k of keys) if (Object.prototype.hasOwnProperty.call(from, k)) row[k] = from[k];
  }
  if (Number.isInteger(server.n)) row.n = server.n;
  else if ('n' in local) row.n = local.n;
  row.status = base && annStatusOf(local) !== annStatusOf(base) ? annStatusOf(local) : annStatusOf(server);
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
