/**
 * Debug forward edge traversal
 */
import { vectorStore } from '../src/storage/vector-store.js';
import { getChunkById } from '../src/storage/chunk-store.js';
import { getOutgoingEdges, getWeightedEdges } from '../src/storage/edge-store.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { getConfig } from '../src/config/memory-config.js';

async function debug(query: string) {
  const config = getConfig();

  // Embed query
  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));
  const { embedding } = await embedder.embed(query, true);

  // Vector search
  const vectorResults = await vectorStore.search(embedding, 20);
  const vectorIds = new Set(vectorResults.map(r => r.id));

  console.log(`\n=== Query: "${query}" ===\n`);
  console.log(`Vector search found: ${vectorResults.length} chunks\n`);

  let totalForwardTargets = 0;
  let targetsAlreadyInVectorSearch = 0;
  let targetsWithZeroWeight = 0;

  for (const vr of vectorResults.slice(0, 5)) {
    const forwardEdges = getOutgoingEdges(vr.id, 'forward');
    const weightedForward = getWeightedEdges(vr.id, Date.now(), config.forwardDecay, 'forward');

    console.log(`Chunk: ${vr.id.slice(0, 50)}...`);
    console.log(`  Raw forward edges: ${forwardEdges.length}`);
    console.log(`  Weighted forward edges (after decay): ${weightedForward.length}`);

    for (const edge of forwardEdges) {
      totalForwardTargets++;
      if (vectorIds.has(edge.targetChunkId)) {
        targetsAlreadyInVectorSearch++;
        console.log(`    -> Target ${edge.targetChunkId.slice(0,30)}... ALREADY in vector search`);
      } else {
        // Check if it was filtered by decay
        const weighted = weightedForward.find(w => w.targetChunkId === edge.targetChunkId);
        if (!weighted) {
          targetsWithZeroWeight++;
          console.log(`    -> Target ${edge.targetChunkId.slice(0,30)}... FILTERED (zero weight)`);
        } else {
          console.log(`    -> Target ${edge.targetChunkId.slice(0,30)}... weight=${weighted.weight.toFixed(3)} SHOULD BE ADDED`);
        }
      }
    }
    console.log();
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total forward edge targets: ${totalForwardTargets}`);
  console.log(`Already in vector search: ${targetsAlreadyInVectorSearch}`);
  console.log(`Filtered by decay: ${targetsWithZeroWeight}`);
  console.log(`Should be added: ${totalForwardTargets - targetsAlreadyInVectorSearch - targetsWithZeroWeight}`);

  await embedder.dispose();
}

const query = process.argv[2] || 'database schema migrations';
debug(query).catch(console.error);
