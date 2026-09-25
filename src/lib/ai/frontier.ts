export interface ModelCheckable {
  modelId?: string;
  id?: string;
  name?: string;
  displayName?: string;
}

/**
 * Identifies if an AI model is considered a "Frontier" model.
 * Frontier models are high-end, premium models (Claude, GPT-4/5/6, Grok, Opus, Sonnet, etc.)
 * which require authenticated Admin access.
 */
export function isFrontierModel(model: ModelCheckable | string): boolean {
  if (!model) return false;
  
  const m = typeof model === 'string' ? { modelId: model } : model;
  const modelId = (m.modelId || m.id || m.name || '').toLowerCase();
  const displayName = (m.displayName || '').toLowerCase();

  // Explicit free models are never frontier
  if (
    modelId.includes(':free') ||
    modelId.startsWith('free/') ||
    displayName.includes('free') ||
    modelId.includes('dev-reasoning') ||
    modelId.includes('gemma-2-2b')
  ) {
    return false;
  }

  const frontierKeywords = [
    'claude',
    'gpt-4',
    'gpt-5',
    'gpt-6',
    'o1-',
    'o3-',
    'grok',
    'sonnet',
    'opus',
    'fable',
    'mythos',
    'kimi-k3',
    'max',
    'gemini-3.1-pro',
    'deepseek-v4-pro',
  ];

  return frontierKeywords.some((kw) => modelId.includes(kw) || displayName.includes(kw));
}
