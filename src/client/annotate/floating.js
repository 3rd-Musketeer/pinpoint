// @floating-ui/dom 的薄封装（2026-10-19 C4）：composer / bubbles / mention 三处定位
// 共用同一个库入口与虚拟参照构造。middleware 由调用方按自己的几何语义装配，
// 这里不藏配置。注入端按字节计费：只再导出真正用到的（flip 不进包，见 bubbles.js
// 的翻左判定）。computePosition 是 async（Promise 在微任务里落地，写样式仍在同帧）。
import { computePosition, offset, shift } from '@floating-ui/dom';

/** [x, y, w, h]（视口坐标）→ floating-ui 虚拟参照元素。 */
export function virtualRect(r) {
  var rect = {
    x: r[0], y: r[1], left: r[0], top: r[1],
    right: r[0] + r[2], bottom: r[1] + r[3], width: r[2], height: r[3]
  };
  return {
    getBoundingClientRect: function () { return rect; }
  };
}

export { computePosition, offset, shift };
