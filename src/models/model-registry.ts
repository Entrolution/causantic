/**
 * Model configurations for embedding model candidates.
 */

export interface ModelConfig {
  /** Short identifier. */
  id: string;
  /** HuggingFace model ID. */
  hfId: string;
  /** Embedding dimensions. */
  dims: number;
  /** Context window in tokens. */
  contextTokens: number;
  /** Whether the model uses task prefixes (e.g. nomic). */
  usesPrefix: boolean;
  /** Prefix for document embedding (if usesPrefix). */
  documentPrefix: string;
  /** Prefix for query embedding (if usesPrefix). */
  queryPrefix: string;
  /** Notes about the model. */
  notes: string;
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'nomic-v1.5': {
    id: 'nomic-v1.5',
    hfId: 'nomic-ai/nomic-embed-text-v1.5',
    dims: 768,
    contextTokens: 8192,
    usesPrefix: true,
    documentPrefix: 'search_document: ',
    queryPrefix: 'search_query: ',
    notes: 'Matryoshka dimensions (768/512/384/256/128). Needs task prefixes.',
  },
  'jina-code': {
    id: 'jina-code',
    hfId: 'jinaai/jina-embeddings-v2-base-code',
    dims: 768,
    contextTokens: 8192,
    usesPrefix: false,
    documentPrefix: '',
    queryPrefix: '',
    notes: 'Code-specialized. ONNX availability needs validation.',
  },
  'jina-small': {
    id: 'jina-small',
    hfId: 'Xenova/jina-embeddings-v2-small-en',
    dims: 512,
    contextTokens: 8192,
    usesPrefix: false,
    documentPrefix: '',
    queryPrefix: '',
    notes: 'Confirmed ONNX via Xenova.',
  },
  'bge-small': {
    id: 'bge-small',
    hfId: 'Xenova/bge-small-en-v1.5',
    dims: 384,
    contextTokens: 512,
    usesPrefix: false,
    documentPrefix: '',
    queryPrefix: '',
    notes: 'Baseline, smallest model. 512 token context limit.',
  },
};

export function getModel(id: string): ModelConfig {
  const config = MODEL_REGISTRY[id];
  if (!config) {
    throw new Error(
      `Unknown model: ${id}. Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`,
    );
  }
  return config;
}

export function getAllModelIds(): string[] {
  return Object.keys(MODEL_REGISTRY);
}
