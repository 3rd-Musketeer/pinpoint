/**
 * ppnt 引用解析（2026-09-22 切片 4，决定 #18）：check / locate / shot / mark
 * 共用的一套地址语法 ——
 *   #12          本页标注序号（registry entry 内单调、跨账本唯一）
 *   <entry>#12   跨页标注（plugins#12）
 *   #3-#7        区间（含端点）
 *   B3           图纸号 → 该帧全部标注（shot 里指帧本身）
 *   B            段字母 → 整段（section）
 *   <page>       整页（仅 shot）
 *   @frame:p/s   机器帧语法（annotation-indicator 的 parseIndicator）
 *   @a:<id>      标注内部 id
 *   --status s   按状态展开（open|check|done|close|all）
 *
 * 纯函数：ctx 由调用方备好（本页标注行、board、跨页行读取器），这里只做匹配
 * 与展开，错误逐条带原文返回，不让一个坏引用打断整批。
 */
import { boardRefs } from '../../workbench/lib/board-refs.js';
import { parseIndicator } from '../../shared/annotation-indicator.js';

const FRAME_REF_RE = /^([A-Z]+)([1-9][0-9]*)$/;
const SECTION_REF_RE = /^([A-Z]+)$/;
const NUM_REF_RE = /^#([1-9][0-9]*)$/;
const CROSS_NUM_REF_RE = /^([a-z0-9][a-z0-9-]*)#([1-9][0-9]*)$/;
const RANGE_REF_RE = /^#([1-9][0-9]*)-#?([1-9][0-9]*)$/;

/**
 * board + 本页标注 → 解析一枚引用。返回 pick 之一：
 *   { kind: 'annotation', row }            一条标注
 *   { kind: 'frame', screenId, ref }       一帧（mark/locate 展开成该帧标注，shot 指帧图）
 *   { kind: 'section', sectionId, ref }    一段
 *   { kind: 'page' }                       整页（仅 shot 有意义）
 * 或 { kind: 'unknown', token, message }。
 *
 * ctx = { rows, board, pageId, crossPageRows }；rows 是本页标注行（任何带
 * n / id / screenId / status 的对象）；crossPageRows(pageRef) → rows（按需读，
 * 缺省 null = 该页没有）。frameRefs 由 board 派生。
 */
export function resolveRef(token, ctx = {}) {
  const raw = String(token || '').trim();
  if (!raw) return { kind: 'unknown', token, message: '空引用' };
  const { rows = [], board = null, pageId = '', crossPageRows = null } = ctx;
  const refs = board ? boardRefs(board) : { outline: [], bySection: {}, byFrame: {} };

  let m = raw.match(NUM_REF_RE);
  if (m) {
    const row = rows.find((a) => Number(a.n) === Number(m[1]));
    if (!row) return { kind: 'unknown', token, message: `本页没有 #${m[1]}` };
    return { kind: 'annotation', row };
  }
  m = raw.match(RANGE_REF_RE);
  if (m) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (to < from) return { kind: 'unknown', token, message: `区间终点小于起点：${raw}` };
    // 区间按序号匹配，缺失的序号不报错（条目可能已 close 收起或从未存在）。
    const picked = rows.filter((a) => Number(a.n) >= from && Number(a.n) <= to);
    return { kind: 'range', rows: picked, token: raw };
  }
  m = raw.match(CROSS_NUM_REF_RE);
  if (m) {
    if (m[1] === pageId) return resolveRef(`#${m[2]}`, ctx);
    if (!crossPageRows) return { kind: 'unknown', token, message: `跨页引用不可解析（没有 ${m[1]} 的标注数据）：${raw}` };
    const crossRows = crossPageRows(m[1]);
    const row = crossRows.find((a) => Number(a.n) === Number(m[2]));
    if (!row) return { kind: 'unknown', token, message: `${m[1]} 没有 #${m[2]}` };
    return { kind: 'annotation', row };
  }
  m = raw.match(FRAME_REF_RE);
  if (m) {
    const hit = refs.outline.flatMap((section) => section.frames).find((frame) => frame.ref === raw);
    if (!hit) return { kind: 'unknown', token, message: `图纸上没有帧 ${raw}` };
    return { kind: 'frame', screenId: hit.id, ref: raw, title: hit.title };
  }
  m = raw.match(SECTION_REF_RE);
  if (m) {
    const sectionId = Object.keys(refs.bySection).find((id) => refs.bySection[id] === raw);
    if (!sectionId) return { kind: 'unknown', token, message: `图纸上没有段 ${raw}` };
    const outline = refs.outline.find((section) => section.id === sectionId);
    return { kind: 'section', sectionId, ref: raw, title: outline ? outline.title : sectionId, frames: outline ? outline.frames : [] };
  }
  if (raw === pageId && pageId) return { kind: 'page' };
  const indicator = parseIndicator(raw);
  if (indicator && indicator.kind === 'frame') {
    const hit = refs.outline.flatMap((section) => section.frames).find((frame) => frame.id === indicator.screenId);
    if (!hit) return { kind: 'unknown', token, message: `图纸上没有帧 ${indicator.screenId}` };
    return { kind: 'frame', screenId: hit.id, ref: hit.ref, title: hit.title };
  }
  if (indicator && indicator.kind === 'annotation') {
    const row = rows.find((a) => a.id === indicator.id) || rows.find((a) => String(a.n) === indicator.id);
    if (!row) return { kind: 'unknown', token, message: `没有 @a:${indicator.id}` };
    return { kind: 'annotation', row };
  }
  return { kind: 'unknown', token, message: `认不出引用：${raw}（可用：#n、entry#n、#3-#7、B3、B、@frame:p/s、@a:id）` };
}

export const REF_STATUSES = ['open', 'check', 'done', 'close', 'all'];

/**
 * 一批引用展开成统一的 picks 列表（标注去重保序）。frame / section 按「该范围内
 * 的标注行」展开（mark / locate 语义）；保留 kind:frame / section / page 供 shot
 * 拍图用（shotOptions=true 时 frame 不展开成标注）。--status 在这里展开。
 */
export function expandRefs(tokens, ctx = {}, { shotRefs = false } = {}) {
  const picks = [];
  const errors = [];
  const seen = new Set();
  const pushAnnotation = (row, via) => {
    const key = `${row.__bucket || ''}|${row.__ledger || ''}|${row.id || row.n}`;
    if (seen.has(key)) return;
    seen.add(key);
    picks.push({ kind: 'annotation', row, via });
  };
  const pushFrameAnnotations = (screenId, via) => {
    const rows = (ctx.rows || []).filter((a) => a.screenId === screenId);
    if (!rows.length) errors.push(`${via}：该帧暂无标注`);
    for (const row of rows) pushAnnotation(row, via);
  };
  for (const token of tokens) {
    const pick = resolveRef(token, ctx);
    if (pick.kind === 'unknown') {
      errors.push(pick.message);
      continue;
    }
    if (pick.kind === 'annotation') {
      pushAnnotation(pick.row, token);
      continue;
    }
    if (pick.kind === 'range') {
      if (!pick.rows.length) errors.push(`${token}：区间内没有标注`);
      for (const row of pick.rows) pushAnnotation(row, token);
      continue;
    }
    if (pick.kind === 'frame') {
      if (shotRefs) picks.push({ kind: 'frame', screenId: pick.screenId, ref: pick.ref, title: pick.title, via: token });
      else pushFrameAnnotations(pick.screenId, token);
      continue;
    }
    if (pick.kind === 'section') {
      if (shotRefs) {
        picks.push({ kind: 'section', sectionId: pick.sectionId, ref: pick.ref, title: pick.title, frames: pick.frames, via: token });
        continue;
      }
      const screenIds = pick.frames.map((frame) => frame.id);
      const rows = (ctx.rows || []).filter((a) => screenIds.includes(a.screenId));
      if (!rows.length) errors.push(`${token}：该段暂无标注`);
      for (const row of rows) pushAnnotation(row, token);
      continue;
    }
    if (pick.kind === 'page') {
      if (!shotRefs) {
        errors.push(`${token}：整页引用只在 shot 里可用`);
        continue;
      }
      picks.push({ kind: 'page', via: token });
    }
  }
  return { picks, errors };
}

/** --status 展开：all = 全部；否则该状态的行。 */
export function expandStatus(status, rows) {
  if (status === 'all') return [...rows];
  return rows.filter((a) => (a.status || 'open') === status);
}
