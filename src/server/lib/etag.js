/**
 * If-None-Match 条件请求判定。等值比较、弱比较（W/ 前缀剥掉）、列表与 `*`
 * 都按 RFC 7232 语义放行——与内容本身无关，纯 HTTP 头部规则。
 */
export function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  return String(ifNoneMatch)
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}
