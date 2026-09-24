import { Chip } from './components/Chip.jsx';

export default function Alpha() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1 data-alpha>hmr-site alpha v1</h1>
        <Chip label="chip v1" />
      </div>
    </div>
  );
}
