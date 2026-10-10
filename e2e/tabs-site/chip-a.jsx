import { Pill } from './components/Pill.jsx';

export default function Frame() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1>标签 A</h1>
        <Pill label="chip-a" />
      </div>
    </div>
  );
}
