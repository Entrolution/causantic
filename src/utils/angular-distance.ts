/**
 * Angular distance utilities for embedding comparison.
 *
 * Angular distance = arccos(cosine_similarity) / pi
 * Yields [0, 1] where 0 = identical, 1 = opposite.
 * This is a proper metric (satisfies triangle inequality)
 * and works well with HDBSCAN.
 */

/**
 * Compute the dot product of two vectors.
 */
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Compute the L2 norm of a vector.
 */
export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Cosine similarity between two vectors. Returns [-1, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const d = dot(a, b);
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  // Clamp to [-1, 1] to handle floating point errors
  return Math.max(-1, Math.min(1, d / (na * nb)));
}

/**
 * Angular distance between two vectors. Returns [0, 1].
 * 0 = identical direction, 1 = opposite direction.
 */
export function angularDistance(a: number[], b: number[]): number {
  const cos = cosineSimilarity(a, b);
  return Math.acos(cos) / Math.PI;
}

/**
 * Compute pairwise angular distance matrix.
 * Returns a flat number[][] suitable for HDBSCAN.
 */
export function distanceMatrix(embeddings: number[][]): number[][] {
  const n = embeddings.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = angularDistance(embeddings[i], embeddings[j]);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }

  return matrix;
}
