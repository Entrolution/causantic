import { describe, it, expect } from 'vitest';
import { angularDistance, cosineSimilarity, dot, norm, distanceMatrix } from '../../src/utils/angular-distance.js';
import { rocAuc, silhouetteScore, noiseRatio, clusterCount } from '../../src/eval/metrics.js';
import type { LabeledPair } from '../../src/eval/annotation-schema.js';
import type { ScoredPair } from '../../src/eval/metrics.js';

describe('angular distance', () => {
  it('returns 0 for identical vectors', () => {
    const v = [1, 0, 0];
    expect(angularDistance(v, v)).toBeCloseTo(0, 5);
  });

  it('returns 0.5 for orthogonal vectors', () => {
    expect(angularDistance([1, 0], [0, 1])).toBeCloseTo(0.5, 5);
  });

  it('returns 1 for opposite vectors', () => {
    expect(angularDistance([1, 0], [-1, 0])).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(angularDistance(a, b)).toBeCloseTo(angularDistance(b, a), 10);
  });
});

describe('cosine similarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('handles zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('distance matrix', () => {
  it('produces symmetric matrix with zero diagonal', () => {
    const embeddings = [[1, 0], [0, 1], [-1, 0]];
    const matrix = distanceMatrix(embeddings);

    expect(matrix.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(matrix[i][i]).toBeCloseTo(0, 5);
      for (let j = i + 1; j < 3; j++) {
        expect(matrix[i][j]).toBeCloseTo(matrix[j][i], 10);
      }
    }
  });
});

describe('ROC AUC', () => {
  it('returns 1.0 for perfect separation', () => {
    const scored: ScoredPair[] = [
      // Related pairs with small distance
      { pair: { chunkIdA: 'a', chunkIdB: 'b', label: 'related', confidence: 'high', source: 'test' }, distance: 0.1 },
      { pair: { chunkIdA: 'c', chunkIdB: 'd', label: 'related', confidence: 'high', source: 'test' }, distance: 0.2 },
      // Unrelated pairs with large distance
      { pair: { chunkIdA: 'e', chunkIdB: 'f', label: 'unrelated', confidence: 'high', source: 'test' }, distance: 0.8 },
      { pair: { chunkIdA: 'g', chunkIdB: 'h', label: 'unrelated', confidence: 'high', source: 'test' }, distance: 0.9 },
    ];

    expect(rocAuc(scored)).toBe(1.0);
  });

  it('returns 0.5 for random ordering', () => {
    const scored: ScoredPair[] = [
      { pair: { chunkIdA: 'a', chunkIdB: 'b', label: 'related', confidence: 'high', source: 'test' }, distance: 0.5 },
      { pair: { chunkIdA: 'c', chunkIdB: 'd', label: 'unrelated', confidence: 'high', source: 'test' }, distance: 0.5 },
    ];

    expect(rocAuc(scored)).toBe(0.5);
  });

  it('returns 0.0 for perfectly wrong separation', () => {
    const scored: ScoredPair[] = [
      { pair: { chunkIdA: 'a', chunkIdB: 'b', label: 'related', confidence: 'high', source: 'test' }, distance: 0.9 },
      { pair: { chunkIdA: 'c', chunkIdB: 'd', label: 'unrelated', confidence: 'high', source: 'test' }, distance: 0.1 },
    ];

    expect(rocAuc(scored)).toBe(0.0);
  });
});

describe('silhouette score', () => {
  it('returns positive score for well-separated clusters', () => {
    // Two clearly separated clusters
    const embeddings = [
      [1, 0], [0.9, 0.1], [0.8, 0.2],   // Cluster 0
      [0, 1], [0.1, 0.9], [0.2, 0.8],   // Cluster 1
    ];
    const labels = [0, 0, 0, 1, 1, 1];

    const score = silhouetteScore(embeddings, labels);
    expect(score).toBeGreaterThan(0);
  });

  it('handles noise points (label -1)', () => {
    const embeddings = [[1, 0], [0, 1], [0.5, 0.5]];
    const labels = [0, 1, -1]; // -1 = noise

    // Should not throw, noise points are skipped
    const score = silhouetteScore(embeddings, labels);
    expect(typeof score).toBe('number');
  });

  it('returns 0 for single cluster', () => {
    const embeddings = [[1, 0], [0.9, 0.1], [0.8, 0.2]];
    const labels = [0, 0, 0];

    expect(silhouetteScore(embeddings, labels)).toBe(0);
  });
});

describe('noiseRatio', () => {
  it('computes correctly', () => {
    expect(noiseRatio([-1, -1, 0, 1])).toBe(0.5);
    expect(noiseRatio([0, 1, 2])).toBe(0);
    expect(noiseRatio([-1, -1])).toBe(1);
  });
});

describe('clusterCount', () => {
  it('counts unique clusters excluding noise', () => {
    expect(clusterCount([-1, 0, 1, 0, 2, -1])).toBe(3);
    expect(clusterCount([-1, -1])).toBe(0);
    expect(clusterCount([0, 0, 0])).toBe(1);
  });
});
