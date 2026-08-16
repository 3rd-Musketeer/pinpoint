// 板条目派生（2026-08-16f 产物与草稿模型，ROADMAP 阶段 6）：Page = 一件正在
// 做的事（线程容器），自身无类型；一个 Page 一份 board.json，板内容的可选单元
// 叫「条目」（entry）——
//   · 有 app/lock 屏则有一个「画布」条目（id 恒 CANVAS_ENTRY_ID，role product）；
//   · 每个 doc 屏各一个文档条目（id = screenId，role = screen 的 role 字段，
//     product 默认 / draft = 草稿；草稿恒为整页 HTML，与产物无机制耦合）。
// stage 形态由选中条目派生（entryForm），不再由 page.mode 派生；深链 / prefs /
// URL sync 都收到条目级（activeEntryId）。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

/* 画布条目 id 用 '@canvas'：screen id 契约是 /^[a-zA-Z0-9_-]+$/（preview-contracts
   ID_PATTERN），'@' 永不可能与 doc 屏 id 撞车，混合板条目 id 因此天然唯一。 */
export var CANVAS_ENTRY_ID = '@canvas';

function screenShellOf(sc) {
  return typeof sc === 'string' ? 'app' : sc.shell || 'app';
}

/** board（validateBoard 产物）→ 有序条目数组：画布条目居首，文档条目按 board 序。 */
export function boardEntries(board) {
  var entries = [];
  var hasCanvas = false;
  var docEntries = [];
  ((board && board.sections) || []).forEach(function (sec) {
    (sec.screens || []).forEach(function (sc) {
      if (screenShellOf(sc) === 'doc') {
        docEntries.push({
          id: sc.id,
          kind: 'doc',
          role: sc.role === 'draft' ? 'draft' : 'product',
          title: sc.title || sc.id,
          section: sec.title || sec.id,
          sectionId: sec.id
        });
      } else {
        hasCanvas = true;
      }
    });
  });
  if (hasCanvas) {
    entries.push({ id: CANVAS_ENTRY_ID, kind: 'canvas', role: 'product', title: '画布' });
  }
  return entries.concat(docEntries);
}

/** 默认条目 = 画布条目（有画布时），否则第一个文档条目；空板 → null。 */
export function defaultEntryId(entries) {
  return entries && entries.length ? entries[0].id : null;
}

export function entryById(entries, id) {
  if (!entries || id == null) return null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id === id) return entries[i];
  }
  return null;
}

/** 选中解析：非法 / 缺失 id 一律落默认条目（深链与 prefs 的容错点）。 */
export function resolveEntry(entries, id) {
  return entryById(entries, id) || entryById(entries, defaultEntryId(entries));
}

/** 条目 → stage 形态（沿用 data-page-mode 的 ios/html 值域：html = 文档阅读器）。 */
export function entryForm(entry) {
  return entry && entry.kind === 'doc' ? 'html' : 'ios';
}

/** 画布视图：摘掉 doc 屏、丢掉空 section。A1 引用号 / 大纲 / 导出树的图纸语汇
    只覆盖画布 frame（doc 屏从不上画布），四个消费端共用此视图保编号一致。 */
export function canvasBoard(board) {
  var sections = ((board && board.sections) || []).map(function (sec) {
    var screens = (sec.screens || []).filter(function (sc) {
      return screenShellOf(sc) !== 'doc';
    });
    return Object.assign({}, sec, { screens: screens });
  }).filter(function (sec) {
    return sec.id === '_empty' || sec.screens.length > 0;
  });
  return { sections: sections };
}
