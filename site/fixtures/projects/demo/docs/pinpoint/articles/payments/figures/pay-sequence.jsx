// 静态时序图：付款前 agent 在哪里停下。没有 sidecar；样式在 pay-sequence.css，只用调色板变量。
import { textWidth } from 'pinpoint/figure';

function Actor({ x, name }) {
  const w = textWidth(name, 13) + 28;
  return (
    <g class="ps-actor">
      <line x1={x} y1="40" x2={x} y2="300" />
      <rect x={x - w / 2} y="6" width={w} height="28" rx="14" />
      <text x={x} y="25" text-anchor="middle">{name}</text>
    </g>
  );
}

function Message({ from, to, y, label, dashed }) {
  const d = Math.sign(to - from);
  return (
    <g class="ps-msg">
      <line x1={from + d * 3} y1={y} x2={to - d * 3} y2={y} stroke-dasharray={dashed ? '5 4' : undefined} marker-end="url(#ps-arrow)" />
      <text x={(from + to) / 2} y={y - 8} text-anchor="middle">{label}</text>
    </g>
  );
}

export default function PaySequence() {
  const user = 100;
  const agent = 320;
  const page = 540;
  return (
    <div class="fig-scroll">
      <svg viewBox="0 0 640 308" role="img" aria-label="付款前的时序：用户、agent、支付页">
        <defs>
          <marker id="ps-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--fig-ink-2)" />
          </marker>
        </defs>
        <Actor x={user} name="用户" />
        <Actor x={agent} name="agent" />
        <Actor x={page} name="支付页" />
        <Message from={user} to={agent} y={74} label="帮我买这张票" />
        <Message from={agent} to={page} y={114} label="选座、填乘客" />
        <Message from={page} to={agent} y={154} label="待支付 ¥ 268" dashed />
        <rect class="ps-stop" x={agent - 26} y="168" width="52" height="36" rx="8" />
        <text class="ps-stop-text" x={agent} y="191" text-anchor="middle">停</text>
        <Message from={agent} to={user} y={236} label="确认卡：付 ¥ 268 给 12306？" />
        <Message from={user} to={agent} y={276} label="付款" />
      </svg>
    </div>
  );
}
