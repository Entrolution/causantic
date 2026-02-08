#!/usr/bin/env python3
"""
Fast HDBSCAN clustering using Python's Cython-accelerated implementation.
Reads embeddings from stdin as JSON, outputs cluster labels.

Usage:
  pip install hdbscan numpy
  cat embeddings.json | python hdbscan-python.py --min-cluster-size 4
"""

import sys
import json
import argparse
from typing import List

def main():
    parser = argparse.ArgumentParser(description='HDBSCAN clustering')
    parser.add_argument('--min-cluster-size', type=int, default=4)
    parser.add_argument('--min-samples', type=int, default=None)
    parser.add_argument('--metric', type=str, default='euclidean',
                        help='Distance metric (use euclidean on normalized vectors for cosine)')
    parser.add_argument('--core-dist-n-jobs', type=int, default=-1,
                        help='Number of parallel jobs (-1 = all cores)')
    args = parser.parse_args()

    min_samples = args.min_samples or args.min_cluster_size

    # Read embeddings from stdin
    try:
        import numpy as np
        import hdbscan
    except ImportError as e:
        print(json.dumps({
            'error': f'Missing dependency: {e}. Install with: pip install hdbscan numpy'
        }))
        sys.exit(1)

    # Read input
    data = json.load(sys.stdin)
    ids = data['ids']
    embeddings = np.array(data['embeddings'], dtype=np.float32)

    # L2 normalize for euclidean metric (equivalent to cosine distance)
    if args.metric == 'euclidean':
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.clip(norms, 1e-8, None)

    print(f"Clustering {len(ids)} vectors with HDBSCAN...", file=sys.stderr)
    print(f"  min_cluster_size={args.min_cluster_size}", file=sys.stderr)
    print(f"  min_samples={min_samples}", file=sys.stderr)
    print(f"  metric={args.metric}", file=sys.stderr)
    print(f"  core_dist_n_jobs={args.core_dist_n_jobs}", file=sys.stderr)

    # Run HDBSCAN with parallel core distance computation
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=args.min_cluster_size,
        min_samples=min_samples,
        metric=args.metric,
        core_dist_n_jobs=args.core_dist_n_jobs,
    )

    labels = clusterer.fit_predict(embeddings)

    # Output results
    result = {
        'labels': labels.tolist(),
        'ids': ids,
        'n_clusters': int(labels.max() + 1) if labels.max() >= 0 else 0,
        'n_noise': int((labels == -1).sum()),
    }

    print(f"Found {result['n_clusters']} clusters, {result['n_noise']} noise points",
          file=sys.stderr)

    print(json.dumps(result))

if __name__ == '__main__':
    main()
