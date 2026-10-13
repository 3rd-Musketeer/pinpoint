/**
 * MDX / md 开头的 `---` frontmatter（docs/projects.md）：只认 `key: value` 一行一条（值可加单 /
 * 双引号）；看不懂的行记一条 error，不猜。仓里没有直接依赖的 YAML 解析器，用到的几个字段
 * （title、summary、name、status、boundary）也用不着。project 读取、文章画布与 ann-query 共用。
 */

const FM_KEY = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s+(.*))?$/;
// 这些开头在 YAML 里是块标量、流式列表 / 映射、锚点、标签：本解析器不支持，报错不猜。
const YAML_ONLY_START = /^[>|[{&*!]/;

function unquote(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') return { value: parsed };
    } catch { /* 落到下面报错 */ }
    return { error: `双引号值没闭合或含非法转义：${value}` };
  }
  if (value.startsWith("'")) {
    if (value.length >= 2 && value.endsWith("'")) return { value: value.slice(1, -1).replace(/''/g, "'") };
    return { error: `单引号值没闭合：${value}` };
  }
  if (!value) return { error: '值为空（不写这个键，或写 ""）' };
  if (YAML_ONLY_START.test(value)) return { error: `只支持单行字符串，不支持以 ${value[0]} 开头的 YAML 写法：${value}` };
  // 不带引号的值：` #` 之后是注释（与 YAML 同规则）。
  const hash = value.search(/\s#/);
  return { value: (hash >= 0 ? value.slice(0, hash) : value).trim() };
}

/**
 * 解析开头的 `---` frontmatter。返回 { data, body, errors }：
 * 没有 frontmatter → data 为空、body 为全文；看不懂的行逐条进 errors。
 */
export function parseFrontmatter(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') return { data: {}, body: source, errors: [] };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { data: {}, body: source, errors: ['frontmatter 没有结束的 ---'] };
  const data = {};
  const errors = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(FM_KEY);
    if (!match) {
      errors.push(`frontmatter 第 ${i + 1} 行只支持 key: value：${line.trim()}`);
      continue;
    }
    const [, key, raw = ''] = match;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`frontmatter 第 ${i + 1} 行重复的键：${key}`);
      continue;
    }
    const parsed = unquote(raw);
    if (parsed.error) {
      errors.push(`frontmatter 第 ${i + 1} 行：${parsed.error}`);
      continue;
    }
    data[key] = parsed.value;
  }
  return { data, body: lines.slice(end + 1).join('\n'), errors };
}
