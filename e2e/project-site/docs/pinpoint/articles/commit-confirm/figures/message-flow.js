// 逐步演示：steps() 加控件（上一步 / 播放 / 下一步），每一步点亮一条消息，圆点沿箭头走一趟。
import { steps } from 'pinpoint/figure';

export default function mount(root) {
  return steps(root, { autoplay: 2200 });
}
