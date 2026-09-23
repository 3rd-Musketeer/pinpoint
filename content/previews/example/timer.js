// timer.jsx 的 sidecar。只改文字与 data-*，不重建 DOM：结构归 JSX，行为归这里。
const STAGES = [
  { id: 'bloom', until: 30 },
  { id: 'pour1', until: 90 },
  { id: 'pour2', until: 150 },
];
const LABEL = { bloom: '焖蒸 · 缓慢画圈', pour1: '一段注水 · 注到 150g', pour2: '二段注水 · 放缓收尾' };

export default function mount(root) {
  const time = root.querySelector('[data-time]');
  const label = root.querySelector('[data-stage-label]');
  const toggle = root.querySelector('[data-timer-toggle] button');
  let elapsed = 0;
  let ticker = null;

  function render() {
    time.textContent = Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0');
    const now = STAGES.find((s) => elapsed < s.until);
    label.textContent = now ? LABEL[now.id] : '完成';
    for (const s of STAGES) {
      const row = root.querySelector(`[data-stage="${s.id}"]`);
      const state = elapsed >= s.until ? 'done' : s === now && ticker ? 'now' : 'todo';
      row.className = `ios-cell ex-step ${state}`;
      const chip = row.querySelector('[data-stage-chip]');
      chip.textContent = { todo: '待开始', now: '进行中', done: '完成' }[state];
      chip.className = { todo: 'ios-chip', now: 'ios-chip blue', done: 'ios-chip green' }[state];
    }
    toggle.textContent = ticker ? '暂停' : elapsed ? '继续' : '开始';
  }

  toggle.addEventListener('click', () => {
    if (ticker) { clearInterval(ticker); ticker = null; }
    else ticker = setInterval(() => { elapsed = Math.min(elapsed + 1, 150); if (elapsed === 150) { clearInterval(ticker); ticker = null; } render(); }, 1000);
    render();
  });
  render();
  return () => clearInterval(ticker);
}
