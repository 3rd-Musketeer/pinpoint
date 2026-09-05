// 设置视图（P1b cut4，goal-20260810-workbench-react-rebuild）— 原
// workbench/settings.html + pages.js wireSettings 的 React 形态。控件态全部订阅
// store（boot-prefs 的 setter / apply* 在改 .ios-root 与 documentElement 属性的
// 同时写 store）；持久化仍在各动作的调用点。
//
// V1 换皮（goal-20260811-workbench-visual-rebuild）：控件收编 shadcn 复制件 +
// Tailwind 类；密度 28px 档、圆角 --wb-r-2、分段配方归 app/Seg.jsx 共享。
//
// 2026-09-04 切片 ②（ADR 0031/0032）：左栏 footer 的 Light/Dark 搬进来，叫
// 「预览主题」；另加「显示模板页」开关。
//
// 2026-09-05 精简 + 分段（owner：「这个设置里面的东西说实话我从来没用过」）：
// 删掉缩放（横条已有 − / +）、画布纹理三态（固定网格）、Text 字号三档（固定标准）、
// 字标字体六选一（只服务一个锁屏原型，保留默认值不再暴露）。留下的按「作用在谁
// 身上」分两段：「iOS 预览」改的是被预览的 iOS 内容（.ios-root / iOS kit），
// 网页和文档页上没作用；「界面」改的是 pinpoint 自己。Frame 改叫「机壳」——
// 词典里 frame 是「帧」，同一个词两个意思。
import { Fragment } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { cn } from './lib/utils.js';
import { Seg } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { applyClock, setFrame, setTheme } from '../boot-prefs.js';
import { inputFromIosTime, iosTimeFromInput } from '../lib/ios-time.js';
import { savePrefs } from '../lib/prefs.js';
import { showTabs } from '../pages.js';

// 机壳：值仍叫 screen / bezel（prefs 与 .ios-root 的 screen-only 类没变），只换显示字
var FRAMES = [['screen', '无'], ['bezel', '有']];
var CLOCK_MODES = [['system', '系统'], ['fixed', '固定']];

// 预览主题分段项：图标常态淡一档
var THEME_ITEM = 'gap-1 [&_svg]:opacity-75 data-[state=on]:[&_svg]:opacity-100';
var THEMES = [
  ['light', 'sun', 'Light'],
  ['dark', 'moon', 'Dark']
];

// 行布局与行标签（辅助 12px / muted）。标签列 56px：「预览主题」四个汉字要这一档。
var ROW = 'flex items-center gap-2';
var ROW_LABEL = 'w-14 flex-none text-xs font-medium text-muted-foreground';
// 段头：与左栏「最近」「页面」同一档（11 mono semibold muted），见 index.html .wb-section-head
var SECTION_HEAD = 'wb-section-head mt-1 font-[var(--wb-font-mono)] text-[11px] font-semibold text-muted-foreground';

export function SettingsView() {
  var frame = useWorkbenchStore(function (s) { return s.frame; });
  var clockMode = useWorkbenchStore(function (s) { return s.clockMode; });
  var clockFixed = useWorkbenchStore(function (s) { return s.clockFixed; });
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
        <h2 className="pointer-events-none absolute left-1/2 m-0 -translate-x-1/2 whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em]">设置</h2>
      </header>

      <div className="flex flex-col gap-3 px-[var(--wb-pad)] pb-4 pt-3">
        {/* ── iOS 预览：只作用于 .ios-root 的内容，网页 / 文档页上没作用 ── */}
        <div className={SECTION_HEAD} data-settings-section="ios">iOS 预览</div>
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
        <div className={ROW}><span className={ROW_LABEL}>机壳</span>
          <Seg id="frame" role="group" aria-label="机壳" value={frame} dataAttr="data-frame" options={FRAMES}
            onPick={function (v) { setFrame(v, { save: true }); }} /></div>
        <div className={ROW}><span className={ROW_LABEL}>时间</span>
          <Seg id="clockmode" role="group" aria-label="状态栏时间" value={clockMode} dataAttr="data-clock-mode" options={CLOCK_MODES}
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

        {/* ── 界面：pinpoint 自己 ── */}
        <div className={SECTION_HEAD} data-settings-section="ui">界面</div>
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
