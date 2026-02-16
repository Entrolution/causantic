/**
 * Compare vector search only vs vector search + graph traversal.
 */

import { vectorStore } from '../src/storage/vector-store.js';
import { getChunkById } from '../src/storage/chunk-store.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { traverseMultiple } from '../src/retrieval/traverser.js';
import { closeDb } from '../src/storage/db.js';

async function main() {
  const query = process.argv.slice(2).join(' ') || 'vector clock decay';

  console.log('\nQuery: "' + query + '"\n');
  console.log('='.repeat(80));

  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));
  const { embedding } = await embedder.embed(query, true);

  console.log('\n## VECTOR SEARCH ONLY (top 10)\n');
  const vectorResults = await vectorStore.search(embedding, 10);

  const vectorChunkIds = new Set<string>();
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    vectorChunkIds.add(r.id);
    const chunk = getChunkById(r.id);
    const preview = chunk?.content.slice(0, 100).replace(/\n/g, ' ') || '(no content)';
    const similarity = (1 - r.distance).toFixed(3);
    console.log(i + 1 + '. [sim=' + similarity + '] ' + (chunk?.sessionSlug || 'unknown'));
    console.log('   ' + preview + '...');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n## GRAPH TRAVERSAL ADDITIONS\n');

  const startIds = vectorResults.map((r) => r.id);

  // Uses config defaults: maxDepth=50, minWeight=0.01
  const backwardResult = traverseMultiple(startIds, {
    direction: 'backward',
  });

  const forwardResult = traverseMultiple(startIds, {
    direction: 'forward',
  });

  const backwardAdditions = backwardResult.chunks.filter((c) => !vectorChunkIds.has(c.chunkId));
  const forwardAdditions = forwardResult.chunks.filter((c) => !vectorChunkIds.has(c.chunkId));

  console.log(
    'Backward traversal: ' +
      backwardResult.chunks.length +
      ' total, ' +
      backwardAdditions.length +
      ' NEW',
  );
  console.log(
    'Forward traversal:  ' +
      forwardResult.chunks.length +
      ' total, ' +
      forwardAdditions.length +
      ' NEW',
  );

  if (backwardAdditions.length > 0) {
    console.log('\n### Top 5 Backward Additions (context that LED TO matches):\n');
    for (let i = 0; i < Math.min(5, backwardAdditions.length); i++) {
      const c = backwardAdditions[i];
      const chunk = getChunkById(c.chunkId);
      const preview = chunk?.content.slice(0, 120).replace(/\n/g, ' ') || '';
      console.log(
        i + 1 + '. [w=' + c.weight.toFixed(3) + ' d=' + c.depth + '] ' + (chunk?.sessionSlug || ''),
      );
      console.log('   ' + preview + '...');
    }
  }

  if (forwardAdditions.length > 0) {
    console.log('\n### Top 5 Forward Additions (context that FOLLOWED matches):\n');
    for (let i = 0; i < Math.min(5, forwardAdditions.length); i++) {
      const c = forwardAdditions[i];
      const chunk = getChunkById(c.chunkId);
      const preview = chunk?.content.slice(0, 120).replace(/\n/g, ' ') || '';
      console.log(
        i + 1 + '. [w=' + c.weight.toFixed(3) + ' d=' + c.depth + '] ' + (chunk?.sessionSlug || ''),
      );
      console.log('   ' + preview + '...');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n## SUMMARY\n');
  const totalAdded = backwardAdditions.length + forwardAdditions.length;
  console.log('Vector search alone:   ' + vectorResults.length + ' chunks');
  console.log('+ Backward traversal:  ' + backwardAdditions.length + ' additional');
  console.log('+ Forward traversal:   ' + forwardAdditions.length + ' additional');
  console.log(
    'Graph added:           ' +
      totalAdded +
      ' chunks (' +
      Math.round((totalAdded / vectorResults.length) * 100) +
      '% increase)',
  );

  await embedder.dispose();
  closeDb();
}

main().catch(console.error);
