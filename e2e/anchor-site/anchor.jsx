import { Blurb } from './components/Blurb.jsx';

export default function Anchor() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1>锚点固件</h1>
        <Blurb />
        <p data-tail>帧内尾部段</p>
      </div>
    </div>
  );
}
