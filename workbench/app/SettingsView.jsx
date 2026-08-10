// 设置视图（P1b cut4，goal-20260810-workbench-react-rebuild）— 原
// workbench/settings.html + pages.js wireSettings 的 React 形态。控件态全部订阅
// store（boot-prefs 的 setter / apply* 在改 .ios-root 与 documentElement 属性的
// 同时写 store）；持久化仍在各动作的调用点（与原 wirePref/wireCtl 一一对应）。
// DOM id / class / 文案与原 settings.html 逐一对应。
import { Fragment } from 'react';
import { useWorkbenchStore, wbGet } from './store.js';
import { applyClock, applyLockFont, setCanvasZoom, setFrame, setTextSize } from '../boot-prefs.js';
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

export function SettingsView() {
  var zoom = useWorkbenchStore(function (s) { return s.canvasZoom; });
  var frame = useWorkbenchStore(function (s) { return s.frame; });
  var textSize = useWorkbenchStore(function (s) { return s.textSize; });
  var lockFont = useWorkbenchStore(function (s) { return s.lockFont; });
  var clockMode = useWorkbenchStore(function (s) { return s.clockMode; });
  var clockFixed = useWorkbenchStore(function (s) { return s.clockFixed; });

  return (
    <Fragment>
      <header className="wb-settings-head">
        <button type="button" className="wb-back" data-wb-back aria-label="返回预览"
          onClick={function () { showTabs(); }}>
          <span aria-hidden="true">‹</span> 预览
        </button>
        <h2 className="wb-settings-title">预览设置</h2>
      </header>

      <div className="wb-ctrls">
        <div className="ctl-row"><span>缩放</span><div className="ctl" id="zoom">
          {ZOOMS.map(function (z) {
            return (
              <button key={z[0]} type="button" className={zoom === z[0] ? 'on' : ''}
                data-canvas-zoom={z[0]}
                onClick={function () { setCanvasZoom(z[0], { save: true }); }}>
                {z[1]}
              </button>
            );
          })}
        </div></div>
        <div className="ctl-row"><span>Frame</span><div className="ctl" id="frame">
          {FRAMES.map(function (f) {
            return (
              <button key={f[0]} type="button" className={frame === f[0] ? 'on' : ''}
                data-frame={f[0]}
                onClick={function () { setFrame(f[0], { save: true }); }}>
                {f[1]}
              </button>
            );
          })}
        </div></div>
        <div className="ctl-row"><span>Text</span><div className="ctl" id="textsize">
          {TEXT_SIZES.map(function (t) {
            return (
              <button key={t[0]} type="button" className={textSize === t[0] ? 'on' : ''}
                data-text-size={t[0]}
                onClick={function () { setTextSize(t[0], { save: true }); }}>
                {t[1]}
              </button>
            );
          })}
        </div></div>
        <div className="wb-font-section">
          <span>字标字体</span>
          <div className="wb-font-grid" id="lockfont">
            {LOCK_FONTS.map(function (f) {
              return (
                <button key={f[0]} type="button"
                  className={'wb-font-opt' + (lockFont === f[0] ? ' on' : '')}
                  data-lock-font={f[0]}
                  onClick={function () {
                    applyLockFont(f[0]);
                    savePrefs({ lockFont: f[0] });
                  }}>
                  <span className={'wb-font-sample wb-lock-font-' + f[0]}>HELLO</span>
                  <span className="wb-font-cap">{f[1]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="ctl-row"><span>时间</span><div className="ctl" id="clockmode">
          {CLOCK_MODES.map(function (c) {
            return (
              <button key={c[0]} type="button" className={clockMode === c[0] ? 'on' : ''}
                data-clock-mode={c[0]}
                onClick={function () {
                  applyClock(c[0], wbGet().clockFixed);
                  savePrefs({ clockMode: c[0], clockFixed: wbGet().clockFixed });
                }}>
                {c[1]}
              </button>
            );
          })}
        </div></div>
        <div className="ctl-row wb-clock-fixed" id="clockfixed-row" hidden={clockMode !== 'fixed'}>
          <span>固定</span>
          <input type="time" id="clockfixed" className="wb-time-input" step="60"
            value={inputFromIosTime(clockFixed)}
            onChange={function (e) {
              var fixed = iosTimeFromInput(e.target.value);
              applyClock('fixed', fixed);
              savePrefs({ clockMode: 'fixed', clockFixed: fixed });
            }} />
        </div>
      </div>
    </Fragment>
  );
}
