import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { compilePage } from './page-compiler.js';

// pp2 切片 2：kit 的 10 个系统组件 JSX 印章（content/kits/ios/jsx/）的快照测试。
// 期望串按原 variant HTML 的 DOM 与 class 手写（pp2 切片 2 已 JSX 化到 kits/ios/jsx），
// 序列化差异只有 preact 的形态（void 元素自闭合、布尔属性裸写、style 对象转串）——
// include 时代的 data-ios-slot 已退役，不再输出。

let tmp;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function kitWallPage() {
  const pageDir = path.join(tmp, 'kit-wall');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'column', screens: [{ id: 'wall', title: 'Wall' }] }],
  }));
  fs.writeFileSync(path.join(pageDir, 'wall.jsx'), `import { Button, Segmented, Chip, Badge, Callout, Switch, Search, List, Cell, Nav, Notification, Bubble } from 'pinpoint/kit';

export default function Wall() {
  return (
    <div className="ios-app">
      <Button variant="filled">Filled</Button>
      <Button>Plain</Button>
      <Button variant="filled" destructive>Delete filled</Button>
      <Button variant="filled" disabled>Disabled</Button>
      <Button variant="filled" size="sm">Small</Button>
      <Button variant="filled" size="lg" pill>Pill</Button>
      <Button variant="tinted" block>Block</Button>
      <Segmented on="all" items={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'flagged', label: 'Flagged' }]} />
      <Chip tone="green">Restore</Chip>
      <Chip tone="red">Body</Chip>
      <Badge>128</Badge>
      <Callout title="Heads up">Default / amber tone for gentle warnings.</Callout>
      <Callout tone="blue" title="Tip">Blue callouts for informational guidance.</Callout>
      <Switch checked />
      <Switch />
      <Search />
      <List header="纯文本" footer="Inset grouped list — flat white on gray, no shadow.">
        <Cell title="墙纸" tappable chevron />
        <Cell title="文字大小" value="标准" />
        <Cell title="通用" icon="⚙️" iconBg="var(--ios-gray-1)" value="iOS 27.1" tappable chevron />
      </List>
      <Nav title="Today" eyebrow="THURSDAY, JULY 9" sub="Large title with eyebrow" />
      <Nav title="牟奇" size="compact" back="信息" trail="详情" />
      <Notification icon="💬" iconBg="linear-gradient(180deg,#5ff07a,#22c144)" title="牟奇" time="现在">今天记得 review 一下 morii-mcp 的 MR。</Notification>
      <Bubble side="incoming">试试 1:16，我早上冲花魁甜感清楚多了。</Bubble>
      <Bubble side="outgoing">收到，下一杯就试 1:16，晚点发你记录。</Bubble>
    </div>
  );
}
`);
  return { entryId: 'kit-wall', pageDir, urlBase: '/sites/kit-wall/', kind: 'dir' };
}

let html;

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-kitjsx-'));
  const target = kitWallPage();
  const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
  assert.equal(result.ok, true, JSON.stringify(result.screens));
  const raw = fs.readFileSync(path.join(tmp, 'dist', 'kit-wall', 'wall.html'), 'utf8');
  // 快照比 DOM 结构：编译期锚点（data-pp-id / data-pp-comp）不是组件皮肤的一部分，剥掉再比。
  html = raw.replace(/ data-pp-(id|comp)="[^"]*"/g, '');
  // 锚点本身也要在：kit 组件的 data-pp-id 用仓相对路径（不是 ../../ 链）。
  assert.match(raw, /data-pp-id="content\/kits\/ios\/jsx\/Bubble\.jsx:\d+@\d+"/);
  assert.match(raw, /data-pp-comp="Button"/);
});

function has(fragment) {
  assert.ok(html.includes(fragment), `缺片段：${fragment.slice(0, 120)}`);
}

test('Button：variant / size / destructive / pill / block / disabled（catalog.html 同构）', () => {
  has('<button class="ios-btn filled">Filled</button>');
  has('<button class="ios-btn">Plain</button>');
  has('<button class="ios-btn filled destructive">Delete filled</button>');
  has('<button class="ios-btn filled" disabled>Disabled</button>');
  has('<button class="ios-btn filled sm">Small</button>');
  has('<button class="ios-btn filled lg pill">Pill</button>');
  has('<button class="ios-btn tinted block">Block</button>');
});

test('Segmented：选中项 .on + data-value（catalog.html 同构）', () => {
  has('<div class="ios-segmented"><button class="on" data-value="all">All</button><button data-value="unread">Unread</button><button data-value="flagged">Flagged</button></div>');
});

test('Chip / Badge：tone 变 class（catalog.html 同构）', () => {
  has('<span class="ios-chip green">Restore</span>');
  has('<span class="ios-chip red">Body</span>');
  has('<span class="ios-badge">128</span>');
});

test('Callout：默认无 tone class，blue 附加（catalog.html 同构）', () => {
  has('<div class="ios-callout"><div class="ios-callout-h">Heads up</div><div class="ios-callout-b">Default / amber tone for gentle warnings.</div></div>');
  has('<div class="ios-callout blue"><div class="ios-callout-h">Tip</div><div class="ios-callout-b">Blue callouts for informational guidance.</div></div>');
});

test('Switch：checked 裸属性（catalog.html 同构）', () => {
  has('<span class="ios-switch"><input type="checkbox" checked/><span class="ios-switch-track"></span></span>');
  has('<span class="ios-switch"><input type="checkbox"/><span class="ios-switch-track"></span></span>');
});

test('Search：系统 chrome SVG（catalog.html 同构）', () => {
  has('<div class="ios-search"><svg><use href="#c-search"></use></svg><input placeholder="搜索"/></div>');
});

test('List / Cell：header / footer / 图标行（catalog.html 同构）', () => {
  has('<div class="ios-list-header">纯文本</div>');
  has('<div class="ios-list-footer">Inset grouped list — flat white on gray, no shadow.</div>');
  has('<div class="ios-cell tappable"><span class="ios-cell-body"><div class="ios-cell-title">墙纸</div></span><span class="ios-chev"><svg><use href="#c-chev"></use></svg></span></div>');
  has('<div class="ios-cell"><span class="ios-cell-body"><div class="ios-cell-title">文字大小</div></span><span class="ios-cell-value">标准</span></div>');
  has('<div class="ios-cell has-icon tappable"><span class="ios-icon-tile ios-emo" style="background:var(--ios-gray-1);">⚙️</span><span class="ios-cell-body"><div class="ios-cell-title">通用</div></span><span class="ios-cell-value">iOS 27.1</span><span class="ios-chev"><svg><use href="#c-chev"></use></svg></span></div>');
});

test('Nav：large 大标题与 compact 导航条（nav/large.html、nav/compact.html 同构）', () => {
  has('<div class="ios-nav"><div class="ios-nav-eyebrow">THURSDAY, JULY 9</div><h1>Today</h1><div class="ios-nav-sub">Large title with eyebrow</div></div>');
  has('<div class="ios-navbar"><button class="ios-back ios-nav-lead"><svg><use href="#c-back"></use></svg>信息</button><div class="ios-nav-title">牟奇</div><button class="ios-nav-trail ios-btn" style="color:var(--ios-accent);padding:6px 8px;">详情</button></div>');
});

test('Notification：图标 + 标题行 + 正文（catalog.html 同构）', () => {
  has('<div class="ios-notification"><div class="ios-notif-icon" style="background:linear-gradient(180deg,#5ff07a,#22c144);"><span class="ios-emo">💬</span></div><div class="ios-notif-main"><div class="ios-notif-top"><span class="ios-notif-title">牟奇</span><span class="ios-notif-time">现在</span></div><div class="ios-notif-body">今天记得 review 一下 morii-mcp 的 MR。</div></div></div>');
});

test('Bubble：两侧 class 与 inline style（incoming.html / outgoing.html 同构，data-ios-slot 退役）', () => {
  has('<div class="ios-bubble ios-bubble-in" style="align-self:flex-start;max-width:78%;background:var(--ios-fill-3);color:var(--ios-text);border-radius:18px;border-bottom-left-radius:6px;padding:10px 14px;font-size:var(--ios-t-body);line-height:1.35;letter-spacing:var(--ios-t-body-ls);">试试 1:16，我早上冲花魁甜感清楚多了。</div>');
  has('<div class="ios-bubble ios-bubble-out" style="align-self:flex-end;max-width:78%;background:var(--ios-accent);color:#fff;border-radius:18px;border-bottom-right-radius:6px;padding:10px 14px;font-size:var(--ios-t-body);line-height:1.35;letter-spacing:var(--ios-t-body-ls);">收到，下一杯就试 1:16，晚点发你记录。</div>');
  assert.ok(!html.includes('data-ios-slot'), '不再输出 include 时代的 slot 标记');
});
