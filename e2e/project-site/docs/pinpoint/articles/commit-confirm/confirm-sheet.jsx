import { ConfirmCard } from './components/ConfirmCard.jsx';

// 帧里有一个能点的按钮（预览脚本 A 式）：正文浮层里的帧可交互，点了改字（e2e/article-viewer.spec.js）。
export default function ConfirmSheet() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <ConfirmCard title="确认提交订单" />
        <button className="e2e-tap" type="button">确认</button>
        <p className="e2e-tap-out">未确认</p>
      </div>
      <script data-preview-script>{`
        const out = root.querySelector('.e2e-tap-out');
        root.querySelector('.e2e-tap').addEventListener('click', () => { out.textContent = '已确认'; });
      `}</script>
    </div>
  );
}
