---
name: pinpoint-build
description: 在 pinpoint 里搭原型页：写 .jsx 帧、页内组件、kit 组件，改 board.json，做屏内交互。只要任务涉及新增或修改某个页的帧 / 组件 / board.json，或用户说“加一屏”“加个对比”“搭个 variants 墙”“做个交互”“写 board”，先读本 skill 再动手——帧与组件的写法、源码与 dist 的关系有几条硬约束（overlay 同级、safe area 接 token、组件是印章），跳过容易白干。
---

# pinpoint-build

在登记进 pinpoint 的页目录里**搭原型页**。总入口见 [`AGENTS.md`](../../AGENTS.md)；标注评审走
[`pinpoint-annotate`](../pinpoint-annotate/SKILL.md)。机制的唯一权威是
[`docs/board-schema.md`](../../docs/board-schema.md)，本文只讲做法；范例页见 `e2e/jsx-site/`
（帧 + 页内组件 + comp 墙 + kit 引用）。

一个页 = 一个目录：`board.json` + 每帧一个 `<screenId>.jsx` + `components/<Name>.jsx`（页内组件）+
页级 css / js（登记在 board.json `assets`）。

## 0. 编译与看图

```bash
ppnt list [关键词]        # 页清单：owner 用口头说法指页时先用它对上页 id 和源目录
ppnt list <页> --frames   # 画布帧对照：编号（D1）· 帧 id · 源文件 · 标题
ppnt status               # 服务在不在、root 对不对；站点打不开先查它
ppnt build <页>           # 源码 → dist（~/.pinpoint/dist/<entry>/）；画布、标注、导出只认 dist
ppnt build <页> --watch   # 改源码自动重编；sidecar .js 变更触发整页刷新
ppnt render <页>/<屏>     # 编译一帧打到 stdout，不开浏览器看产物 HTML
ppnt shot <帧…> [--marks] # 截 PNG（切片 4 契约）；--marks 把标注序号钉烤进图
```

dist 是产物：不手改、不提交，重编即得。

## 1. 写一帧：`<screenId>.jsx`

默认导出一个返回 JSX 的函数；顶层只允许 `import`、`function` 声明、`export default`：

```jsx
import { List, Cell, Switch } from 'pinpoint/kit';

function Row({ title }) {
  return <Cell title={title} chevron />;
}

export default function Settings() {
  return (
    <div class="ios-app">
      <div class="ios-page">
        <List header="通用">
          <Row title="通知" />
          <Cell title="隔空投送"><Switch checked /></Cell>
        </List>
      </div>
    </div>
  );
}
```

- 帧输出 body 片段；机壳（bezel / 状态栏 / home 条）归 loader，不要写。
- 正文在 `.ios-app` / `.ios-lockscreen`；**sheet / tabbar / backdrop 与 `.ios-app` 同级**，不进滚动层。
- 自定义顶栏 / 底栏的 inset 用 `--ios-safe-top` / `--ios-safe-bottom`，不写死 px、不拿占位 div 顶。
  这两条的机制与错挂症状见 board-schema“iOS 帧的硬约束”。
- 样式类从 kit 拿（`.ios-*`，token 在 `ios-kit.css`）；组件 css 页级一份（`assets`），不要每帧抄。
- 帧内小组件用 `function` 声明写在同文件；两个以上帧要用就搬进 `components/`。
- 存量 `.html` 帧继续认，原样编译、写法不变。

**lint 四禁**（`ppnt build` 直接失败，报文件与行）：帧与组件里 `import preact/hooks`、`onX` 事件
属性、`fetch(`，帧文件顶层的其它语句。组件是印章：输入 props 和 children 输出 HTML，没有状态、
事件、副作用；状态即帧（一个状态一帧），交互走 §3。

## 2. 组件：`components/<Name>.jsx` 与 `pinpoint/kit`

页内组件放 `components/<Name>.jsx`，命名导出一个印章函数，帧文件显式 import：

```jsx
import { Composer } from './components/Composer.jsx';
```

- variant 用 props 表达（`<Composer state="pill">`），不要一 variant 一文件。
- 同名时页内组件覆盖 kit；跨页复用 = 手动把文件搬进 kit（`content/kits/ios/jsx/`）再走
  `pinpoint/kit`，没有自动提升。
- kit 组件清单（props 以 `content/kits/ios/jsx/` 各文件首行注释为准）：

| 组件 | props |
|---|---|
| `Button` | variant `filled\|tinted\|gray\|plain` · size `sm\|md\|lg` · destructive · pill · block · disabled · children |
| `Nav` | title · size `large\|compact` · back · trail · eyebrow · sub |
| `List` / `Cell` | header · footer · children ／ title · value · icon · tappable · chevron |
| `Segmented` | items `[{value,label}]`（字符串 = 同值）· on |
| `Switch` / `Search` | checked ／ placeholder |
| `Chip` / `Badge` / `Callout` | tone 五色 ／ children（计数）／ tone · title · children |
| `Notification` / `Bubble` | icon · iconBg · title · time · children ／ side `incoming\|outgoing` · children |

## 3. 交互：内联脚本或 sidecar

workbench 用 `innerHTML` 挂帧，裸 `<script>` 不执行，两种形态都由 loader 接管：

- **A · 短逻辑**：帧里内联 `<script data-preview-script>{`…`}</script>`，`root` = 本屏 `.ios-app`。
- **B · sidecar（逻辑长首选）**：同名 `<screenId>.js` 导出 `mount(root)`，帧根标 `data-preview-mount`；
  `mount` 可返回 `unmount`，换板 / HMR 会调它——有定时器、全局监听必须返回。

`root` 约定、`data-preview-root` 覆盖、sidecar 资源报错行为见 board-schema“交互 frame”。
产品手势不进 `ios-kit.js`：kit 只承载通用原语，放进去所有页互相污染。

## 4. board.json：登记帧、variants 墙与页内 tab

帧在 `sections[].screens` 追加 id 或对象；variants 墙 = `shell: "comp"` 的 section，screen 条目
内联组件与 props，不建帧文件：

```json
{
  "sections": [
    { "id": "composer", "title": "输入框", "layout": "row", "shell": "comp",
      "screens": [{ "id": "pill", "title": "pill", "comp": "Composer", "props": { "state": "pill" } }] }
  ]
}
```

- `shell` 四种：`app`（默认）/ `lock`（section 或 screen 上）/ `doc`（整份 HTML 文档）/ `comp`。
- `assets: { "css": […], "js": […] }` 登记页级资源，编译器注入每帧。
- title = 单行短名词短语，不手写编号、不塞图例（规矩全文在 board-schema）。
- 帧 id 用描述内容的短词（`detail-noop-run`），不写成编号的样子（`c1b-detail`）。画布编号按 board
  顺序派生、调序就变；id 不变，还是源文件名和标注锚点，已有的帧不要改名。
- **同一个关键帧要画几种做法 = 组件页的一个 section**，不是在交互页里多开几个帧，更不要自造编号
  （K11、B3 之类）。分两种页，底层一样（section 里放普通帧），区别在用途：
  - **组件页**：每个 section 服务一个组件，里面是同一个 UI 上下文（同一个手机界面）下它的几个变体，
    一个变体一个普通帧，`title` 写变体的内容（“收起：一行胶囊”）。用来在界面里感受效果、并排比较。
    放在页里的“组件”tab（见下“页内 tab”）。
  - **交互页**：正式流程，每个关键帧只放定下来的那一个，放在同一个页里的“交互”tab。
  评审选定变体后，把它 **复制** 成交互 tab 里自己的帧（新 id、新文件），之后两边各改各的；不做活引用。
  说明表、总览这类“画板上的非手机内容”不是变体，放 `doc` / `comp` 屏。
- **页内 tab**（ADR 0041）：一个页里要分几块（组件 / 交互 / 试验场）就用 `tabs`，不要拆成几个页。
  tab 只是 section 的视图分组：共用 `components/`、资源和标注，section id 与帧 id 在整页内唯一，编号按 tab 各自
  从 A 重来。`tabs` 与顶层 `sections` 二选一，每个 tab 至少一个 section；一个 tab 的页等于没有 tab。
  ```json
  { "tabs": [
      { "id": "comps", "title": "组件", "sections": [
          { "id": "composer-states", "title": "输入框", "layout": "row", "screens": [{ "id": "composer-pill" }, { "id": "composer-open" }] } ] },
      { "id": "flow", "title": "交互", "sections": [
          { "id": "ask", "title": "提问", "layout": "row", "screens": [{ "id": "ask-start" }] } ] }
  ] }
  ```
  多 tab 页上，对 `ppnt check / shot / locate` 和 owner 说话时位置引用写 `flow:A1`（裸 `A1` 在多个 tab 里都有就报错
  并列候选）；帧 id 和 section id 仍是裸的。
- 元素可写 `goto="<screenId>"` 指向另一帧，编译进产物属性（flow 边的数据层）。

## 5. 改完自检

1. `ppnt build <页>` 全绿；lint / 编译错误指到文件与行，修到全绿再继续。
2. `ppnt shot <帧>` 看图对照改前改后；改了 `components/` 或 `assets` 就把引用它的帧都 shot 一遍。
3. 汇报改了哪些帧、保留什么、没解决什么。评审与关闭标注是 owner 的事。

## 6. 反例

- 把 sheet / tabbar / backdrop 塞进 `.ios-app`；手写 safe-area 像素。
- 给图注设 font-size；title 里手写编号（K11、B3）或塞图例；在交互页里为同一关键帧的多种做法各开一帧再自造编号（该建组件页 section，见 §4）（caption 与 title 规矩在 board-schema）。
- 帧 id 仿编号（`a4b-ask2`、`c1c-run`）；为了和编号对齐去改已有帧的 id。
- 为“以后可能复用”抽组件；把状态、事件、fetch 写进组件。
- 把产品手势写进 `ios-kit.js`；改 loader 机壳或 `ios-kit.css` 去对齐一条标注。
- 手改 `~/.pinpoint/dist/`；往 tracked 文件夹带实例内容（实例页住你自己的目录，经
  `pinpoint add` 登记，见 board-schema“模板与实例”）。
