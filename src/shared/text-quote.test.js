import assert from 'node:assert/strict';
import test from 'node:test';

import { locateQuote, normalizeQuote, normalizeWhitespace, QUOTE_CONTEXT, quoteFromText } from './text-quote.js';

const TEXT = normalizeWhitespace('付款之前 agent 停下来，用户始终知道钱什么时候会被扣、扣给谁。\n确认卡写清收款方。\nagent 读到提交按钮时先停下，确认卡写清收款方。').text;

test('normalizeWhitespace：两个 CJK 字之间的空白算没有；其余空白连成一个半角空格；首尾不留', () => {
  assert.equal(normalizeWhitespace('a \n\t b　　c').text, 'a b c');
  assert.equal(normalizeWhitespace('点付款\n之后先').text, '点付款之后先');
  assert.equal(normalizeWhitespace('扣给谁。\n  确认卡').text, '扣给谁。确认卡', '全角标点也算 CJK');
  assert.equal(normalizeWhitespace('用 agent\n读到 提交按钮').text, '用 agent 读到提交按钮', '中英交界留一个空格');
  assert.equal(normalizeWhitespace('ひらがな\nカタカナ').text, 'ひらがなカタカナ');
  assert.equal(normalizeWhitespace('한국어 문장').text, '한국어 문장', '韩文按词断开，空格要留');
  assert.equal(normalizeWhitespace('𠀀 字').text, '𠀀字', '扩展区汉字（代理对）');
  assert.equal(normalizeWhitespace('  前后 \n').text, '前后');
  // map[k] = 原文第 k 个字符在规范化文本里的位置；空白落在它前面那个字之后。
  const { text, map } = normalizeWhitespace('a  b\n中');
  assert.equal(text, 'a b 中');
  assert.deepEqual(map, [0, 1, 1, 2, 3, 4, 5]);
});

test('quoteFromText：剥首尾空白，前后文各取 QUOTE_CONTEXT 个字符，越界截到文本边', () => {
  const at = TEXT.indexOf('扣给谁');
  const q = quoteFromText(TEXT, at - 1, at + 3 + 1);
  assert.equal(q.exact, '、扣给谁。');
  const exact = quoteFromText(TEXT, at, at + 3);
  assert.equal(exact.exact, '扣给谁');
  assert.equal(exact.prefix, TEXT.slice(Math.max(0, at - QUOTE_CONTEXT), at));
  assert.equal(exact.suffix, TEXT.slice(at + 3, at + 3 + QUOTE_CONTEXT));
  assert.equal(quoteFromText(TEXT, 0, 2).prefix, '');
  assert.equal(quoteFromText('a   b', 1, 4), null, '只选到空白');
  const trimmed = quoteFromText(' ab ', 0, 4);
  assert.deepEqual([trimmed.exact, trimmed.start, trimmed.end], ['ab', 1, 3]);
});

test('locateQuote：重复出现时按前后文挑；前后文一样时 section 提示分胜负', () => {
  const second = TEXT.lastIndexOf('确认卡写清收款方');
  const q = quoteFromText(TEXT, second, second + 8);
  assert.equal(locateQuote(TEXT, q).start, second);
  const first = TEXT.indexOf('确认卡写清收款方');
  assert.equal(locateQuote(TEXT, quoteFromText(TEXT, first, first + 8)).start, first);

  const twice = '甲。同一句话。乙。同一句话。';
  const bare = { exact: '同一句话', prefix: '', suffix: '' };
  const sectionAt = (offset) => (offset < 7 ? 'a' : 'b');
  assert.equal(locateQuote(twice, bare).start, 2, '没有提示：取第一处');
  assert.equal(locateQuote(twice, bare, { section: 'b', sectionAt }).start, 9);
});

test('locateQuote：正文改了（前面插段、句子挪节、上下文变）照样重新定位；引文本身没了 = null', () => {
  const at = TEXT.lastIndexOf('确认卡写清收款方');
  const q = quoteFromText(TEXT, at, at + 8);
  const inserted = '新加的一段导语。' + TEXT;
  assert.equal(locateQuote(inserted, q).start, inserted.lastIndexOf('确认卡写清收款方'));
  // 第一处的上下文改了，第二处原样：仍落在第二处。
  const edited = inserted.replace('用户始终知道钱什么时候会被扣、扣给谁。确认卡写清收款方。', '用户知道扣款时间。确认卡写清收款方和金额。');
  assert.equal(locateQuote(edited, q).start, edited.lastIndexOf('确认卡写清收款方'));
  // 只剩一处、上下文全变：仍找得到。
  assert.equal(locateQuote('别的话。确认卡写清收款方！', q).start, 4);
  // 引文被改写：定位不到。
  assert.equal(locateQuote(TEXT.replaceAll('确认卡写清收款方', '确认卡写明收款人'), q), null);
  assert.equal(locateQuote(TEXT, { exact: '' }), null);
  assert.equal(locateQuote(TEXT, null), null);
});

// 中文段落里的软换行：源文件折行变了（拆成两行 / 合成一行），渲染后的 DOM 文本里多一个或少一个换行。
const WRAPPED = '付款之前 agent 停下来，用户始终知道钱什么时候\n会被扣、扣给谁。\n\n确认卡写清收款方。';
const JOINED = WRAPPED.replace('什么时候\n会被扣', '什么时候会被扣');

test('折行变了：跨软换行选的引文在合成一行后仍定位，反过来也一样', () => {
  const wrapped = normalizeWhitespace(WRAPPED).text;
  const joined = normalizeWhitespace(JOINED).text;
  assert.equal(wrapped, joined);
  const at = wrapped.indexOf('什么时候会被扣');
  const q = quoteFromText(wrapped, at, at + 7);
  assert.equal(q.exact, '什么时候会被扣');
  assert.equal(locateQuote(joined, q).start, joined.indexOf('什么时候会被扣'));
  const onJoined = quoteFromText(joined, at, at + 7);
  assert.equal(locateQuote(wrapped, onJoined).start, at);
});

test('旧格式的引文（换行存成了空格）照样重新定位：两边按同一条规则规范化', () => {
  const text = normalizeWhitespace(JOINED).text;
  // 旧客户端：空白一律连成一个空格，存下的 exact / prefix / suffix 里 CJK 字之间夹着空格。
  const old = { exact: '什么时候 会被扣', prefix: '停下来，用户始终知道钱', suffix: '、扣给谁。 确认卡写清收款方。' };
  const hit = locateQuote(text, old);
  assert.equal(hit.start, text.indexOf('什么时候会被扣'));
  assert.equal(hit.end - hit.start, '什么时候会被扣'.length);
  assert.deepEqual(normalizeQuote(old), { exact: '什么时候会被扣', prefix: '停下来，用户始终知道钱', suffix: '、扣给谁。确认卡写清收款方。' });
  // 中英混排的空格是真空格，规范化后还在。
  assert.deepEqual(normalizeQuote({ exact: '用 agent\n读到', prefix: 'see ', suffix: '\n提交' }), { exact: '用 agent 读到', prefix: 'see ', suffix: '提交' });
  assert.equal(locateQuote(normalizeWhitespace('先用 agent 读到提交').text, { exact: '用 agent 读到' }).start, 1);
});

test('重复引文、前后文也一样（表格里的重复行）：按存下的 start 提示取最近的一处', () => {
  const rows = '| 收款方 | 已确认 |\n| 金额 | 已确认 |\n| 时间 | 已确认 |';
  const text = normalizeWhitespace(rows.replace(/[|]/g, ' ')).text;
  const third = text.lastIndexOf('已确认');
  const q = quoteFromText(text, third, third + 3, 2);
  assert.ok(q.start === third && q.prefix === text.slice(third - 2, third));
  // 三处的 2 字前后文各不同时按前后文挑；这里把前后文去掉，模拟上下文完全相同。
  const bare = { exact: '已确认', prefix: '', suffix: '' };
  assert.equal(locateQuote(text, bare).start, text.indexOf('已确认'), '没有提示：第一处');
  assert.equal(locateQuote(text, { ...bare, start: third }).start, third);
  const middle = text.indexOf('已确认', text.indexOf('已确认') + 1);
  assert.equal(locateQuote(text, { ...bare, start: middle + 2 }).start, middle, '正文前面插了字：取离提示最近的');
  // 提示只在同分时用：前后文更吻合的一处照样赢。
  const scored = { exact: '已确认', prefix: '金额 ', suffix: '', start: third };
  assert.equal(locateQuote(text, scored).start, middle);
});
