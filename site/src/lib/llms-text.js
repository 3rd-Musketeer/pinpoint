/**
 * llms.txt 的文章正文预处理（site/README.md「路由」：agent 视图给 MDX 原文）：
 * 剥掉 ESM 语句，读起来是文章而不是模块。import 的命名导入列表常分行写，
 * 从行首的 import 吃到第一个含分号的行为止；一段里没有分号就只吃第一行
 * （单行正则会跨段落吃到后面随便哪个分号，把正文整段吃掉）。export 语句单行。
 */
export function stripEsm(body) {
  const lines = String(body || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^export\s/.test(line)) continue;
    if (/^import\b/.test(line)) {
      let j = i;
      while (j < lines.length && !lines[j].includes(';')) j += 1;
      if (j < lines.length) i = j; // 含分号的行也一起跳过
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}
