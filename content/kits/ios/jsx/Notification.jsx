// Notification — props: icon（emoji）· iconBg（图标底色）· title · time · children
// DOM/class 以 components/notification/catalog.html 为准（.ios-notification > .ios-notif-icon + .ios-notif-main）。
export function Notification({ icon, iconBg, title, time, children }) {
  return (
    <div class="ios-notification">
      <div class="ios-notif-icon" style={iconBg ? { background: iconBg } : undefined}>
        <span class="ios-emo">{icon}</span>
      </div>
      <div class="ios-notif-main">
        <div class="ios-notif-top"><span class="ios-notif-title">{title}</span><span class="ios-notif-time">{time}</span></div>
        <div class="ios-notif-body">{children}</div>
      </div>
    </div>
  );
}
