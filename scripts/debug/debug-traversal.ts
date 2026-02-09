import { vectorStore } from '../src/storage/vector-store.js';
import { getChunkById } from '../src/storage/chunk-store.js';
import { getOutgoingEdges } from '../src/storage/edge-store.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { getReferenceClock } from '../src/storage/clock-store.js';
import { hopCount, deserialize } from '../src/temporal/vector-clock.js';
import { closeDb } from '../src/storage/db.js';

async function debug() {
  const query = process.argv[2] || 'git commit workflow';
  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));
  
  const { embedding } = await embedder.embed(query, true);
  const results = await vectorStore.search(embedding, 10);
  
  console.log('Query: "' + query + '"\n');
  console.log('Vector search results and their edges:\n');
  
  const allTargets = new Set<string>();
  const vectorIds = new Set(results.map(r => r.id));
  
  for (const r of results) {
    const chunk = getChunkById(r.id);
    const backEdges = getOutgoingEdges(r.id, 'backward');
    const fwdEdges = getOutgoingEdges(r.id, 'forward');
    
    console.log('Chunk: ' + r.id.slice(-25));
    console.log('  Session: ' + chunk?.sessionSlug);
    console.log('  Sim: ' + (1 - r.distance).toFixed(3));
    console.log('  Backward edges: ' + backEdges.length);
    console.log('  Forward edges: ' + fwdEdges.length);
    
    if (chunk && (backEdges.length > 0 || fwdEdges.length > 0)) {
      const refClock = getReferenceClock(chunk.sessionSlug);
      
      for (const e of backEdges) {
        allTargets.add(e.targetChunkId);
        const edgeClock = e.vectorClock ? deserialize(e.vectorClock) : {};
        const hops = hopCount(edgeClock, refClock);
        const inVector = vectorIds.has(e.targetChunkId) ? ' (OVERLAP)' : '';
        console.log('    BACK -> ' + e.targetChunkId.slice(-20) + ' hops=' + hops + ' w=' + e.initialWeight.toFixed(2) + inVector);
      }
      
      for (const e of fwdEdges) {
        allTargets.add(e.targetChunkId);
        const edgeClock = e.vectorClock ? deserialize(e.vectorClock) : {};
        const hops = hopCount(edgeClock, refClock);
        const inVector = vectorIds.has(e.targetChunkId) ? ' (OVERLAP)' : '';
        console.log('    FWD  -> ' + e.targetChunkId.slice(-20) + ' hops=' + hops + ' w=' + e.initialWeight.toFixed(2) + inVector);
      }
    }
    console.log('');
  }
  
  const overlapping = [...allTargets].filter(t => vectorIds.has(t)).length;
  const newTargets = allTargets.size - overlapping;
  console.log('='.repeat(60));
  console.log('Total edge targets: ' + allTargets.size);
  console.log('  Already in vector results: ' + overlapping);
  console.log('  NEW (added by traversal):  ' + newTargets);
  
  await embedder.dispose();
  closeDb();
}

debug().catch(console.error);
