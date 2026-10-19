// 画布 → section → frame 的导航模型：量 DOM、查表、命中测试。焦点 / 居中 / 可用区
// 这些纯数学在 src/shared/canvas-gesture.js（与离线导出页共用），不在这里。
export const BOARD_FRAME_SELECTOR = '.wb-comp-stage, .ios-stage, .wb-html-card, .wb-screen-err';

function stageRectFor(node, stageRect, stage) {
  const rect = node.getBoundingClientRect();
  if (rect.width < 1 && rect.height < 1) return null;
  return {
    left: rect.left - stageRect.left + stage.scrollLeft,
    top: rect.top - stageRect.top + stage.scrollTop,
    width: rect.width,
    height: rect.height,
  };
}

/** Build the canonical Canvas → Section → Frame navigation model from mounted board DOM. */
export function measureBoardNavigation(stage, panel) {
  if (!stage || !panel) return null;
  const stageRect = stage.getBoundingClientRect();
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  const sections = [];
  const frames = [];

  function includeBounds(rect) {
    minLeft = Math.min(minLeft, rect.left);
    minTop = Math.min(minTop, rect.top);
    maxRight = Math.max(maxRight, rect.left + rect.width);
    maxBottom = Math.max(maxBottom, rect.top + rect.height);
  }

  const sectionNodes = panel.querySelectorAll('.wb-lib-item[data-ann-section], .wb-lib-item[data-ann-group]');
  sectionNodes.forEach((sectionNode) => {
    const rect = stageRectFor(sectionNode, stageRect, stage);
    if (!rect) return;
    const id = sectionNode.getAttribute('data-ann-section')
      || sectionNode.getAttribute('data-ann-group')
      || '';
    const heading = sectionNode.querySelector('.wb-lib-cap');
    const section = {
      kind: 'section',
      id,
      title: sectionNode.getAttribute('data-ann-section-label')
        || sectionNode.getAttribute('data-ann-group-label')
        || heading?.textContent?.trim()
        || id,
      colorIndex: sections.length,
      node: sectionNode,
      frames: [],
      ...rect,
    };
    sections.push(section);
    includeBounds(rect);

    sectionNode.querySelectorAll(BOARD_FRAME_SELECTOR).forEach((frameNode) => {
      const frameRect = stageRectFor(frameNode, stageRect, stage);
      if (!frameRect) return;
      const screenNode = frameNode.closest('.wb-screen[data-screen]');
      const screenId = screenNode?.getAttribute('data-screen') || '';
      const caption = screenNode?.querySelector('.wb-screen-cap');
      // 图注两行结构（2026-08-15）：屏名在 .wb-cap-title，引用号不进导航标题。
      const captionTitle = caption?.querySelector('.wb-cap-title')?.textContent?.trim();
      const frame = {
        kind: 'frame',
        id: screenId,
        screenId,
        sectionId: id,
        title: captionTitle || caption?.textContent?.trim() || screenId || 'Screen',
        colorIndex: section.colorIndex,
        node: frameNode,
        screenNode,
        ...frameRect,
      };
      section.frames.push(frame);
      frames.push(frame);
    });
  });

  if (!sections.length) {
    let fallbackNodes = panel.querySelectorAll(BOARD_FRAME_SELECTOR);
    if (!fallbackNodes.length) {
      const library = panel.querySelector('.wb-library');
      fallbackNodes = library ? [library] : [];
    }
    Array.from(fallbackNodes).forEach((node) => {
      const rect = stageRectFor(node, stageRect, stage);
      if (!rect) return;
      frames.push({
        kind: 'frame',
        id: '',
        screenId: '',
        sectionId: '',
        title: 'Canvas',
        colorIndex: 0,
        node,
        screenNode: null,
        ...rect,
      });
      includeBounds(rect);
    });
  }

  if (!sections.length && !frames.length) return null;
  return {
    bounds: {
      left: minLeft,
      top: minTop,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
    },
    sections,
    frames,
  };
}

export function findBoardSection(model, sectionId) {
  return model?.sections?.find((section) => section.id === sectionId) || null;
}

export function findBoardFrame(model, sectionId, screenId) {
  return model?.frames?.find((frame) => (
    frame.sectionId === sectionId && frame.screenId === screenId
  )) || null;
}

export function closestBoardSection(model, viewportCenterY) {
  let best = null;
  let bestDistance = Infinity;
  (model?.sections || []).forEach((section) => {
    const distance = Math.abs(section.top + section.height / 2 - viewportCenterY);
    if (distance < bestDistance) {
      best = section;
      bestDistance = distance;
    }
  });
  return best;
}

/** Minimap hit policy: Frame first, then Section, then the raw Canvas point. */
export function hitTestBoardNavigation(model, x, y, options = {}) {
  const framePadding = options.framePadding ?? 48;
  let bestFrame = null;
  let bestDistance = Infinity;
  (model?.frames || []).forEach((frame) => {
    const inside = (
      x >= frame.left - framePadding && x <= frame.left + frame.width + framePadding &&
      y >= frame.top - framePadding && y <= frame.top + frame.height + framePadding
    );
    if (!inside) return;
    const dx = x - (frame.left + frame.width / 2);
    const dy = y - (frame.top + frame.height / 2);
    let distance = dx * dx + dy * dy;
    const contained = (
      x >= frame.left && x <= frame.left + frame.width &&
      y >= frame.top && y <= frame.top + frame.height
    );
    if (contained) distance *= 0.25;
    if (distance < bestDistance) {
      bestFrame = frame;
      bestDistance = distance;
    }
  });
  if (bestFrame) return { kind: 'frame', target: bestFrame };

  const section = (model?.sections || []).find((entry) => (
    x >= entry.left && x <= entry.left + entry.width &&
    y >= entry.top && y <= entry.top + entry.height
  ));
  if (section) return { kind: 'section', target: section };
  return { kind: 'canvas', target: { x, y } };
}
