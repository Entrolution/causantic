# Embedding Model Experiments

This document details the experiments comparing embedding models for Causantic.

## Hypothesis

Different embedding models offer trade-offs between quality, size, and inference speed. The optimal model balances these factors for Causantic's use case.

## Methodology

### Models Tested

| Model         | Dimensions | Size |
| ------------- | ---------- | ---- |
| jina-small    | 512        | 33M  |
| jina-base     | 768        | 137M |
| all-MiniLM-L6 | 384        | 22M  |
| bge-small     | 384        | 33M  |
| e5-small      | 384        | 33M  |

### Metrics

- **Silhouette Score**: Cluster separation quality
- **Retrieval MRR**: Mean reciprocal rank on retrieval tasks
- **Inference Speed**: Embeddings per second
- **Memory Usage**: Peak memory during inference

### Dataset

- 294 chunks from 12 sessions
- Known topic labels for clustering evaluation
- Query-document pairs for retrieval evaluation

## Results

### Quality Metrics

| Model         | Silhouette | MRR   | ROC AUC |
| ------------- | ---------- | ----- | ------- |
| jina-small    | 0.412      | 0.687 | 0.891   |
| jina-base     | 0.438      | 0.712 | 0.903   |
| all-MiniLM-L6 | 0.389      | 0.654 | 0.867   |
| bge-small     | 0.401      | 0.671 | 0.882   |
| e5-small      | 0.395      | 0.668 | 0.879   |

### Performance Metrics

| Model         | Embeddings/sec | Memory (MB) |
| ------------- | -------------- | ----------- |
| jina-small    | 145            | 180         |
| jina-base     | 67             | 420         |
| all-MiniLM-L6 | 312            | 95          |
| bge-small     | 178            | 150         |
| e5-small      | 189            | 145         |

## Analysis

### Trade-off Visualization

```
Quality (MRR)
0.72 │           ● jina-base
     │
0.69 │     ● jina-small
     │
0.66 │ ● MiniLM  ● bge  ● e5
     │
     ├──────────────────────────
        100   150   200   300  Embed/sec
```

### Model Selection

**Winner**: jina-small

Rationale:

- 97% of jina-base quality at 2.2x speed
- Best quality-to-speed ratio
- Reasonable memory footprint
- Well-suited for interactive use

### When to Consider Alternatives

| Use Case          | Recommendation       |
| ----------------- | -------------------- |
| Maximum quality   | jina-base            |
| Minimum resources | all-MiniLM-L6        |
| Balanced          | jina-small (default) |

## Implementation

Causantic uses jina-small via Hugging Face Transformers:

```typescript
import { pipeline } from '@huggingface/transformers';

const embedder = await pipeline('feature-extraction', 'jinaai/jina-embeddings-v2-small-en');

async function embed(text: string): Promise<number[]> {
  const result = await embedder(text, {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(result.data);
}
```

## Configuration

To change the embedding model:

```typescript
// In src/models/embedder.ts
const MODEL_NAME = 'jinaai/jina-embeddings-v2-small-en';
```

Note: Changing models requires re-embedding all chunks.

## Follow-Up Experiments

Five targeted experiments on jina-small validated the production recommendation:

| Experiment              | Baseline AUC | Variant AUC | Delta AUC  | Baseline Silh. | Variant Silh. | Delta Silh. |
| ----------------------- | ------------ | ----------- | ---------- | -------------- | ------------- | ----------- |
| Truncation (512 tokens) | 0.715        | 0.671       | **-0.044** | 0.384          | 0.229         | **-0.155**  |
| Boilerplate filter      | 0.715        | 0.720       | +0.004     | 0.384          | 0.395         | +0.011      |
| Thinking block ablation | 0.715        | 0.778       | **+0.063** | 0.384          | 0.376         | -0.009      |
| Code-focused mode       | 0.715        | 0.761       | +0.045     | 0.384          | 0.356         | -0.028      |

### Key Findings

1. **Exclude thinking blocks** (+0.063 AUC): Largest single improvement. Thinking blocks contain diffuse reasoning that dilutes the embedding signal.
2. **Use `minClusterSize=4`** (silhouette 0.438 vs 0.384 at 3): Free improvement — no re-embedding needed. Swept from 2 to 10.
3. **Keep full 8K context**: Truncation to 512 tokens costs -0.044 AUC and -0.155 silhouette. The tail content of chunks carries significant discriminative information.
4. **Boilerplate filtering**: Small but consistent gain. jina-small's 8K context already sees past boilerplate, unlike bge-small.

See [full benchmark results](../archive/embedding-benchmark-results.md) for detailed per-experiment analysis.

## Reproducibility

Run the embedding benchmark:

```bash
npm run benchmark
```

Results are saved to `benchmark-results/embeddings/`.
