/**
 * `pinpoint list`：把“owner 口头说的页”变成页 id（2026-09-23）。
 *
 * owner 会说“把 pinpoint 里 routines 原型改一下”，agent 手上只有页 id。
 * 这里把 registry 条目与本地模板页摊成一张表（id / 标题 / 类型 / 文件夹 /
 * 源路径 / 标注计数），再按关键词在 id、标题、路径、文件夹名上做宽松匹配。
 * 找不到页的报错也用同一个匹配给候选，不再只甩一串 id。
 *
 * 纯函数：数据由调用方读好传进来，便于单测。
 */

const KIND_LABEL = {
  compiled: '编译页',
  doc: '文档页',
  url: '网页',
  file: '单文件',
};

/**
 * @param {object} input
 * @param {Array} input.entries        registry entries
 * @param {Array} input.manifestPages  本地模板页 [{ id, title }]
 * @param {Array} input.folders        [{ id, name }]
 * @param {object} input.pageFolders   { pageId: folderId }（模板页的归属）
 * @param {(entry) => boolean} input.hasBoard  dir 条目有没有 board.json
 * @param {(pageId) => object} input.countsFor 该页桶的 { open, check, done, close }
 */
export function buildPageList({ entries = [], manifestPages = [], folders = [], pageFolders = {}, hasBoard = () => false, countsFor = () => null }) {
  const folderName = new Map(folders.map((f) => [f.id, f.name || f.id]));
  const attachedTo = new Map();
  for (const entry of entries) {
    if (entry && entry.page) {
      if (!attachedTo.has(entry.page)) attachedTo.set(entry.page, []);
      attachedTo.get(entry.page).push(entry.id);
    }
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry || !entry.id || entry.page) continue; // 挂靠条目随宿主页列出
    let kind = 'doc';
    if (entry.kind === 'url') kind = 'url';
    else if (entry.kind === 'file') kind = 'file';
    else if (entry.kind === 'dir' && hasBoard(entry)) kind = 'compiled';
    rows.push({
      id: entry.id,
      title: entry.title || '',
      kind,
      folder: entry.folder ? (folderName.get(entry.folder) || entry.folder) : '',
      path: entry.path || entry.url || '',
      attached: attachedTo.get(entry.id) || [],
      counts: countsFor(entry.id) || null,
      template: false,
    });
  }
  const seen = new Set(rows.map((r) => r.id));
  for (const page of manifestPages) {
    if (!page || !page.id || seen.has(page.id)) continue;
    const folderId = pageFolders[page.id];
    rows.push({
      id: page.id,
      title: page.title || '',
      kind: 'compiled',
      folder: folderId ? (folderName.get(folderId) || folderId) : '',
      path: `content/previews/${page.id}`,
      attached: attachedTo.get(page.id) || [],
      counts: countsFor(page.id) || null,
      template: true,
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

function norm(text) {
  return String(text || '').toLowerCase();
}

/** 一个词的几种写法：原样、去掉英文复数 s / es、连字符与空格互换。 */
function variants(token) {
  const t = norm(token);
  const out = new Set([t, t.replace(/-/g, ' '), t.replace(/\s+/g, '-')]);
  if (/^[a-z]{4,}es$/.test(t)) out.add(t.slice(0, -2));
  if (/^[a-z]{4,}s$/.test(t)) out.add(t.slice(0, -1));
  return [...out].filter(Boolean);
}

/**
 * 一行对一组关键词的得分；任一词完全对不上 = 0（不匹配）。
 * id 命中权重最高，其次标题，再次文件夹与路径——口头说法最常对上的是 id 与标题。
 */
export function scorePage(row, query) {
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const fields = [
    { text: norm(row.id), weight: 4 },
    { text: norm(row.title), weight: 3 },
    { text: norm(row.folder), weight: 2 },
    { text: norm(row.path), weight: 1 },
    { text: norm((row.attached || []).join(' ')), weight: 1 },
  ];
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const v of variants(token)) {
      for (const f of fields) {
        if (!f.text.includes(v)) continue;
        const exact = f.weight === 4 && f.text === v ? 2 : 0;
        best = Math.max(best, f.weight + exact);
      }
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** 按关键词过滤并按得分排序（同分按 id）。无关键词返回全表。 */
export function matchPages(rows, query) {
  const scored = rows
    .map((row) => ({ row, score: scorePage(row, query) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  return scored.map((x) => x.row);
}

/** 找不到页时的候选：先按整串匹配，没有再按拆成的词逐个放宽。 */
export function suggestPages(rows, ref, limit = 5) {
  const direct = matchPages(rows, ref);
  if (direct.length) return direct.slice(0, limit);
  const words = String(ref || '').split(/[\s\-_/.]+/).filter((w) => w.length >= 3);
  // 先只认 id / 标题 / 文件夹上的命中（得分 ≥ 2）：像 prototype、tasks 这种词在
  // 几乎每条源路径里都有，按路径放进来只会把真候选淹掉。都对不上才退到路径。
  const collect = (minScore) => {
    const pool = new Map();
    for (const word of words) {
      for (const row of rows) {
        const score = scorePage(row, word);
        if (score >= minScore) pool.set(row.id, (pool.get(row.id) || 0) + score);
      }
    }
    return pool;
  };
  let pool = collect(2);
  if (!pool.size) pool = collect(1);
  return [...pool.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => rows.find((r) => r.id === id));
}

/** 一行的终端表示：首行 id · 标题 · 类型 · 计数 · 文件夹，次行源路径。 */
export function formatPageRow(row) {
  const bits = [row.id];
  if (row.title) bits.push(row.title);
  bits.push(KIND_LABEL[row.kind] + (row.template ? '（模板）' : ''));
  const c = row.counts;
  if (c && (c.open || c.check || c.done)) bits.push(`open ${c.open} · check ${c.check} · done ${c.done}`);
  if (row.folder) bits.push(`夹 ${row.folder}`);
  const lines = [bits.join('  ·  ')];
  if (row.path) lines.push(`    ${row.path}`);
  if (row.attached && row.attached.length) lines.push(`    挂靠：${row.attached.join('、')}`);
  return lines;
}
