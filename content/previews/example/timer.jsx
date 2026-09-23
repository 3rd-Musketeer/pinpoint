// 交互走 sidecar：同名 timer.js 导出 mount(root)，帧根带 data-preview-mount。
// 帧本身仍是静态快照（这里是“还没开始”），点开始之后的变化由 timer.js 在运行时改。
import { Nav, Button } from 'pinpoint/kit';
import { StepRow } from './components/StepRow.jsx';

export default function Timer() {
  return (
    <div class="ios-app" data-preview-mount>
      <Nav size="compact" title="计时" back="参数" />
      <div class="ex-page" style={{ textAlign: 'center' }}>
        <div class="ios-large" data-time style={{ fontVariantNumeric: 'tabular-nums', margin: '28px 0 4px' }}>0:00</div>
        <div class="ios-muted ios-subhead" data-stage-label>准备好了吗</div>
        <div class="ios-list ios-section" style={{ textAlign: 'left', marginTop: '20px' }}>
          <StepRow id="bloom" title="焖蒸" sub="0:00 – 0:30 · 注水至 30g" />
          <StepRow id="pour1" title="一段注水" sub="0:30 – 1:30 · 注水至 150g" />
          <StepRow id="pour2" title="二段注水" sub="1:30 – 2:30 · 注水至 225g" />
        </div>
        <div data-timer-toggle><Button variant="filled" size="lg" block>开始</Button></div>
      </div>
    </div>
  );
}
