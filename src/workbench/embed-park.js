// 嵌入版工作台的暂停 / 恢复（E2）。文章页把画布浮层停驻时经 embed 通道发
// 'pause' / 'resume'，这里把已登记的各自的生命周期收起来：预览 mount、观察器、定时器、
// 诊断采样、SSE 之后的渲染。没有全局包装 timer / observer：每处自己登记自己怎么停、
// 怎么补。保存与 outbox 不登记，停驻期间照常落盘。
// 恢复时按登记顺序补做：停驻期间来过的工作（例如 HMR）由各自的 resume 补上。

/** @type {{ pause: () => void, resume: () => void }[]} */
var duties = [];
var parked = false;
// 文章页的暂停可能先于各模块的登记到达（stage.js 还在往下走）：先记住，
// 后来登记的立刻补停。恢复清掉这个意图。
var pauseRequested = false;

export function embedParked() {
  return parked || pauseRequested;
}

/** 登记一处可暂停的工作。已经停驻（或暂停先到了）时立刻调一次 pause，
 *  免得新挂上的观察器空转。返回退订；退订不会补调 resume（卸掉就是卸掉）。 */
export function registerEmbedPark(duty) {
  if (!duty || typeof duty.pause !== 'function' || typeof duty.resume !== 'function') {
    return function () {};
  }
  duties.push(duty);
  if (parked || pauseRequested) {
    parked = true;
    pauseRequested = false;
    try { duty.pause(); } catch (e) { /* 一处失败不拖住别处 */ }
  }
  return function () {
    var at = duties.indexOf(duty);
    if (at >= 0) duties.splice(at, 1);
  };
}

function run(method) {
  // 遍历快照：某一处在自己的 resume 里退订（splice 自己）时，不跳过排在它后面的那一处。
  var list = duties.slice();
  for (var i = 0; i < list.length; i++) {
    try { list[i][method](); } catch (e) { /* 各处自理 */ }
  }
}

/** 进入停驻。重复调用是空操作：不再次 pause，免得把恢复时要补的积压清掉。
 *  还没有登记时只记住意图，登记时补停。 */
export function pauseEmbed() {
  if (parked || pauseRequested) return;
  if (!duties.length) { pauseRequested = true; return; }
  parked = true;
  run('pause');
}

/** 从停驻恢复。没停驻时是空操作。 */
export function resumeEmbed() {
  pauseRequested = false;
  if (!parked) return;
  parked = false;
  run('resume');
}

/** 暂停意图立即生效，停驻回执等首装真正落定。打开会作废先前在途的回执。 */
export function reportEmbedPark(whenSettled, report) {
  var request = 0;
  return function (paused) {
    var token = ++request;
    if (!paused) {
      resumeEmbed();
      report(false);
      return Promise.resolve();
    }
    pauseEmbed();
    return Promise.resolve().then(whenSettled).then(function () {
      if (token === request && embedParked()) report(true);
    });
  };
}

/** 测试用：清掉登记与停驻态。生产代码不调。 */
export function resetEmbedPark() {
  duties = [];
  parked = false;
  pauseRequested = false;
}
