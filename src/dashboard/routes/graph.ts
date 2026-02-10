import { Router } from 'express';
import { getAllEdges, getOutgoingEdges, getIncomingEdges } from '../../storage/edge-store.js';
import { getChunksByIds, getChunkIdsByProject, getAllChunks } from '../../storage/chunk-store.js';
import { getAllClusters, getClusterChunkIds, getChunkClusterAssignments } from '../../storage/cluster-store.js';

const router = Router();

/**
 * GET /api/graph — Sampled graph for D3 visualization.
 * Uses importance sampling: degree centrality + cluster exemplars as seeds.
 */
router.get('/', (req, res) => {
  const nodeLimit = Math.min(500, Math.max(10, parseInt(req.query.limit as string) || 300));
  const project = req.query.project as string | undefined;

  // Get edges, optionally filtered by project
  let projectChunkIds: Set<string> | null = null;
  if (project) {
    projectChunkIds = new Set(getChunkIdsByProject(project));
  }

  const allEdges = getAllEdges();
  const filteredEdges = projectChunkIds
    ? allEdges.filter(
        (e) => projectChunkIds!.has(e.sourceChunkId) || projectChunkIds!.has(e.targetChunkId),
      )
    : allEdges;

  // Compute degree centrality
  const degree = new Map<string, number>();
  for (const edge of filteredEdges) {
    degree.set(edge.sourceChunkId, (degree.get(edge.sourceChunkId) ?? 0) + 1);
    degree.set(edge.targetChunkId, (degree.get(edge.targetChunkId) ?? 0) + 1);
  }

  // Get cluster exemplars as priority seeds
  const clusters = getAllClusters();
  const exemplarSet = new Set<string>();
  for (const cluster of clusters) {
    for (const id of cluster.exemplarIds) {
      if (!projectChunkIds || projectChunkIds.has(id)) {
        exemplarSet.add(id);
      }
    }
  }

  // Rank nodes: exemplars first, then by degree
  const nodeIds = [...degree.keys()];
  nodeIds.sort((a, b) => {
    const aExemplar = exemplarSet.has(a) ? 1 : 0;
    const bExemplar = exemplarSet.has(b) ? 1 : 0;
    if (aExemplar !== bExemplar) return bExemplar - aExemplar;
    return (degree.get(b) ?? 0) - (degree.get(a) ?? 0);
  });

  // Take top N nodes
  const selectedIds = new Set(nodeIds.slice(0, nodeLimit));

  // Get chunk data for selected nodes
  const chunks = getChunksByIds([...selectedIds]);
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  // Build cluster lookup
  const chunkCluster = new Map<string, string>();
  for (const cluster of clusters) {
    const memberIds = getClusterChunkIds(cluster.id);
    for (const id of memberIds) {
      if (selectedIds.has(id)) {
        chunkCluster.set(id, cluster.id);
      }
    }
  }

  // Build nodes
  const nodes = [...selectedIds].map((id) => {
    const chunk = chunkMap.get(id);
    return {
      id,
      label: chunk?.content.slice(0, 80) ?? id.slice(0, 8),
      project: chunk?.sessionSlug ?? '',
      cluster: chunkCluster.get(id) ?? null,
      degree: degree.get(id) ?? 0,
      startTime: chunk?.startTime ?? null,
    };
  });

  // Filter edges to only include selected nodes
  const edges = filteredEdges
    .filter((e) => selectedIds.has(e.sourceChunkId) && selectedIds.has(e.targetChunkId))
    .map((e) => ({
      source: e.sourceChunkId,
      target: e.targetChunkId,
      type: e.edgeType,
      weight: e.initialWeight,
      referenceType: e.referenceType,
    }));

  res.json({ nodes, edges });
});

/**
 * GET /api/graph/neighborhood — N-hop subgraph from a seed node.
 */
router.get('/neighborhood', (req, res) => {
  const chunkId = req.query.chunkId as string;
  const maxHops = Math.min(4, Math.max(1, parseInt(req.query.hops as string) || 2));

  if (!chunkId) {
    res.status(400).json({ error: 'chunkId is required' });
    return;
  }

  // BFS from seed node
  const visited = new Set<string>();
  const edgeSet = new Map<string, { source: string; target: string; type: string; weight: number; referenceType: string | null }>();
  let frontier = [chunkId];
  visited.add(chunkId);

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      const outgoing = getOutgoingEdges(nodeId);
      const incoming = getIncomingEdges(nodeId);

      for (const edge of [...outgoing, ...incoming]) {
        const neighbor =
          edge.sourceChunkId === nodeId ? edge.targetChunkId : edge.sourceChunkId;

        edgeSet.set(edge.id, {
          source: edge.sourceChunkId,
          target: edge.targetChunkId,
          type: edge.edgeType,
          weight: edge.initialWeight,
          referenceType: edge.referenceType,
        });

        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }

    frontier = nextFrontier;
  }

  // Get chunk data
  const chunks = getChunksByIds([...visited]);
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  // Build cluster lookup
  const clusters = getAllClusters();
  const chunkCluster = new Map<string, string>();
  for (const cluster of clusters) {
    const memberIds = getClusterChunkIds(cluster.id);
    for (const id of memberIds) {
      if (visited.has(id)) {
        chunkCluster.set(id, cluster.id);
      }
    }
  }

  // Compute degree within subgraph
  const degree = new Map<string, number>();
  for (const edge of edgeSet.values()) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const nodes = [...visited].map((id) => {
    const chunk = chunkMap.get(id);
    return {
      id,
      label: chunk?.content.slice(0, 80) ?? id.slice(0, 8),
      project: chunk?.sessionSlug ?? '',
      cluster: chunkCluster.get(id) ?? null,
      degree: degree.get(id) ?? 0,
      startTime: chunk?.startTime ?? null,
      root: id === chunkId,
    };
  });

  res.json({ nodes, edges: [...edgeSet.values()] });
});

export default router;
