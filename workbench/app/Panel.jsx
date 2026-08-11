// Chrome Side Panel 面板页 —— extension 侧栏 iframe 的内容（panel.html 承载）。
// 与宿主页面不同窗，没有 window.pinpoint：
//   数据 —— GET /annotations/<page>?entry=<id>（账本 key 与 client 同一套
//     lib 算法：pageKeyFromPathname → annotationSlug），SSE /events 的
//     annotations 事件做实时更新（entry + page 双过滤，与 client 同规则）；
//   动作 —— postMessage({source:'pinpoint-panel', cmd:jump|edit|del|mode})
//     → extension/sidepanel.js 壳（校验 source + origin）→ content script
//     → 页面主世界 client（pinpoint:command 桥）。postMessage 用 '*'：
//     面板不知道扩展源，校验归壳；删除/编辑的真正写入仍在页面 client 里
//     （removeMark → persist → SSE 广播回来），面板不是第二写者。
// 与 workbench AnnPanel 的已知差别：锚点失效判定需要页面 DOM，面板侧不算
// （broken 恒 false），失效标记看页面内列表；模式分段只反映加载时的初始值
// （页面里按 A 切换不会回传）。
import { useEffect, useMemo, useState } from 'react';
import { pageKeyFromPathname } from '../../lib/annotate-page-key.js';
import { annotationSlug } from '../../lib/annotation-slug.js';
import { targetContentToDisplay } from '../../lib/annotation-indicator.js';
import { annRowModel, annRowPreview } from '../../lib/ann-row.js';
import { cn } from './lib/utils.js';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group.jsx';
import { SEG, SEG_ITEM } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';

// 与 client/annotate.js 的 MENTION_STORE_RE 同式（磁盘 [@a:id]/[@m:id] → 显示 @n）。
var MENTION_STORE_RE = /\[@(?:a|m):([a-z0-9]+)\]/gi;

// 「标注」on 态琥珀面 —— 与 AnnPanel 的 ANN_ANNOTATE_ON 同值（标注特性色，
// 双端信号一致）。复制而非抽取：两处调用点，抽共享件不值当。
var SEG_ITEM_ANNOTATE = SEG_ITEM.replace(' data-[state=on]:shadow-[var(--wb-sh-1)]', '');
var ANN_ANNOTATE_ON =
  'data-[state=on]:bg-[color-mix(in_srgb,#f5a623_16%,var(--wb-surface))] data-[state=on]:text-[#8a5a00] ' +
  'hover:data-[state=on]:bg-[color-mix(in_srgb,#f5a623_16%,var(--wb-surface))]';

// 与 client annotationContent 同语义：content 优先，回退 comment（旧账本字段）。
function rowContent(m) {
  if (!m) return '';
  if (m.content != null) return m.content;
  return m.comment || '';
}

function PanelRow(props) {
  var r = props.row;
  return (
    <div className="wb-ann-item group flex flex-col" data-ann-n={r.n}>
      <div className="wb-ann-item-row flex w-full items-stretch gap-0.5">
        <button type="button" className="wb-ann-item-main rounded-md" data-ann-n={r.n}
          title="跳转到标注" onClick={function () { props.onCommand({ cmd: 'jump', n: r.n }); }}>
          <span className="wb-ann-num w-[18px]">{r.n}</span>
          <span className="wb-ann-body">
            <span className="wb-ann-cap">{r.cap}</span>
            <span className="wb-ann-text">{r.preview}</span>
            {r.tags ? <span className="wb-ann-tags">{r.tags}</span> : null}
          </span>
        </button>
        <button type="button" data-ann-act="edit" data-ann-n={r.n} aria-label={'编辑标注 ' + r.n} title="编辑（在页面里打开）"
          className="mr-0.5 self-center rounded-lg px-1 text-[13px] leading-none text-[color:var(--wb-faint)] opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[color:var(--wb-hover)] hover:text-[color:var(--wb-fg)] group-hover:opacity-100 focus-visible:opacity-100"
          onClick={function (e) { e.preventDefault(); e.stopPropagation(); props.onCommand({ cmd: 'edit', n: r.n }); }}>✎</button>
        <button type="button" data-ann-act="del" data-ann-n={r.n} aria-label={'删除标注 ' + r.n} title="删除"
          className="mr-1 self-center rounded-lg px-1 text-[16px] leading-none text-[color:var(--wb-faint)] opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--wb-danger)_10%,transparent)] hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          onClick={function (e) { e.preventDefault(); e.stopPropagation(); props.onCommand({ cmd: 'del', n: r.n }); }}>×</button>
      </div>
    </div>
  );
}

export function Panel() {
  var query = useMemo(function () { return new URLSearchParams(location.search); }, []);
  var entry = query.get('entry') || 'pinpoint';
  var pathname = query.get('page') || '/';
  var page = pageKeyFromPathname(pathname);        // 账本 URL 段（client 同式）
  var pageKey = annotationSlug(page);              // 磁盘/SSE 的 slug 后值

  var [doc, setDoc] = useState(null);              // null = 加载中；{error:true} = 读取失败
  var [mode, setMode] = useState(query.get('mode') === 'annotate');

  useEffect(function () {
    var dead = false;
    function apply(data) { if (!dead) setDoc(data); }
    fetch('/annotations/' + encodeURIComponent(page) + '?entry=' + encodeURIComponent(entry))
      .then(function (res) { return res.ok ? res.json() : { annotations: [] }; })
      .then(apply, function () { apply({ error: true, annotations: [] }); });
    var es = new EventSource('/events');
    es.addEventListener('annotations', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if ((d.entry || 'pinpoint') !== entry) return;
        if (d.page !== page && d.page !== pageKey) return;
        apply(d);
      } catch (e) { /* 忽略坏帧 */ }
    });
    return function () { dead = true; es.close(); };
  }, [entry, page, pageKey]);

  function sendCommand(payload) {
    // 壳侧校验 source 与 event.origin；面板不知道扩展源，targetOrigin 只能 '*'。
    parent.postMessage(Object.assign({ source: 'pinpoint-panel' }, payload), '*');
  }

  var rows = useMemo(function () {
    var marks = (doc && doc.annotations) || [];
    var byId = {};
    marks.forEach(function (m) { if (m && m.id) byId[m.id] = m; });
    return marks.slice().sort(function (a, b) { return a.n - b.n; }).map(function (m) {
      var display = targetContentToDisplay(rowContent(m), m.targets || [])
        .replace(MENTION_STORE_RE, function (_, id) { var hit = byId[id]; return hit ? '@' + hit.n : '@?'; });
      return annRowModel(m, { preview: annRowPreview(display) });
    });
  }, [doc]);

  var pageName = decodeURIComponent(pathname.split('/').pop() || '') || pathname;

  return (
    <div className="flex h-full flex-col" id="panel-view">
      <div className="flex items-baseline gap-2 px-3 pb-2 pt-3" id="panel-head">
        <span className="text-[13px] font-semibold">标注</span>
        <span className="text-[11px] text-[color:var(--wb-faint)]" id="panel-count">
          {doc && !doc.error ? rows.length + ' 条 · ' + pageName : pageName}
        </span>
      </div>
      <div className="px-3 pb-2">
        <ToggleGroup type="single" spacing={0.5} value={mode ? 'annotate' : 'interact'}
          id="panel-mode" role="group" aria-label="交互 / 标注模式"
          className={cn(SEG, 'wb-ann-mode w-auto')}>
          <ToggleGroupItem value="interact" data-ann-mode="interact" title="交互模式"
            className={cn(SEG_ITEM, !mode && 'on')}
            onClick={function () { if (mode) { setMode(false); sendCommand({ cmd: 'mode', on: false }); } }}>交互</ToggleGroupItem>
          <ToggleGroupItem value="annotate" data-ann-mode="annotate" title="标注模式"
            className={cn(SEG_ITEM_ANNOTATE, ANN_ANNOTATE_ON, mode && 'on')}
            onClick={function () { if (!mode) { setMode(true); sendCommand({ cmd: 'mode', on: true }); } }}>标注</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="wb-ann-list flex-1 overflow-y-auto px-2 pb-2" id="panel-list">
        {doc === null ? (
          <p className="m-0 px-1 pt-2 text-[11px] text-[color:var(--wb-faint)]">加载中…</p>
        ) : doc.error ? (
          <p className="m-0 px-1 pt-2 text-[11px] text-[color:var(--wb-faint)]">读取失败：检查 pinpoint 服务</p>
        ) : rows.length ? rows.map(function (r) {
          return <PanelRow key={r.n} row={r} onCommand={sendCommand} />;
        }) : (
          <div className="wb-ann-empty m-0 flex flex-col items-center justify-center gap-1.5 pt-8">
            <WbIcon name="empty-ann" size={22} className="wb-ann-empty-ico block size-[22px] text-[color:var(--wb-faint)] opacity-75" />
            <p className="wb-ann-empty-title m-0">暂无标注</p>
            <p className="wb-ann-empty-hint max-w-[16em]">切到「标注」后，在页面上点选或框选元素</p>
          </div>
        )}
      </div>
    </div>
  );
}
