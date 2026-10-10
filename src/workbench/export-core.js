// Workbench export cluster — pp2 切片 3 收敛后只剩两块：
// 1) 离线可交互 HTML 导出的请求函数（/api/export-page-html[/scan]），
//    用户面入口 = app/ExportPicker.jsx；
// 2) frame ⋯ 菜单 shell（行为由 Radix DropdownMenu 承载，React 岛 app/frame-menu.jsx
//    经 initExportCore(deps) 注入挂载）。
// 图片 / zip 导出 picker、文档导出对话框与 token 估算已随切片 3 退役；
// /api/export-image 服务端保留给 ppnt shot（服务端自己组快照，不走本模块）。
// P2 说明：导出 POST 是下载流 / 一次性计算，不是可缓存的 server state —— 保持
// plain fetch，不走 Query。

// 反向依赖注入：React 岛挂载器属 app/ 簇，本模块不得 import app/ 组件，
// 由 app/main.jsx 在初始化时经 initExportCore(deps) 注入。
var exportDeps = {};

export function initExportCore(deps) {
  exportDeps = deps || {};
}

function postOfflinePageExport(pathname, pageId, approvals) {
  return fetch(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageId: pageId, approvals: approvals })
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) {
      throw new Error(body.message || ('HTML 导出失败 · ' + response.status));
    });
    return response;
  });
}

// 先扫描再导出：HTTPS 静态资源只有在作者看到 URL / 类型 / 大小 / 摘要并逐项
// 确认后，才把同一批精确字节冻结进离线文件。没有远端资源时可直接下载。
export function requestOfflinePageScan(pageId) {
  return postOfflinePageExport('/api/export-page-html/scan', pageId).then(function (response) {
    return response.json();
  });
}

export function requestOfflinePageExport(pageId, approvals) {
  return postOfflinePageExport('/api/export-page-html', pageId, approvals || []).then(function (response) {
    return response.blob().then(function (blob) {
      return {
        blob: blob,
        filename: filenameFromContentDisposition(
          response.headers.get('Content-Disposition'),
          pageId + '__interactive.html'
        ),
        sections: Number(response.headers.get('X-Export-Sections')) || 0,
        frames: Number(response.headers.get('X-Export-Frames')) || 0
      };
    });
  });
}

export function downloadExportResult(result) {
  var url = URL.createObjectURL(result.blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  var star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch (e) { /* keep fallback */ }
  }
  var plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

// 板面重建后为每个 frame 图注挂上 ⋯ 菜单 shell（React 岛本体见 app/frame-menu.jsx）。
export function wireExportControls(panel) {
  if (!panel) return;
  // 板面重建后旧 shell 已游离 —— 先卸载它们的 React root。
  exportDeps.sweepFrameMenus();
  panel.querySelectorAll('[data-screen]').forEach(function (screen) {
    var caption = screen.querySelector(':scope > .wb-screen-cap');
    if (!caption || caption.querySelector(':scope > .wb-frame-menu-shell')) return;
    caption.classList.add('has-frame-menu');
    var shell = document.createElement('span');
    shell.className = 'wb-frame-menu-shell';
    shell.setAttribute('data-export-ui', '');
    shell.setAttribute('data-ann-ui', '');
    caption.appendChild(shell);
    exportDeps.mountFrameMenu(shell, {
      screenId: screen.getAttribute('data-screen')
    });
  });
}
