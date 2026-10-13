import { Banner } from './components/Banner.jsx';
import { Nav } from './components/Nav.jsx';

export default function ConfirmDone() {
  return (
    <div className="ios-app">
      <Nav title="已提交" size="compact" />
      <div className="ios-page" style={{ padding: '24px' }}>
        <Banner text="订单已提交" />
      </div>
    </div>
  );
}
