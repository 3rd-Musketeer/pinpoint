// 帧（组件台）：确认卡本身，不带手机壳。和手机帧同在一节，所以帧自己声明 shell。
export const shell = "comp";

export default function ConfirmCard() {
  return <div class="confirm-card">付款 ¥128.00 给「示例商店」</div>;
}
