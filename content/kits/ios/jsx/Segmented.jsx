// Segmented — props: items [{ value, label }]（字符串 = value 与 label 同值）· on（选中项 value）
// DOM/class 以 components/segmented/catalog.html 为准（.ios-segmented > button[data-value]，选中 .on）。
export function Segmented({ items = [], on }) {
  return (
    <div class="ios-segmented">
      {items.map((raw) => {
        const item = typeof raw === 'string' ? { value: raw, label: raw } : raw;
        return <button key={item.value} class={item.value === on ? 'on' : undefined} data-value={item.value}>{item.label}</button>;
      })}
    </div>
  );
}
