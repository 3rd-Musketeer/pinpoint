import { Chip } from './components/Chip.jsx';

export default function Beta() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1 data-beta>hmr-site beta v1</h1>
        <Chip label="chip v1" />
      </div>
    </div>
  );
}
