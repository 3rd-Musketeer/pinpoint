// Search — props: placeholder（默认 "搜索"）
// DOM/class 以 components/search/catalog.html 为准（.ios-search > svg#c-search + input；去掉了 catalog 的摆放 margin）。
export function Search({ placeholder = '搜索' }) {
  return (
    <div class="ios-search">
      <svg><use href="#c-search" /></svg>
      <input placeholder={placeholder} />
    </div>
  );
}
