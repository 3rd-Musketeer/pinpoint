// Sidecar mount for the brew timer screen (interactive-frame form B).
// The workbench imports this because timer.html carries data-preview-mount.
const CIRC = 603.19; // 2πr of the progress ring (r = 96)
const TOTAL = 150; // seconds: 焖蒸 30 + 一段 60 + 二段 60
const STAGES = [
  { id: 'bloom', until: 30, label: '焖蒸 · 缓慢画圈' },
  { id: 'pour1', until: 90, label: '一段注水 · 注到 150g' },
  { id: 'pour2', until: 150, label: '二段注水 · 放缓收尾' },
];

export default function mount(root) {
  const ring = root.querySelector('[data-ring]');
  const timeEl = root.querySelector('[data-time]');
  const stageLabel = root.querySelector('[data-stage-label]');
  const toggle = root.querySelector('[data-timer-toggle]');
  const reset = root.querySelector('[data-timer-reset]');

  let elapsed = 0;
  let ticker = null;

  function fmt(s) {
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  function render() {
    ring.setAttribute('stroke-dashoffset', String(CIRC * Math.max(0, 1 - elapsed / TOTAL)));
    timeEl.textContent = fmt(elapsed);
    const stage = STAGES.find((s) => elapsed < s.until);
    stageLabel.textContent = elapsed >= TOTAL ? '完成 · 记得写两句手记' : (elapsed === 0 && !ticker ? '准备好了吗' : stage.label);
    STAGES.forEach((s, i) => {
      const chip = root.querySelector('[data-stage="' + s.id + '"] [data-stage-chip]');
      const started = elapsed >= (i === 0 ? 0 : STAGES[i - 1].until) && (ticker || elapsed > 0);
      if (elapsed >= s.until) { chip.className = 'ios-chip green'; chip.textContent = '完成'; }
      else if (started && stage === s) { chip.className = 'ios-chip blue'; chip.textContent = '进行中'; }
      else { chip.className = 'ios-chip'; chip.textContent = '待开始'; }
    });
  }

  function stop() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function setState(state) {
    root.setAttribute('data-timer-state', state);
  }

  toggle.addEventListener('click', () => {
    if (ticker) {
      stop();
      setState('paused');
      toggle.textContent = '继续';
      return;
    }
    if (elapsed >= TOTAL) return;
    ticker = setInterval(() => {
      elapsed = Math.min(TOTAL, elapsed + 0.25);
      if (elapsed >= TOTAL) { stop(); setState('done'); toggle.textContent = '开始'; }
      render();
    }, 250);
    setState('running');
    toggle.textContent = '暂停';
    render();
  });

  reset.addEventListener('click', () => {
    stop();
    elapsed = 0;
    setState('idle');
    toggle.textContent = '开始';
    render();
  });

  render();
  return function unmount() {
    stop();
  };
}
