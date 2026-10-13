import assert from 'node:assert/strict';
import test from 'node:test';

import { collapseWhitespace, locateQuote, QUOTE_CONTEXT, quoteFromText } from './text-quote.js';

const TEXT = '付款之前 agent 停下来，用户始终知道钱什么时候会被扣、扣给谁。 确认卡写清收款方。 agent 读到提交按钮时先停下，确认卡写清收款方。';

test('collapseWhitespace：换行、制表、全角空格连成一个半角空格', () => {
  assert.equal(collapseWhitespace('a \n\t b　　c'), 'a b c');
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
  const inserted = '新加的一段导语。 ' + TEXT;
  assert.equal(locateQuote(inserted, q).start, inserted.lastIndexOf('确认卡写清收款方'));
  // 第一处的上下文改了，第二处原样：仍落在第二处。
  const edited = inserted.replace('用户始终知道钱什么时候会被扣、扣给谁。 确认卡写清收款方。', '用户知道扣款时间。 确认卡写清收款方和金额。');
  assert.equal(locateQuote(edited, q).start, edited.lastIndexOf('确认卡写清收款方'));
  // 只剩一处、上下文全变：仍找得到。
  assert.equal(locateQuote('别的话。确认卡写清收款方！', q).start, 4);
  // 引文被改写：定位不到。
  assert.equal(locateQuote(TEXT.replaceAll('确认卡写清收款方', '确认卡写明收款人'), q), null);
  assert.equal(locateQuote(TEXT, { exact: '' }), null);
  assert.equal(locateQuote(TEXT, null), null);
});
