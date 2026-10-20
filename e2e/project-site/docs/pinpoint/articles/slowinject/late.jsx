// r5 B5 固件帧：裸内联脚本（无 data-preview-script，卡片侧 classifyFrameScript 归 'other'
// → 回退 iframe）在 load 后 700ms 才注入 12 行；comp 帧的台子随内容长高，量尺只量一次的
// 旧实现把这 12 行裁在初始盒子里。
// 注意：JSX 的字符串子节点会被编译器做 HTML 转义，脚本里不能出现 < & "（r5 的复现脚本
// 正是这样静默坏掉的）——这里用 createElement 和 12 > i 避开。
function Late() {
  return (
    <div className="e2e-late" style={{ padding: '12px' }}>
      <div data-holder>初始一行</div>
      <script>{`
        setTimeout(function () {
          var h = document.querySelector('[data-holder]');
          for (var i = 0; 12 > i; i++) {
            var d = document.createElement('div');
            d.style.height = '40px';
            d.textContent = '注入行 ' + i;
            h.appendChild(d);
          }
        }, 700);
      `}</script>
    </div>
  );
}
export default Late;
export const shell = 'comp';
