// Switch — props: checked
// DOM/class 以 components/switch/catalog.html 的开关件为准（.ios-switch > input[checkbox] + .ios-switch-track）。
export function Switch({ checked = false }) {
  return (
    <span class="ios-switch">
      <input type="checkbox" checked={checked || undefined} />
      <span class="ios-switch-track"></span>
    </span>
  );
}
