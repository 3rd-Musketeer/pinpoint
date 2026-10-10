import { Pill } from './components/Pill.jsx';

export default function Frame() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1>引导完成</h1>
        <Pill label="ob-done" />
      </div>
    </div>
  );
}
