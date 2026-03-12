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
  /** Pooling strategy: 'mean' (default) or 'cls'. */
  pooling: 'mean' | 'cls';
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
    pooling: 'mean',

    usesPrefix: true,
    documentPrefix: 'search_document: ',
    queryPrefix: 'search_query: ',
    notes: 'Matryoshka dimensions (768/512/384/256/128). Needs task prefixes.',
  },
  'arctic-embed-m': {
    id: 'arctic-embed-m',
    hfId: 'Snowflake/snowflake-arctic-embed-m-v1.5',
    dims: 768,
    contextTokens: 512,
    pooling: 'cls',

    usesPrefix: true,
    documentPrefix: '',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    notes: 'BertModel, CLS pooling. Matryoshka (768/256). MTEB retrieval 55.1. 512 token context.',
  },
  'jina-code': {
    id: 'jina-code',
    hfId: 'jinaai/jina-embeddings-v2-base-code',
    dims: 768,
    contextTokens: 8192,
    pooling: 'mean',

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
    pooling: 'mean',

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
    pooling: 'cls',

    usesPrefix: false,
    documentPrefix: '',
    queryPrefix: '',
    notes: 'Baseline, smallest model. 512 token context limit.',
  },
};

export function getModel(id: string): ModelConfig {
  const config = MODEL_REGISTRY[id];
  if (!config) {
    throw new Error(`Unknown model: ${id}. Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`);
  }
  return config;
}

export function getAllModelIds(): string[] {
  return Object.keys(MODEL_REGISTRY);
}
