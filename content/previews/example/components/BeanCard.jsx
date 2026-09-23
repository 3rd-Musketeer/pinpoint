// 页内组件 = 印章：输入 props，输出 HTML；没有状态、事件、副作用。
// 三种状态都用 props 表达，board.json 的 bean-card 段把它们排成一面墙。
// props: name · origin · roast "light" | "medium" | "dark" · selected · empty · goto（点它跳到哪一屏）
export function BeanCard({ name, origin, roast = 'light', selected = false, empty = false, goto }) {
  const cls = ['ex-bean', selected && 'selected', empty && 'empty'].filter(Boolean).join(' ');
  return (
    <div class={cls} goto={goto}>
      <span class={`ex-bean-dot ${roast}`}></span>
      <div class="ex-bean-body">
        <div class="ex-bean-name">{name}</div>
        <div class="ex-bean-sub">{empty ? '喝完了' : origin}</div>
      </div>
      {selected ? <span class="ios-chip green">今天用</span> : null}
    </div>
  );
}
