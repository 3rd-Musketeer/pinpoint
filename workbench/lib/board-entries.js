// 板条目派生（2026-08-16f 产物与草稿模型，ROADMAP 阶段 6）：Page = 一件正在
// 做的事（线程容器），自身无类型；一个 Page 一份 board.json，板内容的可选单元
// 叫「条目」（entry）——
//   · 有 app/lock 屏则有一个「画布」条目（id 恒 CANVAS_ENTRY_ID，role product）；
//   · 每个 doc 屏各一个文档条目（id = screenId，role = screen 的 role 字段，
//     product 默认 / draft = 草稿；草稿恒为整页 HTML，与产物无机制耦合）。
// stage 形态由选中条目派生（entryForm），不再由 page.mode 派生；深链 / prefs /
// URL sync 都收到条目级（activeEntryId）。
// 2026-08-16f 阶段 7（左栏第二层合一）：条目类型下沉为产物条目的 tag
// （画布 / 文档 / 网页 —— 网页 = registry url 条目，kind 经 manifest page.kind
// 透传，withEntryWeb 打 entry.web 显示标记）；contentsModel 给出侧栏「内容」区的
// 产物/草稿分组与坍缩规则。Page 行不再带任何类型信息。
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

/* ---- 阶段 7：条目类型 tag 与「内容」区坍缩 ------------------------------- */

/** 产物条目的类型 tag key（阶段 7，Page 去类型后类型信息的唯一落点）：
    canvas = 画布，doc = 文档，web = 网页（url 注册条目，见 withEntryWeb）。
    草稿条目不挂 tag（草稿恒为整页 HTML，无类型维度）。 */
export function entryTag(entry) {
  if (!entry) return null;
  if (entry.kind === 'canvas') return 'canvas';
  return entry.web ? 'web' : 'doc';
}

/** tag key → 中文文案（mono 小字；消费端 = 侧栏产物条目行）。 */
export var ENTRY_TAG_LABELS = { canvas: '画布', doc: '文档', web: '网页' };

/** 网页产物标记：registry url 条目的 kind 经 pages.js 透传到 manifest page.kind，
    这里再落到条目 —— url 页的每个 doc 条目都是活网页产物（tag「网页」）。
    只加显示标记（entry.web），行为派生（kind / form / 屏显隐）一律不变。 */
export function withEntryWeb(entries, pageKind) {
  if (pageKind !== 'url' || !entries || !entries.length) return entries;
  return entries.map(function (e) {
    return e.kind === 'doc' && e.role === 'product' ? Object.assign({}, e, { web: true }) : e;
  });
}

/** 侧栏「内容」区模型（阶段 7 坍缩规则，ROADMAP：单条目不显示目录）：
    - 纯画布页（有画布、无任何 doc 条目）：不出条目行（productRows 空），
      frame 树直接挂区头下 —— 即旧大纲体验，无多余「画布」行；
    - 纯单 doc 屏页（无画布无草稿、唯一条目非网页）：整区不出现（hidden）——
      这类页占多数，侧栏立即干净；
    - 单网页条目页仍出行：tag 是 Page 去类型后类型信息的唯一落点，不能坍缩掉；
    - 其余（画布+文档/草稿、多文档、多草稿）：产物组 / 草稿组条目行全出。
    frame 树的存在性由 tree 给出；显示时机（画布条目选中时才展开）归组件侧。 */
export function contentsModel(entries) {
  var list = entries || [];
  var canvas = null;
  var productDocs = [];
  var drafts = [];
  list.forEach(function (e) {
    if (e && e.role === 'draft') { drafts.push(e); return; }
    if (e && e.kind === 'canvas') canvas = e;
    else if (e) productDocs.push(e);
  });
  var pureCanvas = !!canvas && productDocs.length === 0 && drafts.length === 0;
  var singlePlainDoc = !canvas && productDocs.length === 1 && drafts.length === 0 && !productDocs[0].web;
  return {
    hidden: list.length === 0 || singlePlainDoc,
    canvas: canvas,
    productRows: pureCanvas ? [] : (canvas ? [canvas] : []).concat(productDocs),
    drafts: drafts,
    tree: !!canvas
  };
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
