/**
 * Page key used as the annotation document identity before annotationSlug.
 * Pure (no DOM / node deps) so the browser annotate script and the server
 * export path share one formula.
 *
 * Formula: decodeURIComponent(filename) + '~' + hash(pathname).toString(36)
 * where hash is the same 31-xor style as annotate.js historically used.
 * Different directories with the same filename get different keys.
 */
export function pageKeyFromPathname(pathname) {
  const p = String(pathname || '');
  let f;
  try {
    f = decodeURIComponent(p.split('/').pop() || 'index.html');
  } catch {
    f = p.split('/').pop() || 'index.html';
  }
  let h = 0;
  for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0;
  return f + '~' + h.toString(36);
}
