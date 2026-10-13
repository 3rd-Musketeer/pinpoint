import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArticleCanvas } from './article-canvas.js';

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
  assert.deepEqual(parseArticleCanvas(`${FM}# 只有正文\n\n一段话。\n`), { sections: [], errors: [] });
});
