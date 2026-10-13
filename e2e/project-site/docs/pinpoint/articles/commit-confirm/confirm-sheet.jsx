import { ConfirmCard } from './components/ConfirmCard.jsx';

export default function ConfirmSheet() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <ConfirmCard title="确认提交订单" />
      </div>
    </div>
  );
}
