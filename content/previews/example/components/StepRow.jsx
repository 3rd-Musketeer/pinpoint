// 计时屏的一行步骤。state 决定右侧标签；sidecar（timer.js）运行时只改 data-* 与文字，不重画结构。
// props: id · title · sub · state "todo" | "now" | "done"
export function StepRow({ id, title, sub, state = 'todo' }) {
  const label = { todo: '待开始', now: '进行中', done: '完成' }[state];
  const tone = { todo: '', now: ' blue', done: ' green' }[state];
  return (
    <div class={`ios-cell ex-step ${state}`} data-stage={id}>
      <span class="ios-cell-body">
        <div class="ios-cell-title">{title}</div>
        <div class="ios-cell-sub">{sub}</div>
      </span>
      <span class={`ios-chip${tone}`} data-stage-chip>{label}</span>
    </div>
  );
}
