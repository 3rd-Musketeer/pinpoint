// React 版 workbench 图标 — lib/wb-icons.js 数据的唯一渲染路径。旧的命令式
// 挂载器扫 data-wb-icon 占位再 replaceWith 成 svg，会把 React 管理的 <i> 换成
// 游离节点、vnode 指向落空 —— chrome 全部出壳进 JSX 后该路径已无占位，随
// workbench-icons.js 一起删除（2026-10-20）。
import { ICONS, HERO_GEAR_SOLID } from '../lib/wb-icons.js';

export function WbIcon({ name, size, className, ...rest }) {
  size = size || 14;
  className = className || 'wb-ico';
  if (name === 'settings') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
        viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} {...rest}>
        <path fillRule="evenodd" clipRule="evenodd" d={HERO_GEAR_SOLID} />
      </svg>
    );
  }
  var icon = ICONS[name];
  if (!icon) return null;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...rest}>
      {icon.map(function (node, i) {
        var Tag = node[0];
        return <Tag key={i} {...node[1]} />;
      })}
    </svg>
  );
}
