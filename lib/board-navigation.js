export const BOARD_FRAME_SELECTOR = '.wb-comp-stage, .ios-stage, .wb-screen-err';

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
      const frame = {
        kind: 'frame',
        id: screenId,
        screenId,
        sectionId: id,
        title: caption?.textContent?.trim() || screenId || 'Screen',
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function focusAxis(start, size, viewportSize, inset) {
  if (size + inset * 2 <= viewportSize) {
    return start + size / 2 - viewportSize / 2;
  }
  return start - inset;
}

/** Center targets that fit; top/left-align oversized targets so their beginning stays visible. */
export function focusScrollForRect(rect, viewport, options = {}) {
  const inset = options.inset ?? 24;
  const maxLeft = Math.max(0, viewport.scrollWidth - viewport.width);
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.height);
  return {
    left: clamp(focusAxis(rect.left, rect.width, viewport.width, inset), 0, maxLeft),
    top: clamp(focusAxis(rect.top, rect.height, viewport.height, inset), 0, maxTop),
  };
}

export function centerScrollForPoint(point, viewport) {
  return {
    left: clamp(point.x - viewport.width / 2, 0, Math.max(0, viewport.scrollWidth - viewport.width)),
    top: clamp(point.y - viewport.height / 2, 0, Math.max(0, viewport.scrollHeight - viewport.height)),
  };
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
