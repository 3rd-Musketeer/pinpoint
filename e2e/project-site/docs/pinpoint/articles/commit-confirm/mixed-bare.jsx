import { ConfirmCard } from './components/ConfirmCard.jsx';

// 和手机帧同在一节，这一帧是裸组件：帧自己声明 shell。
export const shell = "comp";

export default function MixedBare() {
  return <ConfirmCard title="裸确认卡" />;
}
