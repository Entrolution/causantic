/**
 * Fast HDBSCAN clustering using Python's Cython-accelerated implementation.
 * Much faster than pure JS hdbscan-ts for large datasets.
 *
 * Usage: npm run recluster-fast
 * Requires: pip install hdbscan numpy
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { vectorStore } from '../src/storage/vector-store.js';
import {
  upsertCluster,
  assignChunksToClusters,
  clearAllClusters,
  computeMembershipHash,
} from '../src/storage/cluster-store.js';
import { angularDistance } from '../src/utils/angular-distance.js';
import { generateId, getDbStats, closeDb } from '../src/storage/db.js';
import type { ChunkClusterAssignment } from '../src/storage/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PythonHDBSCANResult {
  labels: number[];
  ids: string[];
  n_clusters: number;
  n_noise: number;
}

async function runPythonHDBSCAN(
  ids: string[],
  embeddings: number[][],
  minClusterSize: number,
): Promise<PythonHDBSCANResult> {
  const scriptPath = join(__dirname, 'hdbscan-python.py');

  const args = [
    scriptPath,
    '--min-cluster-size',
    String(minClusterSize),
    '--min-samples',
    String(minClusterSize),
    '--core-dist-n-jobs',
    '-1', // Use all cores
    '--metric',
    'euclidean',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python HDBSCAN: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python HDBSCAN failed (code ${code}): ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        resolve(result as PythonHDBSCANResult);
      } catch (e) {
        reject(new Error(`Failed to parse HDBSCAN output: ${e}`));
      }
    });

    // Send embeddings to stdin
    const input = JSON.stringify({ ids, embeddings });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];

  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      sum[i] += emb[i];
    }
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    sum[i] /= embeddings.length;
    norm += sum[i] * sum[i];
  }

  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      sum[i] /= norm;
    }
  }

  return sum;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let minClusterSize = 4;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min-size' && args[i + 1]) {
      minClusterSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Usage: npm run recluster-fast -- [options]

Options:
  --min-size <n>    Minimum cluster size (default: 4)
  --help            Show this help message

Requires: pip install hdbscan numpy
      `);
      process.exit(0);
    }
  }

  const startTime = Date.now();

  // Get initial stats
  const beforeStats = getDbStats();
  console.log(`\nBefore clustering:`);
  console.log(`  Chunks:    ${beforeStats.chunks}`);
  console.log(`  Clusters:  ${beforeStats.clusters}`);

  // Clear existing clusters
  console.log(`\nClearing existing clusters...`);
  clearAllClusters();

  // Get all vectors
  console.log(`\nLoading vectors...`);
  const vectors = await vectorStore.getAllVectors();
  console.log(`  Loaded ${vectors.length} vectors`);

  if (vectors.length === 0) {
    console.log('No vectors to cluster');
    closeDb();
    return;
  }

  // Run Python HDBSCAN
  console.log(`\nRunning HDBSCAN (Python, parallel)...`);
  const ids = vectors.map((v) => v.id);
  const embeddings = vectors.map((v) => v.embedding);

  const hdbscanResult = await runPythonHDBSCAN(ids, embeddings, minClusterSize);

  console.log(`\nProcessing ${hdbscanResult.n_clusters} clusters...`);

  // Group by cluster
  const clusterMembers = new Map<number, Array<{ id: string; embedding: number[] }>>();
  for (let i = 0; i < hdbscanResult.labels.length; i++) {
    const label = hdbscanResult.labels[i];
    if (label < 0) continue; // Skip noise

    if (!clusterMembers.has(label)) {
      clusterMembers.set(label, []);
    }
    clusterMembers.get(label)!.push(vectors[i]);
  }

  // Create clusters and assignments
  const assignments: ChunkClusterAssignment[] = [];
  const clusterSizes: number[] = [];

  for (const [label, members] of clusterMembers) {
    // Compute centroid
    const centroid = computeCentroid(members.map((m) => m.embedding));

    // Select exemplars (closest to centroid)
    const withDistances = members.map((m) => ({
      ...m,
      distance: angularDistance(m.embedding, centroid),
    }));
    withDistances.sort((a, b) => a.distance - b.distance);
    const exemplarIds = withDistances.slice(0, 3).map((m) => m.id);

    // Compute membership hash
    const memberIds = members.map((m) => m.id);
    const membershipHash = computeMembershipHash(memberIds);

    // Create cluster
    const clusterId = generateId();
    upsertCluster({
      id: clusterId,
      name: `Cluster ${label}`,
      centroid,
      exemplarIds,
      membershipHash,
    });

    // Create assignments
    for (const m of withDistances) {
      assignments.push({
        chunkId: m.id,
        clusterId,
        distance: m.distance,
      });
    }

    clusterSizes.push(members.length);
  }

  // Batch insert assignments
  if (assignments.length > 0) {
    assignChunksToClusters(assignments);
  }

  const durationMs = Date.now() - startTime;

  console.log(`\n=== Clustering Complete ===`);
  console.log(`Clusters found:      ${clusterMembers.size}`);
  console.log(`Chunks assigned:     ${assignments.length}`);
  console.log(`Noise chunks:        ${hdbscanResult.n_noise}`);
  console.log(
    `Noise ratio:         ${((hdbscanResult.n_noise / vectors.length) * 100).toFixed(1)}%`,
  );
  console.log(`Duration:            ${(durationMs / 1000).toFixed(1)}s`);

  if (clusterSizes.length > 0) {
    clusterSizes.sort((a, b) => b - a);
    console.log(`\nCluster sizes (top 10):`);
    for (let i = 0; i < Math.min(10, clusterSizes.length); i++) {
      console.log(`  Cluster ${i + 1}: ${clusterSizes[i]} chunks`);
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
