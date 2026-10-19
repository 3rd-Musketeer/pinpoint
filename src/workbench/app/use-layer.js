// React 弹层接入工作台弹层栈（C2）：开着就压一层，关了（含被栈关掉）随 effect
// 清理释放。close 走 ref，重渲染不换层、不打乱同级 LIFO。
// keepEscapeForStack 给 Radix 菜单的 onEscapeKeyDown 用：Esc 的归属由弹层栈统一
// 裁决（栈在 window 捕获段先关掉这一层），Radix 自己的 dismiss 不再重复处理。
import { useEffect, useRef } from 'react';
import { wbLayers } from '../layer-stack.js';

export { LAYER_RANK } from '../../shared/layers.js';

export function useStackLayer(name, open, close, opts) {
  var closeRef = useRef(close);
  closeRef.current = close;
  var rank = opts && opts.rank;
  var respectTyping = !!(opts && opts.respectTyping);
  useEffect(function () {
    if (!open) return;
    return wbLayers.push(name, function () { closeRef.current(); }, { rank: rank, respectTyping: respectTyping });
  }, [name, open, rank, respectTyping]);
}

export function keepEscapeForStack(e) {
  e.preventDefault();
}
