# HDBSCAN Performance: JavaScript vs Python

This document explains ECM's HDBSCAN implementation choice and the performance considerations.

## The Problem

HDBSCAN clustering is computationally intensive. ECM needs to cluster thousands of embedding vectors efficiently.

### JavaScript Implementation (hdbscan-ts)

The npm package `hdbscan-ts` has a performance issue in its `findClusterContainingPoints` function:

```javascript
// Problematic pattern in hdbscan-ts
for (const point of points) {           // O(n)
  for (const cluster of clusters) {     // O(k)
    if (cluster.includes(point)) {      // O(n) - Array.includes is linear!
      // ...
    }
  }
}
```

This results in O(n² × k) complexity where n is points and k is clusters. For large datasets, this becomes prohibitive.

### Benchmark Results

| Points | hdbscan-ts (JS) | hdbscan (Python) | Speedup |
|--------|-----------------|------------------|---------|
| 100 | 0.3s | 0.1s | 3x |
| 1,000 | 12s | 0.5s | 24x |
| 6,000 | 65+ min | 17s | 220x |

## ECM's Solution

ECM uses a Python bridge to the Cython-accelerated HDBSCAN implementation:

```typescript
// src/clusters/hdbscan-python-bridge.ts
import { execSync } from 'node:child_process';

export function clusterWithPython(embeddings: number[][]): ClusterResult {
  const input = JSON.stringify(embeddings);
  const result = execSync(
    `python3 -c "
import sys
import json
import hdbscan
import numpy as np

data = json.loads(sys.stdin.read())
embeddings = np.array(data)
clusterer = hdbscan.HDBSCAN(min_cluster_size=4, metric='euclidean')
labels = clusterer.fit_predict(embeddings)
print(json.dumps(labels.tolist()))
"`,
    { input, encoding: 'utf-8' }
  );
  return JSON.parse(result);
}
```

### Fallback Behavior

If Python or HDBSCAN is not available, ECM falls back to the JavaScript implementation with a warning:

```
Warning: Python HDBSCAN not available. Using JavaScript fallback.
This may be significantly slower for large datasets.
Install with: pip install hdbscan numpy
```

## Installation Requirements

### Recommended (Fast)

```bash
pip install hdbscan numpy
```

This installs the Cython-accelerated HDBSCAN that ECM uses via Python bridge.

### Minimum (Slow)

No additional installation required - ECM includes hdbscan-ts as a fallback.

## Issue Tracking

The performance issue in hdbscan-ts is documented at:
- Repository: https://github.com/GeLi2001/hdbscan-ts
- Issue: Pending (to be filed)

### Proposed Fix

Replace `Array.includes()` with `Set.has()`:

```javascript
// Before: O(n) lookup
if (cluster.includes(point)) { ... }

// After: O(1) lookup
const clusterSet = new Set(cluster);
if (clusterSet.has(point)) { ... }
```

## Future Considerations

1. **Contribute fix to hdbscan-ts**: File PR with Set-based lookup
2. **WebAssembly option**: Compile Rust/C HDBSCAN to WASM
3. **Incremental clustering**: Avoid full re-clustering for small updates
4. **Alternative algorithms**: Explore DBSTREAM or other online clustering

## Checking Python Availability

ECM checks for Python HDBSCAN at startup:

```typescript
function isPythonHdbscanAvailable(): boolean {
  try {
    execSync('python3 -c "import hdbscan"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

If unavailable, the slower JavaScript fallback is used automatically.
