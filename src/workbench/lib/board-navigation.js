// 画布 → section → frame 的几何模型：量 DOM、查表。焦点 / 居中 / 可用区
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
    const section = {
      id,
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
      const frame = {
        screenId,
        sectionId: id,
        node: frameNode,
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
        screenId: '',
        sectionId: '',
        node,
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
