export default function Dots() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <canvas className="e2e-paint" width="40" height="40"></canvas>
        <p>painted frame</p>
      </div>
      <script data-preview-script>{`
        const c = root.querySelector('.e2e-paint');
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, 40, 40);
      `}</script>
    </div>
  );
}
