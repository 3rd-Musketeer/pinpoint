import assert from 'node:assert/strict';
import test from 'node:test';

import { articleSectionSpans, parseArticleCanvas, readFrameShell } from './article-canvas.js';

const FM = '---\ntitle: 测试\n---\n\n';

test('只有带 Canvas 的节进画布，按正文顺序；节字母按全部 Section 数，shell 透传', () => {
  const text = `${FM}# 标题\n\n<Section id="why" title="为什么">\n\n正文\n\n</Section>\n\n`
    + '<Section id="flow" title="流程">\n\n<Canvas frames={["a", "b"]} />\n\n</Section>\n\n'
    + '<Section id="wall">\n\n<Canvas frames={["c"]} shell="comp" />\n\n</Section>\n';
  const { sections, errors } = parseArticleCanvas(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(sections, [
    { id: 'flow', title: '流程', articleLetter: 'B', frames: ['a', 'b'] },
    { id: 'wall', title: 'wall', articleLetter: 'C', shell: 'comp', frames: ['c'] },
  ]);
});

test('Canvas 写在列表、引用块里也认（只要在 Section 里）', () => {
  const text = '<Section id="s">\n\n> <Canvas frames={["a"]} />\n\n</Section>\n';
  assert.deepEqual(parseArticleCanvas(text).sections.map((s) => s.frames), [['a']]);
});

test('错误：跨页引用、缺帧文件、一节两个 Canvas、重复节 id，行号对到整份文件', () => {
  const text = `${FM}<Section id="a" title="A">\n\n<Canvas frames={["other-page/ask", "here", "ghost"]} />\n\n`
    + '<Canvas frames={["second"]} />\n\n</Section>\n\n<Section id="a" title="又一个 A">\n\n<Canvas frames={["x"]} />\n\n</Section>\n';
  const { sections, errors } = parseArticleCanvas(text, { frameExists: (id) => id !== 'ghost' });
  // 第 7 行是第一个 Canvas（frontmatter 3 行 + 空行 + Section + 空行）。
  assert.equal(errors.length, 4);
  // 属于某一节的错误带 section，属于某一帧的再带 frame；重复的节 id 不归哪一节（页级）。
  assert.deepEqual(errors.map(({ line, section, frame }) => ({ line, section, frame })), [
    { line: 9, section: 'a', frame: undefined },
    { line: 7, section: 'a', frame: 'other-page/ask' },
    { line: 7, section: 'a', frame: 'ghost' },
    { line: 13, section: undefined, frame: undefined },
  ]);
  assert.match(errors[0].message, /^第 9 行：.*一节最多一个/);
  assert.match(errors[1].message, /^第 7 行：.*别的页的帧 "other-page\/ask".*先把帧迁进本篇目录.*"ask"/);
  assert.match(errors[2].message, /^第 7 行：.*帧 "ghost" 没有源文件（本篇目录下缺 ghost\.jsx）/);
  assert.match(errors[3].message, /^第 13 行：重复的 <Section id="a">/);
  // 缺文件的帧仍进画布（工作台出错误面板）；跨页的、重复节、第二个 Canvas 不进。
  assert.deepEqual(sections, [{ id: 'a', title: 'A', articleLetter: 'A', frames: ['here', 'ghost'] }]);
});

test('错误：frames / shell 不是字面量、shell 取值不对、空数组、帧 id 重复、Canvas 在节外、节套节', () => {
  const cases = [
    ['<Section id="s">\n<Canvas frames={list} />\n</Section>', /frames 必须是字面量数组/],
    ['<Section id="s">\n<Canvas frames={["a", name]} />\n</Section>', /每一项必须是字面量字符串/],
    ['<Section id="s">\n<Canvas frames={["a", ...more]} />\n</Section>', /每一项必须是字面量字符串/],
    ['<Section id="s">\n<Canvas frames="a" />\n</Section>', /frames 必须是字面量数组/],
    ['<Section id="s">\n<Canvas />\n</Section>', /缺 frames/],
    ['<Section id="s">\n<Canvas frames={[]} />\n</Section>', /没有帧/],
    ['<Section id="s">\n<Canvas frames={["a"]} shell={mode} />\n</Section>', /shell 必须是字面量字符串/],
    ['<Section id="s">\n<Canvas frames={["a"]} shell="tablet" />\n</Section>', /shell 只能是 app \/ lock \/ doc \/ comp/],
    ['<Section id="s">\n<Canvas frames={["a b"]} />\n</Section>', /帧 id 不合法/],
    ['<Section id="s">\n<Canvas frames={["a"]} />\n</Section>\n\n<Section id="t">\n<Canvas frames={["a"]} />\n</Section>', /帧 "a" 已经在 <Section id="s">/],
    ['<Canvas frames={["a"]} />', /必须写在 <Section> 里/],
    ['<Section id="s">\n<Section id="t">\n<Canvas frames={["a"]} />\n</Section>\n</Section>', /不能套在另一个 <Section> 里/],
    ['<Section id={x}>\n<Canvas frames={["a"]} />\n</Section>', /需要字面量 id/],
    ['<Section id="s" title={t}>\n<Canvas frames={["a"]} />\n</Section>', /title 必须是字面量字符串/],
  ];
  for (const [text, pattern] of cases) {
    const { errors } = parseArticleCanvas(text);
    assert.ok(errors.some((e) => pattern.test(e.message)), `${text} → ${JSON.stringify(errors)}`);
  }
});

test('MDX 写坏了：一条错误、没有节，不抛', () => {
  const { sections, errors } = parseArticleCanvas(`${FM}<Section id="s">\n\n<Canvas frames={["a"] />\n`);
  assert.deepEqual(sections, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /^MDX 解析失败，画布读不出来：第 \d+ 行：/);
  assert.equal(errors[0].section, undefined);
});

test('没有 Section 的文章：空画布、没有错误', () => {
  assert.deepEqual(parseArticleCanvas(`${FM}# 只有正文\n\n一段话。\n`), { sections: [], figures: [], errors: [] });
});

test('帧级 shell：帧文件的 export const shell 只认顶层字面量字符串，静态读', () => {
  const frame = (decl) => `import { X } from './components/X.jsx';\n\n${decl}\n\nexport default function F() {\n  return <X />;\n}\n`;
  assert.equal(readFrameShell(frame('')), undefined);
  assert.deepEqual(readFrameShell(frame('export const shell = "comp";')), { value: 'comp', line: 3 });
  assert.deepEqual(readFrameShell(frame("export const shell = 'doc' // 整份文档")), { value: 'doc', line: 3 });
  // 值照原样交给 parseArticleCanvas 校验取值；这里只管写法。
  assert.deepEqual(readFrameShell(frame('export const shell = "tablet";')), { value: 'tablet', line: 3 });
  for (const decl of ['export const shell = mode;', 'export const shell = `comp`;', 'export let shell = "comp";', 'export { shell };', 'export const shell = "co" + "mp";']) {
    assert.match(readFrameShell(frame(decl)).error, /字面量字符串/, decl);
  }
  assert.match(readFrameShell(frame('export const shell = "comp";\nexport const shell = "app";')).error, /不止一个/);
  // 函数体里同名的东西不是顶层导出。
  assert.equal(readFrameShell('export default function F() {\n  const shell = "comp";\n  return <div />;\n}\n'), undefined);
});

test('帧级 shell：落在那一帧上，盖过节的 shell；写坏了帧照进画布、错误带节和帧', () => {
  const text = `${FM}<Section id="card" title="确认卡">\n\n<Canvas frames={["sheet", "done", "bare", "odd", "typo"]} />\n\n</Section>\n\n`
    + '<Section id="wall">\n\n<Canvas frames={["w1", "w2"]} shell="comp" />\n\n</Section>\n';
  const own = { bare: { value: 'comp', line: 3 }, w2: { value: 'app', line: 1 }, odd: { value: 'tablet', line: 2 }, typo: { error: 'shell 必须写成一行 export const shell = "…"（字面量字符串）', line: 4 } };
  const { sections, errors } = parseArticleCanvas(text, { frameShell: (id) => own[id] });
  assert.deepEqual(sections, [
    { id: 'card', title: '确认卡', articleLetter: 'A', frameShells: { bare: 'comp' }, frames: ['sheet', 'done', 'bare', 'odd', 'typo'] },
    { id: 'wall', title: 'wall', articleLetter: 'B', shell: 'comp', frameShells: { w2: 'app' }, frames: ['w1', 'w2'] },
  ]);
  assert.deepEqual(errors.map(({ line, section, frame }) => ({ line, section, frame })), [
    { line: 7, section: 'card', frame: 'odd' },
    { line: 7, section: 'card', frame: 'typo' },
  ]);
  assert.match(errors[0].message, /^第 7 行：<Section id="card"> 的 <Canvas> 帧 "odd" 的 shell 只能是 app \/ lock \/ doc \/ comp："tablet"（odd\.jsx 第 2 行）$/);
  assert.match(errors[1].message, /帧 "typo" 的 shell 必须写成一行 export const shell = "…"（字面量字符串）（typo\.jsx 第 4 行）$/);
  // 缺源文件的帧不去读 shell。
  const missing = parseArticleCanvas(text, { frameExists: (id) => id !== 'bare', frameShell: (id) => { assert.notEqual(id, 'bare'); return own[id]; } });
  assert.equal(missing.sections[0].frameShells, undefined);
});

test('articleSectionSpans：每节占的行对到整份文件（含 frontmatter）；表达式 id 不算；MDX 写坏是 []', () => {
  const text = ['---', 'title: T', '---', '', '<Section id="why">', '', 'a', '', '</Section>', '', '<Section id={x}>b</Section>', '', '<Section id="how">', 'c', '</Section>', ''].join('\n');
  assert.deepEqual(articleSectionSpans(text), [
    { id: 'why', startLine: 5, endLine: 9 },
    { id: 'how', startLine: 13, endLine: 15 },
  ]);
  assert.deepEqual(articleSectionSpans('<Section id="s">\n\n<Canvas frames={["a"] />\n'), []);
});

test('<Figure>：节里节外都认，按正文顺序编号；id 取 figures/<id>.jsx，带节与行，不进画布', () => {
  const text = `${FM}<Figure src="figures/intro.jsx" caption="开头的图" />\n\n`
    + '<Section id="flow" title="流程">\n\n正文\n\n<Figure src="figures/flow.jsx" />\n\n<Canvas frames={["a"]} />\n\n</Section>\n\n'
    + '<Section id="tail">\n\n> <Figure src="figures/quoted.jsx" caption="引用块里" />\n\n</Section>\n';
  const { sections, figures, errors } = parseArticleCanvas(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(figures, [
    { index: 0, line: 5, id: 'intro', caption: '开头的图' },
    { index: 1, line: 11, section: 'flow', id: 'flow' },
    { index: 2, line: 19, section: 'tail', id: 'quoted', caption: '引用块里' },
  ]);
  // 图不是帧：画布只有 Canvas 列的帧。
  assert.deepEqual(sections.map((s) => s.frames), [['a']]);
});

test('<Figure> 的写法错误：code 以 figure_ 开头，带行、节、认得出的图 id；写坏的图照样占一个序号', () => {
  const lines = [
    '<Section id="s" title="S">',
    '',
    '<Figure caption="没有 src" />',
    '',
    '<Figure src={name} />',
    '',
    '<Figure src="flow.jsx" />',
    '',
    '<Figure src="figures/a.jsx" caption={title} />',
    '',
    '<Figure src="figures/b.jsx" height="300" />',
    '',
    '<Figure {...props} src="figures/c.jsx" />',
    '',
    '<Figure src="figures/b.jsx" />',
    '',
    '<Figure src="figures/ghost.jsx" />',
    '',
    '</Section>',
    '',
  ];
  const { figures, errors } = parseArticleCanvas(`${FM}${lines.join('\n')}`, { figureExists: (id) => id !== 'ghost' });
  const at = (n) => n + 4; // frontmatter 3 行 + 空行
  assert.deepEqual(errors.map((e) => [e.code, e.line, e.section, e.figure]), [
    ['figure_src', at(3), 's', undefined],
    ['figure_src', at(5), 's', undefined],
    ['figure_src', at(7), 's', undefined],
    ['figure_caption', at(9), 's', undefined],
    ['figure_prop', at(11), 's', undefined],
    ['figure_prop', at(13), 's', undefined],
    ['figure_duplicate', at(15), 's', 'b'],
    ['figure_missing', at(17), 's', 'ghost'],
  ]);
  for (const e of errors) assert.match(e.message, new RegExp(`^第 ${e.line} 行：<Figure>`));
  assert.match(errors[0].message, /缺 src（写成 src="figures\/<图 id>\.jsx"）/);
  assert.match(errors[1].message, /src 必须是字面量字符串/);
  assert.match(errors[2].message, /src 只能写成 "figures\/<图 id>\.jsx".*"flow\.jsx"/);
  assert.match(errors[4].message, /不认识属性 height（只有 src 和 caption）/);
  assert.match(errors[5].message, /不能用展开属性/);
  assert.match(errors[6].message, /图 "b" 在第 \d+ 行已经用过/);
  assert.match(errors[7].message, /缺 figures\/ghost\.jsx/);
  // 每个 <Figure> 一项（站点按序号对上）；认得出的才有 id，重复的那个没有。
  assert.deepEqual(figures.map((f) => [f.index, f.id || null]), [[0, null], [1, null], [2, null], [3, 'a'], [4, 'b'], [5, 'c'], [6, null], [7, 'ghost']]);
});
