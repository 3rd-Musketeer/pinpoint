// 导出 picker（decisions 2026-08-15d）— 图片导出的唯一入口：HUD「导出」钮把
// store.exportPickerOpen 置真，本组件（React 岛，挂 #wbexport-picker）以原生
// <dialog> showModal 承载模态（P3 结论沿用：focus trap / Esc / 焦点还原交给原生）。
// 两栏 = 左 proto tree（当前页 section → frame，引用号 A1 体系复用 lib/board-refs.js，
// section 行 = 整选开关），右 = 实时预览（选中几帧并排几帧，复用 /api/export-image
// 低清档 scale 1 + 300ms debounce + seq 序号丢旧响应）+ 选项（背景三档）。
// 固定项 PNG 2×；图纸内容（图注 / 尺寸 / frame note）永随；单张直出 PNG，
// 多张 /api/export-zip 打包。快照构建与请求函数单向 import 自 ../export-core.js
// （app → 命令式 方向，与 Sidebar → openDocExportDialog 同例）。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import {
  buildExportSnapshot,
  downloadExportResult,
  requestExportImage,
  requestExportPreview,
  requestExportZip
} from '../export-core.js';
import { boardRefs } from '../lib/board-refs.js';
import { canvasBoard } from '../lib/board-entries.js';
import { frameDimLabel } from '../screen-load.js';
import { cn } from './lib/utils.js';

var BG_OPTIONS = [
  ['canvas', '画布'],
  ['white', '白底'],
  ['transparent', '透明']
];
var PREVIEW_DEBOUNCE_MS = 300;

function frameKey(sectionId, screenId) {
  return sectionId + '\0' + screenId;
}

/** activeBoard → tree 模型（section 字母 / frame 引用号 / 尺寸行，全部纯派生）。
    2026-08-16f 阶段 6：picker 只覆盖画布 frame —— doc 屏（文档/草稿条目）走
    侧栏「导出」的文档导出，不进图片导出树。 */
function buildTree(activeBoard) {
  if (!activeBoard || !activeBoard.board) return [];
  var board = canvasBoard(activeBoard.board);
  var refs = boardRefs(board);
  return (board.sections || [])
    .filter(function (sec) { return sec && sec.id !== '_empty'; })
    .map(function (sec) {
      return {
        id: sec.id,
        title: sec.title || sec.id,
        letter: refs.bySection[sec.id] || '',
        frames: (sec.screens || []).map(function (sc) {
          return {
            key: frameKey(sec.id, sc.id),
            sectionId: sec.id,
            screenId: sc.id,
            title: sc.title || sc.id,
            ref: refs.byFrame[frameKey(sec.id, sc.id)] || '',
            dim: frameDimLabel(activeBoard.pageId, sc.shell)
          };
        })
      };
    })
    .filter(function (sec) { return sec.frames.length > 0; });
}

function orderedSelection(tree, selected) {
  var frames = [];
  tree.forEach(function (sec) {
    sec.frames.forEach(function (frame) {
      if (selected[frame.key]) frames.push(frame);
    });
  });
  return frames;
}

function snapshotFor(frame, background, scale) {
  return buildExportSnapshot({
    kind: 'frame',
    sectionId: frame.sectionId,
    screenId: frame.screenId,
    format: 'png',
    scale: scale,
    background: background
  });
}

function PickerBody(props) {
  var tree = props.tree;
  var [selected, setSelected] = useState(function () {
    var all = {};
    tree.forEach(function (sec) {
      sec.frames.forEach(function (frame) { all[frame.key] = true; });
    });
    return all;
  });
  var [background, setBackground] = useState('canvas');
  var [previews, setPreviews] = useState([]); // [{ key, ref, title, url }]
  var [previewPending, setPreviewPending] = useState(false);
  var [previewError, setPreviewError] = useState(false);
  var [busy, setBusy] = useState(false);
  var [notice, setNotice] = useState('');
  var [noticeError, setNoticeError] = useState(false);
  // 预览竞态护栏（export-core docTokenRequestSeq 同例）：序号+已发 objectURL 账簿，
  // 选项快变时旧响应丢弃并回收 URL；卸载时统一回收。
  var previewRef = useRef({ seq: 0, urls: [] });

  var frames = orderedSelection(tree, selected);
  var count = frames.length;
  var selectedKey = frames.map(function (frame) { return frame.key; }).join('\0');

  useEffect(function () {
    return function () {
      var box = previewRef.current;
      box.seq += 1; // 让在途响应全部过期
      box.urls.forEach(function (url) { URL.revokeObjectURL(url); });
    };
  }, []);

  useEffect(function () {
    setNotice('');
    setNoticeError(false);
    var box = previewRef.current;
    var seq = ++box.seq;
    if (!count) {
      setPreviews(function (prev) {
        prev.forEach(function (item) { URL.revokeObjectURL(item.url); });
        return [];
      });
      setPreviewPending(false);
      setPreviewError(false);
      return undefined;
    }
    setPreviewPending(true);
    var timer = setTimeout(function () {
      Promise.all(frames.map(function (frame) {
        return requestExportPreview(snapshotFor(frame, background, 1)).then(function (result) {
          var url = URL.createObjectURL(result.blob);
          box.urls.push(url);
          return { key: frame.key, ref: frame.ref, title: frame.title, url: url };
        });
      })).then(function (items) {
        if (seq !== box.seq) {
          items.forEach(function (item) { URL.revokeObjectURL(item.url); });
          return;
        }
        setPreviews(function (prev) {
          prev.forEach(function (item) { URL.revokeObjectURL(item.url); });
          return items;
        });
        setPreviewPending(false);
        setPreviewError(false);
      }).catch(function () {
        if (seq !== box.seq) return;
        setPreviewPending(false);
        setPreviewError(true);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return function () { clearTimeout(timer); };
    // frames 由 selectedKey 代表（同序同集合同字符串）；background 直接参与。
  }, [selectedKey, background]);

  function toggleFrame(frame) {
    setSelected(function (prev) {
      var next = Object.assign({}, prev);
      next[frame.key] = !prev[frame.key];
      return next;
    });
  }

  function toggleSection(sec) {
    var allOn = sec.frames.every(function (frame) { return selected[frame.key]; });
    setSelected(function (prev) {
      var next = Object.assign({}, prev);
      sec.frames.forEach(function (frame) { next[frame.key] = !allOn; });
      return next;
    });
  }

  function onGo() {
    if (!count || busy) return;
    setBusy(true);
    setNoticeError(false);
    setNotice(count > 1 ? '正在渲染 ' + count + ' 帧并打包…' : '正在生成 PNG…');
    var done = function (result) {
      downloadExportResult(result);
      setNotice('已下载 ' + result.filename + '（' + (result.blob.size / 1024).toFixed(0) + ' KB）');
    };
    var fail = function (error) {
      setNotice(String(error && error.message || error));
      setNoticeError(true);
    };
    var finish = function () { setBusy(false); };
    try {
      if (count === 1) {
        var frame = frames[0];
        requestExportImage({
          kind: 'frame',
          sectionId: frame.sectionId,
          screenId: frame.screenId,
          format: 'png',
          scale: 2,
          background: background
        }).then(done).catch(fail).then(finish);
      } else {
        requestExportZip(frames.map(function (frame) { return snapshotFor(frame, background, 2); }))
          .then(done).catch(fail).then(finish);
      }
    } catch (error) {
      fail(error);
      finish();
    }
  }

  var bgLabel = BG_OPTIONS.reduce(function (hit, pair) { return pair[0] === background ? pair[1] : hit; }, '画布');
  var statusText = notice || (count
    ? '已选 ' + count + ' 帧，PNG 2×，' + bgLabel + '背景'
    : '没有选中的帧');

  return (
    <div className="wb-export-form">
      <div className="wb-export-head">
        <div className="wb-export-head-copy">
          <h2 id="wb-export-picker-title">导出图片</h2>
          <p className="wb-export-target">{props.pageId}</p>
        </div>
        <button type="button" className="wb-export-close" aria-label="关闭"
          onClick={function () { wbSet({ exportPickerOpen: false }); }}>×</button>
      </div>
      <div className="wb-pk-body">
        <div className="wb-pk-tree">
          {tree.map(function (sec) {
            var allOn = sec.frames.every(function (frame) { return selected[frame.key]; });
            var someOn = sec.frames.some(function (frame) { return selected[frame.key]; });
            return (
              <Fragment key={sec.id}>
                <button type="button" className={cn('wb-pk-sec', allOn && 'on')} data-section={sec.id}
                  role="checkbox" aria-checked={allOn ? 'true' : someOn ? 'mixed' : 'false'}
                  onClick={function () { toggleSection(sec); }}>
                  <span className="wb-pk-box">{allOn ? '✓' : ''}</span>
                  <span className="wb-pk-letter">{sec.letter}</span>
                  <span className="wb-pk-name">{sec.title}</span>
                </button>
                {sec.frames.map(function (frame) {
                  var on = !!selected[frame.key];
                  return (
                    <button type="button" key={frame.key} className={cn('wb-pk-fr', on && 'on')}
                      data-section={frame.sectionId} data-screen={frame.screenId}
                      role="checkbox" aria-checked={on ? 'true' : 'false'}
                      onClick={function () { toggleFrame(frame); }}>
                      <span className="wb-pk-box">{on ? '✓' : ''}</span>
                      <span className="wb-pk-no">{frame.ref}</span>
                      <span className="wb-pk-name">{frame.title}</span>
                      {frame.dim ? <span className="wb-pk-dim">{frame.dim}</span> : null}
                    </button>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
        <div className="wb-pk-side">
          <div className={cn('wb-pk-pv', previewPending && 'is-loading')}
            data-bg={background} data-multi={count > 1 ? 'true' : undefined}>
            {!count ? <p className="wb-pk-pv-empty">在左侧勾选要导出的帧</p> : null}
            {count && previewError ? <p className="wb-pk-pv-empty">预览生成失败，下载不受影响</p> : null}
            {count && !previewError && !previews.length
              ? <p className="wb-pk-pv-empty">正在生成预览…</p>
              : null}
            {previews.map(function (item) {
              return (
                <span className="wb-pk-pv-item" key={item.key}>
                  <img src={item.url} alt={item.ref + ' ' + item.title} />
                </span>
              );
            })}
          </div>
          <div className="wb-pk-opt">
            <span className="wb-pk-k">背景</span>
            <div className="wb-export-options" role="radiogroup" aria-label="背景">
              {BG_OPTIONS.map(function (pair) {
                return (
                  <label className="wb-export-option" key={pair[0]}>
                    <input type="radio" name="wb-pk-bg" value={pair[0]}
                      checked={background === pair[0]}
                      onChange={function () { setBackground(pair[0]); }} />
                    <span>{pair[1]}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="wb-pk-ft">
        <span className={cn('wb-pk-st', noticeError && 'is-error')} aria-live="polite">{statusText}</span>
        <button type="button" className="wb-export-action primary wb-pk-go"
          disabled={!count || busy} onClick={onGo}>
          {count > 1 ? '打包下载 zip' : '下载 PNG'}
        </button>
      </div>
    </div>
  );
}

export function ExportPicker() {
  var open = useWorkbenchStore(function (s) { return s.exportPickerOpen; });
  var activeBoard = useWorkbenchStore(function (s) { return s.activeBoard; });
  var dialogRef = useRef(null);
  var tree = useMemo(function () { return buildTree(activeBoard); }, [activeBoard]);

  useEffect(function () {
    var dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  var pageId = activeBoard && activeBoard.pageId;
  return (
    <dialog ref={dialogRef} className="wb-export-dialog wb-export-picker"
      data-ann-ui="" data-export-ui="" aria-labelledby="wb-export-picker-title"
      onClose={function () { wbSet({ exportPickerOpen: false }); }}
      onClick={function (event) {
        // 原生 dialog 的 ::backdrop 点击落在 dialog 自身上 —— 点幕布关闭。
        if (event.target === dialogRef.current) wbSet({ exportPickerOpen: false });
      }}>
      {/* 每次打开重挂 PickerBody：选择/背景回到默认（全选 + 画布），预览账簿清零 */}
      {open && pageId ? <PickerBody tree={tree} pageId={pageId} /> : null}
    </dialog>
  );
}
