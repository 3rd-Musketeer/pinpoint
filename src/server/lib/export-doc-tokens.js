import { countTokens } from 'bpe-lite';

import { ExportDocContractError, stripDocumentCss } from './export-doc-contract.js';

/** Local tokenizer labels → which provider / model family they approximate. */
export const DOC_TOKEN_PROVIDERS = [
  {
    id: 'gemini',
    label: 'Gemini',
    provider: 'gemini',
    // Gemma 3 SentencePiece — what current Gemini text models tokenize with offline.
    detail: 'Gemma 3 SPM · Gemini 文本模型',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai-o200k',
    // o200k_base — GPT-4o / GPT-4.1 / GPT-5 / o-series.
    detail: 'o200k · GPT-5 / GPT-4o',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    // Community Claude BPE. Claude 4.7+ / Opus 5 use a newer tokenizer (~+30% on same text).
    detail: 'Claude BPE · 本地估算（4.7+ 可能约 +30%）',
  },
];

export function prepareDocTextForTokens(html, mode) {
  if (typeof html !== 'string') throw new ExportDocContractError('html', 'expected a string');
  if (mode === 'html-no-css') return stripDocumentCss(html);
  if (mode === 'html-full') return html;
  throw new ExportDocContractError('mode', 'token estimates only apply to html-full / html-no-css');
}

export function countDocTokens(text) {
  if (typeof text !== 'string') throw new ExportDocContractError('text', 'expected a string');
  const counts = {};
  for (const item of DOC_TOKEN_PROVIDERS) {
    counts[item.id] = countTokens(text, item.provider);
  }
  return counts;
}

export function formatTokenCount(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return String(Math.round(value));
  if (value < 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

export function estimateDocTokens(html, mode) {
  const text = prepareDocTextForTokens(html, mode);
  const counts = countDocTokens(text);
  return {
    mode,
    chars: text.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    counts,
    providers: DOC_TOKEN_PROVIDERS.map((item) => ({
      id: item.id,
      label: item.label,
      detail: item.detail,
      tokens: counts[item.id],
      display: formatTokenCount(counts[item.id]),
    })),
  };
}
