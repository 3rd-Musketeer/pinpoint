import { Pill } from './components/Pill.jsx';

export default function Frame() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1>欢迎页</h1>
        <Pill label="ob-welcome" />
      </div>
    </div>
  );
}
