// 标注面板（P1b，goal-20260810-workbench-react-rebuild）— 原 workbench.js 标注
// 面板簇（markSummary/refreshAnnPanel/wireAnnotatePanel/pollAnnotate）的 React 形态。
// 状态源：app/store.js 的 annSnap（ann-bridge 把 annotate 实例状态 + pageMarks
// 汇成的纯数据快照）与 annFilter/activeGroup；行模型在 ann-bridge 里经
// lib/ann-row.js 建好，这里只做筛选/分组/渲染。手动 signature diff 与
// innerHTML 拼装随本组件删除 —— diff 交给 React 协调，转义交给 JSX。
// DOM id / class / 文案与原实现逐一对应（e2e 选择器即契约）。
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { annotateApi } from '../ann-bridge.js';
import { getLibraryScrollHandler, setSectionOpen } from '../pages.js';
import { savePrefs } from '../lib/prefs.js';
import { WbIcon } from './WbIcon.jsx';

var SNAP_OFF = { available: false, rows: [] };

function AnnRow(props) {
  var r = props.row;
  return (
    <div className={'wb-ann-item' + (r.broken ? ' wb-ann-item--broken' : '')} data-ann-n={r.n}>
      <div className="wb-ann-item-row">
        <button type="button" className="wb-ann-item-main" data-ann-n={r.n}
          onClick={function () { props.onGoTo(r.n); }}>
          <span className="wb-ann-num">{r.n}</span>
          <span className="wb-ann-body">
            <span className="wb-ann-cap">{r.cap}</span>
            <span className="wb-ann-text">{r.preview}</span>
            {r.broken ? <span className="wb-ann-broken-tag">锚点失效</span> : null}
            {r.tags ? <span className="wb-ann-tags">{r.tags}</span> : null}
          </span>
        </button>
        <button type="button" className="wb-ann-del" data-ann-del={r.n}
          aria-label={'删除标注 ' + r.n} title="删除" onClick={props.onDelete(r.n)}>×</button>
      </div>
    </div>
  );
}

export function AnnPanel() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; }) || SNAP_OFF;
  var annFilter = useWorkbenchStore(function (s) { return s.annFilter; });
  // tab 过滤才消费 activeGroup；all 模式下 scroll-spy 的 activeGroup 变化不必重渲染
  var activeGroup = useWorkbenchStore(function (s) { return s.annFilter === 'tab' ? s.activeGroup : null; });
  var listRef = useRef(null);

  var rows = snap.rows;

  // 有标注时自动展开 Annotations 段（原 refreshAnnPanel 的行为）
  useEffect(function () {
    if (rows.length && !wbGet().sectionOpen.annotations) {
      setSectionOpen('annotations', true, { save: false });
    }
  }, [rows.length]);

  var filtered = useMemo(function () {
    if (annFilter !== 'tab') return rows;
    return rows.filter(function (r) { return r.group === '_' || r.group === activeGroup; });
  }, [rows, annFilter, activeGroup]);

  var groups = useMemo(function () {
    var out = [];
    var byGroup = {};
    filtered.forEach(function (r) {
      if (!byGroup[r.group]) {
        byGroup[r.group] = { key: r.group, label: r.groupLabel, items: [] };
        out.push(byGroup[r.group]);
      }
      byGroup[r.group].items.push(r);
    });
    return out;
  }, [filtered]);

  // 每次点击重新解析：HTML 板下要驱动的是 iframe 里那个实例，不能闭包捕获
  function onToggle() { var a = annotateApi(); if (a) a.toggle(); }
  function onInteract() { var a = annotateApi(); if (a && a.getState().mode) a.toggle(); }
  function onPause() { var a = annotateApi(); if (a) a.setPaused(!a.getState().paused); }
  function onClear() { var a = annotateApi(); if (a) a.clear(); }
  function onPin() { var a = annotateApi(); if (a) a.setFloatingToolbar(!a.getState().floating); }
  function onComments() {
    var a = annotateApi();
    if (a && typeof a.setRenderComments === 'function') a.setRenderComments(!a.getState().renderComments);
  }
  function onChannel() {
    var a = annotateApi();
    if (!a || typeof a.setBubbleLayout !== 'function') return;
    a.setBubbleLayout((a.getState().bubbleLayout || 'inline') === 'inline' ? 'sidebar' : 'inline');
  }
  function onFilter(value) {
    return function () {
      wbSet({ annFilter: value });
      savePrefs({ annFilter: value });
      var spy = getLibraryScrollHandler();
      if (value === 'tab' && spy) spy();
    };
  }
  function onGoTo(n) {
    var a = annotateApi();
    if (!a || typeof a.goToMark !== 'function') return;
    a.goToMark(n).then(function () {
      var item = listRef.current && listRef.current.querySelector('.wb-ann-item[data-ann-n="' + n + '"]');
      if (item) item.scrollIntoView({ block: 'nearest' });
    });
  }
  function onDelete(n) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      var a = annotateApi();
      if (a && a.removeMark) a.removeMark(n);
    };
  }

  var available = !!snap.available;
  var mode = available && snap.mode;
  var paused = available && snap.paused;
  var floating = available && snap.floating;
  var renderComments = available && snap.renderComments;
  var layout = snap.bubbleLayout || 'inline';

  var statusText = '';
  if (available && snap.count) {
    var parts = [snap.countLive + ' 条可见'];
    if (snap.countBroken) parts.push(snap.countBroken + ' 锚点失效');
    parts.push('共 ' + snap.count + ' 条');
    statusText = parts.join(' · ');
  }

  return (
    <Fragment>
      <div className="wb-ann-tools" id="wbann-tools">
        <div className="wb-ann-mode" id="wbann-mode" role="group" aria-label="交互 / 标注模式">
          <button type="button" id="wbann-interact" className={mode ? '' : 'on'}
            data-ann-mode="interact" title="交互模式"
            aria-pressed={mode ? 'false' : 'true'} onClick={onInteract}>交互</button>
          <button type="button" id="wbann-toggle" className={mode ? 'on' : ''}
            data-ann-mode="annotate" title={mode ? '标注模式 (A → 交互)' : '标注模式 (A)'}
            aria-pressed={mode ? 'true' : 'false'} onClick={onToggle}>
            <span className="wb-tool-label">标注</span>
          </button>
        </div>
        <div className="wb-ann-quick">
          <button type="button" id="wbann-pause" className={paused ? 'on' : ''} title="暂停" onClick={onPause}>
            <WbIcon name="pause" />
            <span className="wb-tool-label">暂停</span>
          </button>
          <button type="button" id="wbann-comments" className={renderComments ? 'on' : ''}
            title="在画布渲染评论" onClick={onComments}>
            <WbIcon name="message" />
            <span className="wb-tool-label">{renderComments ? '评论✓' : '评论'}</span>
          </button>
          <button type="button" id="wbann-channel" className={layout === 'sidebar' ? 'on' : ''}
            hidden={!renderComments} title="评论布局：压字 / 留通道" onClick={onChannel}>
            <WbIcon name="columns" />
            <span className="wb-tool-label">{layout === 'sidebar' ? 'sidebar' : 'inline'}</span>
          </button>
          <button type="button" id="wbann-pin" className={floating ? 'on' : ''} title="Pin 悬浮条" onClick={onPin}>
            <WbIcon name="pin" />
            <span className="wb-tool-label">Pin</span>
          </button>
        </div>
        <button type="button" id="wbann-clear" className="wb-ann-clear" title="清空当前页全部标注" onClick={onClear}>清空标注</button>
      </div>
      <span className="wb-ann-status" id="wbann-status">{statusText}</span>
      <div className="wb-ann-filter">
        <div className="ctl" id="wbann-filter" role="group" aria-label="标注筛选">
          <button type="button" data-ann-filter="all" className={annFilter === 'all' ? 'on' : ''} onClick={onFilter('all')}>全部</button>
          <button type="button" data-ann-filter="tab" className={annFilter === 'tab' ? 'on' : ''} onClick={onFilter('tab')}>当前示例</button>
        </div>
      </div>
      <div className="wb-ann-list" id="wbann-list" ref={listRef}>
        {groups.length ? groups.map(function (g) {
          return (
            <Fragment key={g.key}>
              {g.label !== '未分组' ? <div className="wb-ann-group">{g.label}</div> : null}
              {g.items.map(function (r) {
                return <AnnRow key={r.key} row={r} onGoTo={onGoTo} onDelete={onDelete} />;
              })}
            </Fragment>
          );
        }) : (
          <div className="wb-ann-empty">
            <WbIcon name="empty-ann" size={22} className="wb-ann-empty-ico" />
            <p className="wb-ann-empty-title">暂无标注</p>
            <p className="wb-ann-empty-hint">切换到「标注」后，在画布上点选或框选元素</p>
          </div>
        )}
      </div>
    </Fragment>
  );
}
