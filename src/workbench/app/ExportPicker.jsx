// 导出入口（pp2 切片 3 收敛）：用户面只有「导出整个画布为离线可交互 HTML」
// （export-page-html，ADR 0033）。横条「导出」钮把 store.exportPickerOpen 置真，
// 本组件（React 岛，挂 #wbexport-picker）以原生 <dialog> showModal 承载模态
// （focus trap / Esc / 焦点还原交给原生）。先扫描依赖（/api/export-page-html/scan），
// 有 HTTPS 静态资源时逐项批准后才冻结下载；没有则直接下载。
// 图片 / zip picker 与文档导出对话框已随切片 3 退役；/api/export-image 服务端
// 保留给 ppnt shot，不再是用户面入口。
import { useEffect, useRef, useState } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import {
  downloadExportResult,
  requestOfflinePageExport,
  requestOfflinePageScan,
} from '../export-core.js';
import { cn } from './lib/utils.js';

function byteLabel(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function OfflineHtmlPickerBody(props) {
  var [phase, setPhase] = useState('idle');
  var [scan, setScan] = useState(null);
  var [approved, setApproved] = useState({});
  var [notice, setNotice] = useState('导出当前 Page 的固定快照；接收者双击即可离线查看。');
  var resources = scan && scan.remoteResources || [];
  var allApproved = resources.every(function (resource) { return approved[resource.url]; });

  function fail(error) {
    setPhase('error');
    setNotice(String(error && error.message || error));
  }

  function download(approvals) {
    setPhase('exporting');
    setNotice('正在冻结资源并生成单文件…');
    requestOfflinePageExport(props.pageId, approvals).then(function (result) {
      downloadExportResult(result);
      setPhase('done');
      setNotice('已下载 ' + result.filename + '（' + byteLabel(result.blob.size) + '）');
    }).catch(fail);
  }

  function inspect() {
    setPhase('scanning');
    setScan(null);
    setApproved({});
    setNotice('正在检查 Page 与全部依赖…');
    requestOfflinePageScan(props.pageId).then(function (result) {
      setScan(result);
      if (!result.remoteResources.length) download([]);
      else {
        setPhase('approval');
        setNotice('发现 ' + result.remoteResources.length + ' 个 HTTPS 静态资源；逐项确认后才能下载。');
      }
    }).catch(fail);
  }

  return (
    <div className="wb-export-form">
      <div className="wb-export-head">
        <div className="wb-export-head-copy">
          <h2 id="wb-export-picker-title">可交互 HTML</h2>
          <p className="wb-export-target">{props.pageId}</p>
        </div>
        <button type="button" className="wb-export-close" aria-label="关闭"
          onClick={function () { wbSet({ exportPickerOpen: false }); }}>×</button>
      </div>
      <div className="wb-offline-summary">
        <strong>{props.sectionCount} 个 Section · {props.frameCount} 个 Frame</strong>
        <span>纵向浏览 Section；每个 Section 内横向浏览 Frame；左侧 Outline 导航。</span>
        <span>保留 Frame 内交互与当前固定比例；不包含标注，也无法撤回。</span>
      </div>
      {resources.length ? (
        <div className="wb-offline-resources" aria-label="待批准的 HTTPS 静态资源">
          {resources.map(function (resource) {
            return (
              <label className="wb-offline-resource" key={resource.url}>
                <input type="checkbox" checked={!!approved[resource.url]}
                  onChange={function (event) {
                    var checked = event.target.checked;
                    setApproved(function (prev) {
                      return Object.assign({}, prev, { [resource.url]: checked });
                    });
                  }} />
                <span className="wb-offline-resource-copy">
                  <strong>{resource.origin} · {resource.mime} · {byteLabel(resource.size)}</strong>
                  <span title={resource.url}>{resource.url}</span>
                  <code title={resource.sha256}>sha256 {resource.sha256.slice(0, 16)}…</code>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      <div className="wb-pk-ft">
        <span className={cn('wb-pk-st', phase === 'error' && 'is-error')} aria-live="polite">{notice}</span>
        {phase === 'approval' ? (
          <button type="button" className="wb-export-action primary wb-pk-go"
            disabled={!allApproved} onClick={function () { download(resources); }}>确认并下载</button>
        ) : (
          <button type="button" className="wb-export-action primary wb-pk-go"
            disabled={phase === 'scanning' || phase === 'exporting'} onClick={inspect}>
            {phase === 'done' || phase === 'error' ? '重新检查并下载' : '检查并下载'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ExportPicker() {
  var open = useWorkbenchStore(function (s) { return s.exportPickerOpen; });
  var activeBoard = useWorkbenchStore(function (s) { return s.activeBoard; });
  var dialogRef = useRef(null);

  useEffect(function () {
    var dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  var pageId = activeBoard && activeBoard.pageId;
  var sections = (activeBoard && activeBoard.board && activeBoard.board.sections) || [];
  var frameCount = sections.reduce(function (count, sec) {
    return count + ((sec && sec.screens) || []).filter(function (sc) { return (sc.shell || 'app') !== 'doc'; }).length;
  }, 0);
  var canvasSections = sections.filter(function (sec) {
    return sec && sec.id !== '_empty' && ((sec.screens) || []).some(function (sc) { return (sc.shell || 'app') !== 'doc'; });
  }).length;
  return (
    <dialog ref={dialogRef} className="wb-export-dialog wb-export-picker"
      data-ann-ui="" data-export-ui="" aria-labelledby="wb-export-picker-title"
      onClose={function () { wbSet({ exportPickerOpen: false }); }}
      onClick={function (event) {
        // 原生 dialog 的 ::backdrop 点击落在 dialog 自身上 —— 点幕布关闭。
        if (event.target === dialogRef.current) wbSet({ exportPickerOpen: false });
      }}>
      {open && pageId
        ? <OfflineHtmlPickerBody pageId={pageId} sectionCount={canvasSections} frameCount={frameCount} />
        : null}
    </dialog>
  );
}
