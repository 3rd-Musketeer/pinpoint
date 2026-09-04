import { ExportDocContractError } from './export-doc-contract.js';
import { formatTokenCount } from './export-doc-tokens.js';

/** Round half to even — matches Anthropic's published reference (Python round). */
export function roundTiesToEven(value) {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

export function anthropicImageTokensRaw(width, height) {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/**
 * Size Claude sees before padding.
 * High-resolution tier defaults (Opus 4.7+ / Opus 5): maxEdge=2576, maxTokens=4784.
 * @see https://platform.claude.com/docs/en/build-with-claude/vision-coordinates
 */
export function anthropicResizedSize(width, height, maxEdge = 2576, maxTokens = 4784) {
  const fits = (w, h) => (
    Math.ceil(w / 28) * 28 <= maxEdge
    && Math.ceil(h / 28) * 28 <= maxEdge
    && anthropicImageTokensRaw(w, h) <= maxTokens
  );

  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [resizedH, resizedW] = anthropicResizedSize(height, width, maxEdge, maxTokens);
    return [resizedW, resizedH];
  }

  const aspectRatio = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspectRatio), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundTiesToEven(lo / aspectRatio), 1)];
}

export function estimateAnthropicImageTokens(width, height) {
  const [w, h] = anthropicResizedSize(width, height);
  const tokens = anthropicImageTokensRaw(w, h);
  return {
    tokens,
    resizedWidth: w,
    resizedHeight: h,
    capped: w !== width || h !== height,
    detail: '28×28 patches · high-res tier（≤4784）',
  };
}

/**
 * OpenAI patch-based tokenization (GPT-5.4 / 5.5 `detail=high` style).
 * 32×32 patches, shrink to fit patchBudget and maxEdge.
 * @see https://developers.openai.com/api/docs/guides/images-vision
 */
export function estimateOpenAIImageTokens(width, height, {
  patchBudget = 2500,
  maxEdge = 2048,
  multiplier = 1,
} = {}) {
  let w = width;
  let h = height;
  const maxSide = Math.max(w, h);
  if (maxSide > maxEdge) {
    const scale = maxEdge / maxSide;
    w *= scale;
    h *= scale;
  }

  let patches = Math.ceil(w / 32) * Math.ceil(h / 32);
  let capped = maxSide > maxEdge;
  if (patches > patchBudget) {
    const shrinkFactor = Math.sqrt((32 * 32 * patchBudget) / (w * h));
    const adjusted = shrinkFactor * Math.min(
      Math.floor(w * shrinkFactor / 32) / (w * shrinkFactor / 32),
      Math.floor(h * shrinkFactor / 32) / (h * shrinkFactor / 32),
    );
    w = Math.max(1, w * adjusted);
    h = Math.max(1, h * adjusted);
    patches = Math.ceil(w / 32) * Math.ceil(h / 32);
    capped = true;
  }
  patches = Math.min(patches, patchBudget);
  const tokens = Math.round(patches * multiplier);
  return {
    tokens,
    patches,
    resizedWidth: Math.round(w),
    resizedHeight: Math.round(h),
    capped,
    detail: '32×32 patches · detail=high（≤2500）',
  };
}

/**
 * Gemini 3 media_resolution budgets (fixed per image, not pixel-linear).
 * Default / unspecified for images ≈ high = 1120.
 * @see https://ai.google.dev/gemini-api/docs/media-resolution
 */
export function estimateGeminiImageTokens(width, height, {
  resolution = 'high',
} = {}) {
  const table = {
    low: 280,
    medium: 560,
    high: 1120,
    ultra_high: 2240,
  };
  const tokens = table[resolution] ?? table.high;
  return {
    tokens,
    resizedWidth: width,
    resizedHeight: height,
    capped: false,
    detail: `media_resolution=${resolution} · Gemini 3 固定档`,
  };
}

export function estimateImageTokens(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    throw new ExportDocContractError('size', 'expected positive width and height');
  }
  const openai = estimateOpenAIImageTokens(w, h);
  const anthropic = estimateAnthropicImageTokens(w, h);
  const gemini = estimateGeminiImageTokens(w, h);

  const providers = [
    {
      id: 'gemini',
      label: 'Gemini',
      detail: gemini.detail,
      tokens: gemini.tokens,
      display: formatTokenCount(gemini.tokens),
      capped: gemini.capped,
    },
    {
      id: 'openai',
      label: 'OpenAI',
      detail: openai.detail + (openai.capped ? ' · 已缩小' : ''),
      tokens: openai.tokens,
      display: formatTokenCount(openai.tokens),
      capped: openai.capped,
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      detail: anthropic.detail + (anthropic.capped ? ' · 已缩小' : ''),
      tokens: anthropic.tokens,
      display: formatTokenCount(anthropic.tokens),
      capped: anthropic.capped,
    },
  ];

  return {
    mode: 'image',
    width: Math.round(w),
    height: Math.round(h),
    counts: {
      gemini: gemini.tokens,
      openai: openai.tokens,
      anthropic: anthropic.tokens,
    },
    providers,
  };
}
