// 帧 = 一个状态的一张快照。帧文件只放这一屏独有的东西；组件从页内 components/ 或 pinpoint/kit 引。
import { Nav, Segmented } from 'pinpoint/kit';
import { BeanCard } from './components/BeanCard.jsx';

export default function Beans() {
  return (
    <div class="ios-app">
      <Nav title="选豆" eyebrow="今天冲什么" />
      <div class="ex-page">
        <Segmented items={['全部', '在喝', '喝完']} on="全部" />
        <div style={{ marginTop: '14px' }}>
          <BeanCard name="埃塞 耶加雪菲" origin="水洗 · 浅烘" roast="light" />
          <BeanCard name="哥伦比亚 慧兰" origin="水洗 · 中烘" roast="medium" selected goto="recipe" />
          <BeanCard name="云南 保山" origin="日晒 · 深烘" roast="dark" empty />
        </div>
      </div>
    </div>
  );
}
