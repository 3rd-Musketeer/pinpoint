import { Bubble } from 'pinpoint/kit';

export default function KitFrame() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <Bubble side="incoming">kit 气泡</Bubble>
      </div>
    </div>
  );
}
