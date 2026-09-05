// 设置视图（P1b cut4，goal-20260810-workbench-react-rebuild）— 原
// workbench/settings.html + pages.js wireSettings 的 React 形态。控件态全部订阅
// store（boot-prefs 的 setter / apply* 在改 .ios-root 与 documentElement 属性的
// 同时写 store）；持久化仍在各动作的调用点（与原 wirePref/wireCtl 一一对应）。
// DOM id / data-* / 文案与原 settings.html 逐一对应，hidden 逻辑不变。
//
// V1 换皮（goal-20260811-workbench-visual-rebuild）：控件收编 shadcn 复制件 +
// Tailwind 类，Linear/Geist 系 dev-tool 配方（本视图是里程碑的审美基准刀，
// V2/V3 照此推广）：
//  - 密度 28px 档：分段项 h-6 + 容器 2px 内衬 = 28px；time input / 返回钮 h-7；
//  - 字阶：正文 13px、辅助（行标签/区块标）12px、标题 13px semibold；字重走阶梯；
//  - 形状：圆角 --wb-r-2（rounded-md）为主，分段项 --wb-r-1（rounded-sm，与内衬同心）；
//  - 分段：容器 --wb-fill 面 + 内衬 2px；on 态白面（--card）+ --wb-sh-1 克制凸起；
//  - hover 浅面走 --wb-hover 档（桥 --accent），focus 沿用全局 accent catch-all；
//  - 过渡 150ms；accent 只出现在字标选中态（真正的强调）。
// 分段配方（SEG/SEG_ITEM/Seg）V2 起归 app/Seg.jsx 共享（侧栏/footer 分段同用）。
//
// 2026-09-04 切片 ②（ADR 0031/0032）：左栏 footer 的 Light/Dark 搬进来，叫
// 「预览主题」—— 它切的是被预览页面的主题，不是界面主题，放在预览设置里名字
// 才说得清；另加「显示模板页」开关（三个 manifest 模板页默认藏起来）。
import { Fragment } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { cn } from './lib/utils.js';
import { Seg } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { applyClock, applyLockFont, setCanvasZoom, setFrame, setStageBg, setTextSize, setTheme } from '../boot-prefs.js';
import { inputFromIosTime, iosTimeFromInput } from '../lib/ios-time.js';
import { savePrefs } from '../lib/prefs.js';
import { showTabs } from '../pages.js';

var ZOOMS = [['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%']];
var FRAMES = [['screen', 'Screen'], ['bezel', 'Bezel']];
var TEXT_SIZES = [['small', '小'], ['default', '标准'], ['large', '大']];
var LOCK_FONTS = [
  ['helvetica', 'Helvetica Neue'],
  ['sf', 'SF Pro Heavy'],
  ['din', 'DIN Alternate'],
  ['futura', 'Futura'],
  ['arial', 'Arial Black'],
  ['condensed', 'Condensed']
];
var CLOCK_MODES = [['system', '系统'], ['fixed', '固定']];
var STAGE_BGS = [['grid', '网格'], ['dots', '圆点纸'], ['plain', '空白']];

// 预览主题分段项：图标常态淡一档（原左栏 footer #wbtheme .wb-ico 的收编）
var THEME_ITEM = 'gap-1 [&_svg]:opacity-75 data-[state=on]:[&_svg]:opacity-100';
var THEMES = [
  ['light', 'sun', 'Light'],
  ['dark', 'moon', 'Dark']
];

// 行布局与行标签（辅助 12px / muted）。标签列 56px：2026-09-04 进来的
// 「预览主题」是四个汉字，40px 那一档装不下，整列跟着放宽一档。
var ROW = 'flex items-center gap-2';
var ROW_LABEL = 'w-14 flex-none text-xs font-medium text-muted-foreground';

export function SettingsView() {
  var zoom = useWorkbenchStore(function (s) { return s.canvasZoom; });
  var frame = useWorkbenchStore(function (s) { return s.frame; });
  var textSize = useWorkbenchStore(function (s) { return s.textSize; });
  var lockFont = useWorkbenchStore(function (s) { return s.lockFont; });
  var clockMode = useWorkbenchStore(function (s) { return s.clockMode; });
  var clockFixed = useWorkbenchStore(function (s) { return s.clockFixed; });
  var stageBg = useWorkbenchStore(function (s) { return s.stageBg; });
  var theme = useWorkbenchStore(function (s) { return s.theme; });
  var showTemplates = useWorkbenchStore(function (s) { return s.showTemplatePages; });

  return (
    <Fragment>
      <header className="relative flex min-h-11 items-center border-b border-[color:color-mix(in_srgb,var(--wb-accent)_16%,transparent)] px-[var(--wb-pad)]">
        <Button type="button" variant="ghost" size="sm" data-wb-back aria-label="返回预览"
          className="-ml-2 gap-1 px-2 text-[13px] font-medium text-muted-foreground"
          onClick={function () { showTabs(); }}>
          <span aria-hidden="true">‹</span> 预览
        </Button>
        <h2 className="pointer-events-none absolute left-1/2 m-0 -translate-x-1/2 whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em]">预览设置</h2>
      </header>

      <div className="flex flex-col gap-3 px-[var(--wb-pad)] pb-4 pt-3">
        <div className={ROW}><span className={ROW_LABEL}>缩放</span>
          <Seg id="zoom" value={zoom} dataAttr="data-canvas-zoom" options={ZOOMS}
            onPick={function (v) { setCanvasZoom(v, { save: true }); }} /></div>
        {/* 预览主题（2026-09-04，原左栏 footer 的 Light/Dark 分段原样搬来）：
            切的是 .ios-root 的 data-theme，不是 workbench chrome 的主题。 */}
        <div className={ROW}><span className={ROW_LABEL}>预览主题</span>
          <Seg id="wbtheme" role="group" aria-label="预览主题"
            value={theme} dataAttr="data-theme"
            options={THEMES.map(function (t) {
              return [t[0], (
                <Fragment>
                  <WbIcon name={t[1]} size={12} className="size-3" />
                  {t[2]}
                </Fragment>
              ), { title: t[2], className: THEME_ITEM }];
            })}
            onPick={function (v) { setTheme(v, { save: true }); }} /></div>
        <div className={ROW}><span className={ROW_LABEL}>画布</span>
          <Seg id="stagebg" value={stageBg} dataAttr="data-stage-bg" options={STAGE_BGS}
            onPick={function (v) { setStageBg(v, { save: true }); }} /></div>
        <div className={ROW}><span className={ROW_LABEL}>Frame</span>
          <Seg id="frame" value={frame} dataAttr="data-frame" options={FRAMES}
            onPick={function (v) { setFrame(v, { save: true }); }} /></div>
        <div className={ROW}><span className={ROW_LABEL}>Text</span>
          <Seg id="textsize" value={textSize} dataAttr="data-text-size" options={TEXT_SIZES}
            onPick={function (v) { setTextSize(v, { save: true }); }} /></div>
        <div>
          <span className="mb-2 block text-xs font-medium text-muted-foreground">字标字体</span>
          <div className="grid grid-cols-2 gap-2" id="lockfont">
            {LOCK_FONTS.map(function (f) {
              var on = lockFont === f[0];
              return (
                <button key={f[0]} type="button" data-lock-font={f[0]}
                  className={cn(
                    'flex cursor-pointer flex-col items-center rounded-md p-2 font-sans text-foreground transition-[background-color] duration-150',
                    on
                      ? 'bg-[color-mix(in_srgb,var(--wb-accent)_8%,transparent)]'
                      : 'hover:bg-accent'
                  )}
                  onClick={function () {
                    applyLockFont(f[0]);
                    savePrefs({ lockFont: f[0] });
                  }}>
                  {/* HELLO 样本保持现状样（产品内容）。字号必须带 !：.wb-lock-font-*
                      是 ios-kit.css 的未分层规则（锁屏时钟字号 46-58px），分层
                      utilities 压不过它（旧 .wb-font-sample 靠未分层源码序赢）。
                      字重/字距不重置 —— 各字体示范样张的笔重本身就是内容。 */}
                  <span className={'wb-lock-font-' + f[0] + ' mb-1 block text-[21px]! leading-[1.1]'}>HELLO</span>
                  <span className="block text-[10px] font-semibold [color:var(--wb-faint)]">{f[1]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className={ROW}><span className={ROW_LABEL}>时间</span>
          <Seg id="clockmode" value={clockMode} dataAttr="data-clock-mode" options={CLOCK_MODES}
            onPick={function (v) {
              applyClock(v, wbGet().clockFixed);
              savePrefs({ clockMode: v, clockFixed: wbGet().clockFixed });
            }} /></div>
        <div className={cn(ROW, clockMode !== 'fixed' && 'hidden')} id="clockfixed-row"
          hidden={clockMode !== 'fixed'}>
          <span className={ROW_LABEL}>固定</span>
          <Input type="time" id="clockfixed" step="60"
            className="h-7 flex-1 bg-card text-[13px] font-medium tabular-nums shadow-none"
            value={inputFromIosTime(clockFixed)}
            onChange={function (e) {
              var fixed = iosTimeFromInput(e.target.value);
              applyClock('fixed', fixed);
              savePrefs({ clockMode: 'fixed', clockFixed: fixed });
            }} />
        </div>
        {/* 模板页开关（ADR 0032）：Component Library / Example Library /
            Example HTML 是模板资产，不是 owner 每天要找的页 —— 默认藏起来。 */}
        <div className={ROW}>
          <span className="flex-1 text-xs font-medium text-muted-foreground">显示模板页</span>
          <Seg id="showtemplates" role="group" aria-label="显示模板页"
            value={showTemplates ? 'on' : 'off'} dataAttr="data-show-templates"
            options={[['off', '隐藏'], ['on', '显示']]}
            onPick={function (v) {
              var on = v === 'on';
              wbSet({ showTemplatePages: on });
              savePrefs({ showTemplatePages: on });
            }} />
        </div>
      </div>
    </Fragment>
  );
}
