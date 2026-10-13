/**
 * 每个帧片段都自带一条 `<style>@import url(页面.css)</style>`，同一份 CSS 在板上被当成
 * 几十张独立样式表，样式引擎逐张匹配（plugins 57 张 → 切标注模式重算 106ms，去重后 37ms）。
 * 板级装载时把 import-only 的 style 按内容去重、提到最前只留一份；帧片段本身
 * （单帧热更新、/api/frame、导出）不动，仍各带自己的 CSS。ppnt shot 从板上克隆帧 / 节，
 * 克隆里没有被提走的这几条，由 bin/ppnt-shot.js 补回快照。
 */
export function hoistImportOnlyStyles(html) {
  var seen = {};
  var hoisted = '';
  var rest = html.replace(/<style>(\s*@import[^<;]+;\s*)<\/style>/g, function (whole, css) {
    var key = css.trim();
    if (!seen[key]) { seen[key] = 1; hoisted += whole; }
    return '';
  });
  return hoisted + rest;
}
