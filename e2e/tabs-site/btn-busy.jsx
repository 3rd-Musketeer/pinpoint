import { Pill } from './components/Pill.jsx';

export default function Frame() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1>按钮 加载中</h1>
        <Pill label="btn-busy" />
      </div>
    </div>
  );
}
