// 静态时序图：谁在等谁。没有 sidecar，编译出来就是一张 SVG；颜色只用调色板变量。
import { textWidth } from 'pinpoint/figure';

function Lane({ x, name, bottom }) {
  const w = textWidth(name, 13) + 28;
  return (
    <g class="ws-lane">
      <line x1={x} y1="40" x2={x} y2={bottom} />
      <rect x={x - w / 2} y="6" width={w} height="28" rx="6" />
      <text x={x} y="25" text-anchor="middle">{name}</text>
    </g>
  );
}

export default function WaitSequence() {
  const lanes = { user: 110, agent: 320, site: 530 };
  const messages = [
    { from: 'user', to: 'agent', y: 72, label: '帮我提交报名表' },
    { from: 'agent', to: 'site', y: 112, label: '填写姓名、手机号' },
    { from: 'site', to: 'agent', y: 152, label: '提交按钮可用', dashed: true },
    { from: 'agent', to: 'user', y: 236, label: '确认卡：要提交这些吗？' },
    { from: 'user', to: 'agent', y: 276, label: '确认' },
    { from: 'agent', to: 'site', y: 316, label: '点提交' },
  ];
  const bottom = 344;
  // fig-scroll：窄屏上横向滚动，字不跟着缩到看不清（最小宽度见下面的 --fig-min-width）。
  return (
    <div class="fig-scroll" style="--fig-min-width:520px">
    <svg class="ws" viewBox="0 0 640 352" role="img" aria-label="提交前谁在等谁：用户、agent、网站的时序">
      <defs>
        <marker id="ws-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--fig-ink-2)" />
        </marker>
      </defs>
      <Lane x={lanes.user} name="用户" bottom={bottom} />
      <Lane x={lanes.agent} name="agent" bottom={bottom} />
      <Lane x={lanes.site} name="网站" bottom={bottom} />
      <rect class="ws-hold" x={lanes.agent - 120} y="172" width="240" height="40" rx="8" />
      <text class="ws-hold-text" x={lanes.agent} y="197" text-anchor="middle">停在提交前，等用户点头</text>
      {messages.map((m) => {
        const x1 = lanes[m.from];
        const x2 = lanes[m.to];
        const d = Math.sign(x2 - x1);
        return (
          <g class="ws-msg">
            <line x1={x1 + d * 3} y1={m.y} x2={x2 - d * 3} y2={m.y} stroke-dasharray={m.dashed ? '5 4' : undefined} marker-end="url(#ws-arrow)" />
            <text x={(x1 + x2) / 2} y={m.y - 8} text-anchor="middle">{m.label}</text>
          </g>
        );
      })}
      <style>{`
        .ws text { font-size:12.5px; }
        .ws-lane line { stroke:var(--fig-hair); stroke-width:1.5; }
        .ws-lane rect { fill:var(--fig-panel); stroke:var(--fig-hair); }
        .ws-lane text { font-size:13px; font-weight:600; }
        .ws-msg line { stroke:var(--fig-ink-2); stroke-width:1.5; }
        .ws-hold { fill:var(--fig-accent-soft); stroke:var(--fig-accent); }
        .ws-hold-text { fill:var(--fig-accent); font-weight:600; }
      `}</style>
    </svg>
    </div>
  );
}
