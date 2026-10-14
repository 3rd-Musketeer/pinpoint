// 提交前确认的消息流：四个角色、九步。整张时序图在编译时画好（每一步是一个 data-step 组），
// sidecar（message-flow.js）用 pinpoint/figure 的 steps() 加上逐步演示。没有 JS 时就是一张完整的静态图。
import { textWidth } from 'pinpoint/figure';

export default function MessageFlow() {
  const actors = [
    { id: 'U', name: '用户' },
    { id: 'F', name: '前台 agent', accent: true },
    { id: 'B', name: '后台 agent' },
    { id: 'W', name: '浏览器' },
  ];
  const steps = [
    { from: 'U', to: 'F', label: '帮我订酒店', note: '用户只跟前台说话。' },
    { from: 'F', to: 'B', label: '派任务', note: '前台把任务交给后台，自己继续陪用户聊。' },
    { from: 'B', to: 'W', label: '选房、填入住信息', note: '后台在浏览器里一路填下去，不打扰用户。' },
    { from: 'W', to: 'B', label: '到了提交页', dashed: true, note: '提交会花钱，这是用户那 1 步。' },
    { from: 'B', to: 'F', label: '需要确认', dashed: true, note: '后台停下，把要确认的内容交回前台。' },
    { from: 'F', to: 'U', label: '确认卡（房型、总价）', note: '用户在前台看到确认卡。' },
    { from: 'U', to: 'F', label: '批准', note: '批准只发生在前台。' },
    { from: 'F', to: 'B', label: '已批准', note: '前台把批准转给后台。' },
    { from: 'B', to: 'W', label: '提交', note: '后台点提交，任务完成。' },
  ];
  const COL = 150;
  const TOP = 56;
  const ROW = 40;
  const PAD = 16;
  const W = PAD * 2 + COL * actors.length;
  const H = TOP + ROW * steps.length + 12;
  const x = {};
  actors.forEach((actor, i) => { x[actor.id] = PAD + COL / 2 + i * COL; });
  return (
    <div class="fig-scroll mf">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="提交前确认的消息流：用户、前台 agent、后台 agent、浏览器之间的九步">
        <defs>
          <marker id="mf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--fig-ink-2)" />
          </marker>
          <marker id="mf-arrow-now" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--fig-accent)" />
          </marker>
        </defs>
        {actors.map((actor) => {
          const w = textWidth(actor.name, 13) + 32;
          return (
            <g class={actor.accent ? 'mf-actor accent' : 'mf-actor'}>
              <line class="mf-life" x1={x[actor.id]} y1={TOP - 12} x2={x[actor.id]} y2={H - 4} />
              <rect x={x[actor.id] - w / 2} y="8" width={w} height="30" rx="15" />
              <text x={x[actor.id]} y="28" text-anchor="middle">{actor.name}</text>
            </g>
          );
        })}
        {steps.map((step, i) => {
          const y = TOP + ROW * i + 24;
          const x1 = x[step.from];
          const x2 = x[step.to];
          const d = Math.sign(x2 - x1);
          return (
            <g class="mf-msg" data-step={i + 1} data-note={step.note}>
              <line data-travel x1={x1 + d * 3} y1={y} x2={x2 - d * 3} y2={y} stroke-dasharray={step.dashed ? '5 4' : undefined} />
              <text x={(x1 + x2) / 2} y={y - 8} text-anchor="middle">{step.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
