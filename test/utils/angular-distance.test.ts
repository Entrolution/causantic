/**
 * Tests for angular distance utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  dot,
  norm,
  cosineSimilarity,
  angularDistance,
  distanceMatrix,
} from '../../src/utils/angular-distance.js';

describe('dot', () => {
  it('computes dot product of two vectors', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(dot([1, 0], [0, 1])).toBe(0);
  });

  it('handles single-element vectors', () => {
    expect(dot([3], [4])).toBe(12);
  });
});

describe('norm', () => {
  it('computes L2 norm', () => {
    expect(norm([3, 4])).toBe(5);
  });

  it('returns 0 for zero vector', () => {
    expect(norm([0, 0, 0])).toBe(0);
  });

  it('returns 1 for unit vector', () => {
    expect(norm([1, 0, 0])).toBe(1);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 1 for parallel vectors (different magnitude)', () => {
    expect(cosineSimilarity([1, 0], [5, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it('clamps to [-1, 1] for numerical stability', () => {
    const result = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('angularDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(angularDistance([1, 2, 3], [1, 2, 3])).toBeCloseTo(0);
  });

  it('returns 0.5 for orthogonal vectors', () => {
    expect(angularDistance([1, 0], [0, 1])).toBeCloseTo(0.5);
  });

  it('returns 1 for opposite vectors', () => {
    expect(angularDistance([1, 0], [-1, 0])).toBeCloseTo(1);
  });

  it('returns values in [0, 1]', () => {
    const d = angularDistance([1, 2], [3, -1]);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(1);
  });

  it('is symmetric', () => {
    const a = [1, 2, 3];
    const b = [4, -1, 2];
    expect(angularDistance(a, b)).toBeCloseTo(angularDistance(b, a));
  });
});

describe('distanceMatrix', () => {
  it('returns zero diagonal', () => {
    const embeddings = [
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const matrix = distanceMatrix(embeddings);

    for (let i = 0; i < embeddings.length; i++) {
      expect(matrix[i][i]).toBe(0);
    }
  });

  it('is symmetric', () => {
    const embeddings = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const matrix = distanceMatrix(embeddings);

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = 0; j < embeddings.length; j++) {
        expect(matrix[i][j]).toBeCloseTo(matrix[j][i]);
      }
    }
  });

  it('computes correct dimensions', () => {
    const embeddings = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    const matrix = distanceMatrix(embeddings);

    expect(matrix).toHaveLength(4);
    for (const row of matrix) {
      expect(row).toHaveLength(4);
    }
  });

  it('handles single embedding', () => {
    const matrix = distanceMatrix([[1, 2, 3]]);
    expect(matrix).toEqual([[0]]);
  });
});
