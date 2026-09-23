// Bubble — props: side "incoming"|"outgoing"（默认 outgoing）· children
// DOM/class 以 components/bubble/{incoming,outgoing}.html 为准（.ios-bubble-in / .ios-bubble-out + 各侧 inline style；
// include 时代的 data-ios-slot 已随编译期展开退役，不再输出）。
export function Bubble({ side = 'outgoing', children }) {
  const style = side === 'incoming'
    ? {
      alignSelf: 'flex-start', maxWidth: '78%', background: 'var(--ios-fill-3)', color: 'var(--ios-text)',
      borderRadius: '18px', borderBottomLeftRadius: '6px', padding: '10px 14px',
      fontSize: 'var(--ios-t-body)', lineHeight: '1.35', letterSpacing: 'var(--ios-t-body-ls)',
    }
    : {
      alignSelf: 'flex-end', maxWidth: '78%', background: 'var(--ios-accent)', color: '#fff',
      borderRadius: '18px', borderBottomRightRadius: '6px', padding: '10px 14px',
      fontSize: 'var(--ios-t-body)', lineHeight: '1.35', letterSpacing: 'var(--ios-t-body-ls)',
    };
  const cls = side === 'incoming' ? 'ios-bubble ios-bubble-in' : 'ios-bubble ios-bubble-out';
  return <div class={cls} style={style}>{children}</div>;
}
