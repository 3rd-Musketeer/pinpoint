// 外壳就绪（2026-10-14）。index.html 先跑 stage.js、再跑 app/main.jsx，两个模块图各自加载。
// 板的挂载后处理（preview-mount.js afterMount）要用 main.jsx 注入的东西：frame ⋯ 菜单的
// React 岛（initExportCore）和 Section Navigator 的句柄（wireCanvasHud）。板的 fetch 比
// main.jsx 的模块图先到时（dev 服务转译 React 依赖慢、机器满载），挂载后处理会在注入之前跑：
// wireExportControls 抛 TypeError，预览脚本一条都没绑，navigator 不出，几何批也没排上。
// main.jsx 跑完最后一步调 markChromeReady()；afterMount 先等它，再动板。
let markReady;
const ready = new Promise((resolve) => { markReady = resolve; });

export function markChromeReady() {
  markReady(true);
}

export function whenChromeReady() {
  return ready;
}
