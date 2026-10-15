// pinpoint design token 的唯一源（ADR 0046）。纯数据：scripts/build-tokens.mjs 读它，给四个消费端各写一份产物：
//   src/workbench/wb-tokens.css         工作台（--wb-*，名字不变）
//   src/client/ann-tokens.js            注入端（[data-ann-ui] 钉值字符串；注入到别人页面，只能是字面量）
//   site/src/styles/tokens.css          文章站点（--pp-*）
//   content/kits/figure/figure-palette.css  图 kit（--fig-*）
// 改值只改本文件，然后 npm run build:tokens；每份产物有一条新鲜度单测。
// iOS kit（content/kits/ios/ios-kit.css）是被评审的内容，值跟 iOS HIG 走，不进这里。
//
// 两层：基础色阶（SCALES，只在本文件里被引用）→ 语义 token（SEMANTIC，组件用的是这一层）。
// 色值由来：tasks 2026-10-15 palette probe，owner 2026-10-15 选定（ADR 0046）。
import { gray, grayDark, amber, amberDark } from '@radix-ui/colors';

const steps = (obj) => Object.values(obj);

/** 基础色阶，每档 [亮, 暗]，下标 1..12（档位语义同 Radix：1–2 页面底，3–5 组件底，6–8 边线，9–10 实色，11–12 文字）。 */
export const SCALES = {
  // 中性：Radix gray 12 档（纯灰；owner：“纯灰色吧，看起来更加温暖”）。
  gray: { light: steps(gray), dark: steps(grayDark) },
  // 强调：A 青绿，第 9 档 = #0e8f6c。1–8、12 档沿用 Radix green 的明度曲线、彩度按比例缩放；
  // 亮色第 10 档解到白字 4.6:1、第 11 档解到白底 5.6:1，暗色第 11 档解到 gray-1 上 7:1（probe palette.py green_scale）。
  green: {
    light: ['#fbfefd', '#f4fbf7', '#e6f6ee', '#d6f0e4', '#c4e7d8', '#addcc9', '#8fcdb5', '#5db79a', '#0e8f6c', '#008564', '#007658', '#1a3a32'],
    dark: ['#0e1513', '#121b18', '#142c25', '#123a2f', '#18483a', '#215646', '#296754', '#307b63', '#0e8f6c', '#2b9e7b', '#2eb289', '#b1f0d7'],
  },
  // 评论高亮与警示字：Radix amber。
  amber: { light: steps(amber), dark: steps(amberDark) },
};

const s = (scale, n) => ({ light: SCALES[scale].light[n - 1], dark: SCALES[scale].dark[n - 1] });
const lit = (light, dark = light) => ({ light, dark });

/** 语义 token：名字 → { light, dark, use }。站点输出成 --pp-<名字>。 */
export const SEMANTIC = {
  bg: { ...lit('#ffffff', SCALES.gray.dark[0]), use: '页面底（亮色纯白，暗色 gray-1）' },
  surface: { ...s('gray', 2), use: '浅面：卡片底、代码块、画布卡底、画布纸' },
  'surface-raised': { ...lit('#ffffff', SCALES.gray.dark[2]), use: '浮起的面：评论卡、浮层、弹窗' },
  fill: { ...s('gray', 3), use: '控件底、悬停、分段槽' },
  border: { ...s('gray', 5), use: '发丝线' },
  'border-strong': { ...s('gray', 7), use: '表头线、输入框边、结构缝' },
  scrollbar: { ...s('gray', 8), use: '隐藏式滚动条的浮条（悬停或滚动时出现，docs/design.md“滚动条”）' },
  'scrollbar-hover': { ...s('gray', 9), use: '浮条（指针在条上、拖动中）' },
  text: { ...s('gray', 12), use: '正文' },
  'text-muted': { ...s('gray', 11), use: '次要字、元数据（白底 5.92:1）' },
  'accent-solid': { ...s('green', 9), use: '强调色块：选中描边、开关、图里的强调线' },
  'accent-solid-strong': { ...lit(SCALES.green.light[9], SCALES.green.light[9]), use: '实底压白字：主按钮、钉子、“标注”按钮（white 4.6:1；暗色沿用亮色这一档）' },
  'accent-text': { ...s('green', 11), use: '正文里的强调字：链接、芯片、节号（白底 5.6:1，暗底 7:1）' },
  'accent-soft': { ...s('green', 3), use: '强调浅底：目录当前项、状态胶囊、芯片悬停' },
  selection: { ...s('green', 4), use: '列表选中行、文本选区' },
  'focus-ring': { ...s('green', 9), use: '焦点环' },
  highlight: { ...s('amber', 3), use: '评论高亮' },
  'highlight-on': { ...s('amber', 4), use: '评论高亮（选中）' },
  lasso: { ...lit('#f5a623'), use: '正在圈选（保持现值）' },
  danger: { ...lit('#c0392b', '#ff7b6b'), use: '危险：字（保持现值）' },
  'danger-solid': { ...lit('#c0392b'), use: '危险：色块' },
  warning: { ...s('amber', 11), use: '警示：字' },
  success: { ...s('green', 11), use: '成功：字（同强调字）' },
  info: { ...lit('#4f7096', '#7f9fc4'), use: '说明：字（钢灰蓝）' },
};

/** 标注四态（候选 2）：钉子底色与钉上数字的颜色。 */
export const STATUS = {
  open: { bg: lit('#1f5f8f', '#5b9fd6'), fg: lit('#ffffff', '#202020') },
  check: { bg: lit('#b85a14', '#d9782a'), fg: lit('#ffffff', '#202020') },
  done: { bg: lit('#7a4fd0', '#8a5ae0'), fg: lit('#ffffff', '#ffffff') },
  close: { bg: lit('#8d8d8d', '#8a8a8a'), fg: lit('#ffffff', '#202020') },
};

/** 几何与排印：全站一份。 */
export const FONT = {
  sans: '-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Noto Sans SC",system-ui,sans-serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace',
};

/** 圆角阶梯（owner：“最好都统一吧”）。手机机身 22 是机身形状，不进阶梯。 */
export const RADIUS = {
  1: ['4px', '槽内小按钮、芯片悬停底、行内代码'],
  2: ['6px', '按钮、列表行、分段控件槽'],
  3: ['8px', '工作台卡片、菜单项、卡片里的帧、代码块'],
  4: ['12px', '文章卡片、评论线程、浮层面板、输入框'],
  board: ['16px', '画布画板、文章画布卡、画布浮层'],
  dialog: ['20px', '模态对话框'],
  glass: ['14px', '浮动玻璃面板（阶梯之外，只给这一族）'],
  pill: ['999px', '药丸：标签、计数、底部横条'],
};

/** 字号阶梯：Tailwind 的 12–36，下面补界面小字 11、13。 */
export const FONT_SIZE = { '2xs': '11px', xs: '12px', ui: '13px', sm: '14px', base: '16px', lg: '18px', xl: '20px', '2xl': '24px', '3xl': '30px', '4xl': '36px' };
export const LINE_HEIGHT = { tight: '1.2', snug: '1.35', normal: '1.5', prose: '1.8' };

export const SHADOW = {
  1: lit('0 1px 2px rgba(0,0,0,.06), 0 0 0 0.5px rgba(0,0,0,.04)', '0 1px 2px rgba(0,0,0,.4), 0 0 0 0.5px rgba(255,255,255,.06)'),
  2: lit('0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.1)', '0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.45)'),
  3: lit('0 1px 2px rgba(0,0,0,.06), 0 14px 38px rgba(0,0,0,.16)', '0 1px 2px rgba(0,0,0,.4), 0 14px 38px rgba(0,0,0,.55)'),
  4: lit('0 28px 80px rgba(0,0,0,.24)', '0 28px 80px rgba(0,0,0,.6)'),
  board: lit('0 1px 0 rgba(0,0,0,.04), 0 14px 40px rgba(0,0,0,.08)', '0 1px 0 rgba(0,0,0,.3), 0 14px 40px rgba(0,0,0,.45)'),
};

/** 正文排版层（第 7 套：Tailwind Typography 尺度 + 中文细节）。 */
export const PROSE = {
  size: ['16px', '正文字号'],
  lh: ['1.8', '正文行高（中文比英文松）'],
  measure: ['40em', '文字块行宽（约 40 个汉字）'],
  wide: ['72em', '宽块（表格）外扩的上限；实际不超过正文栏'],
  h1: ['2em', '文章标题 32px'],
  h2: ['1.375em', '节标题 22px'],
  h3: ['1.125em', '小标题 18px'],
  gap: ['1em', '段距'],
};
