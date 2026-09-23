// kit 组件（Nav / List / Cell / Switch / Button）直接拿来拼；goto 写目标屏的 id。
import { Nav, List, Cell, Switch, Button } from 'pinpoint/kit';

export default function Recipe() {
  return (
    <div class="ios-app">
      <Nav size="compact" title="参数" back="选豆" />
      <div class="ex-page">
        <List header="哥伦比亚 慧兰">
          <Cell title="粉量" value="15 g" />
          <Cell title="水量" value="225 g" />
          <Cell title="水温" value="92 °C" />
          <Cell title="研磨" value="中细" chevron tappable />
        </List>
        <List footer="开着的话，每段开始前震一下。">
          <Cell title="分段提醒"><Switch checked /></Cell>
        </List>
        <div goto="timer"><Button variant="filled" size="lg" block>开始计时</Button></div>
      </div>
    </div>
  );
}
