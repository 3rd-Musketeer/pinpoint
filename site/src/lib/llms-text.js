/**
 * llms.txt 的文章正文预处理（site/README.md「路由」：agent 视图给 MDX 原文）：
 * 剥掉 ESM 语句，读起来是文章而不是模块。import 的命名导入列表常分行写，
 * 从行首的 import 在「连续非空行块」内吃到第一个含分号的行——空行是段落边界，
 * 不许越过：越过了，正文里的 ASCII 分号会把后文整段吃进来（r4 review 修复轮）。
 * 块内没有分号就只吃第一行（ASI 风格、行末无分号的 import，MDX 合法）。
 * export 语句单行。代码围栏 ``` / ~~~ 里的行原样保留：示例代码里的 import 是内容，
 * 不是模块声明。
 */
export function stripEsm(body) {
  const lines = String(body || '').split('\n');
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      out.push(line);
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) fence = false;
      continue;
    }
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      fence = true;
      out.push(line);
      continue;
    }
    if (/^export\s/.test(line)) continue;
    if (/^import\b/.test(line)) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1].trim() !== '' && !lines[j].includes(';')) j += 1;
      if (lines[j].includes(';')) i = j; // 含分号的行也一起跳过
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}
