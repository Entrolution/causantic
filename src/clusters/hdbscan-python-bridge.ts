/**
 * Bridge to Python HDBSCAN for faster clustering.
 * Uses Cython-accelerated HDBSCAN with parallel core distance computation.
 *
 * Requires: pip install hdbscan numpy
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PythonHDBSCANOptions {
  minClusterSize: number;
  minSamples?: number;
  /** Number of parallel jobs (-1 = all cores) */
  nJobs?: number;
}

export interface PythonHDBSCANResult {
  labels: number[];
  ids: string[];
  n_clusters: number;
  n_noise: number;
}

/**
 * Run HDBSCAN clustering using Python's Cython-accelerated implementation.
 * Much faster than pure JS for large datasets.
 */
export async function runPythonHDBSCAN(
  ids: string[],
  embeddings: number[][],
  options: PythonHDBSCANOptions
): Promise<PythonHDBSCANResult> {
  const scriptPath = join(__dirname, '../../scripts/hdbscan-python.py');

  const args = [
    scriptPath,
    '--min-cluster-size', String(options.minClusterSize),
    '--min-samples', String(options.minSamples ?? options.minClusterSize),
    '--core-dist-n-jobs', String(options.nJobs ?? -1),
    '--metric', 'euclidean', // Use euclidean on normalized vectors
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
      // Log progress messages
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

/**
 * Check if Python HDBSCAN is available.
 */
export async function isPythonHDBSCANAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', 'import hdbscan, numpy'], {
      stdio: 'pipe',
    });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}
