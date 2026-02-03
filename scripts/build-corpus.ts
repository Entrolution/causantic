/**
 * CLI: Generate test corpus from real Claude Code sessions.
 *
 * Usage: tsx scripts/build-corpus.ts [--output test/fixtures/corpus]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCorpus, discoverSessions } from '../src/eval/corpus-builder.js';
import { generateLabeledPairs } from '../src/eval/annotation-schema.js';

const CLAUDE_PROJECTS_BASE = join(
  process.env.HOME ?? '~',
  '.claude',
  'projects',
);

// Known project directories with max sessions to take from each.
// Sessions are sorted by file size descending, so we get the richest first.
const PROJECT_DIRS: { dir: string; maxSessions: number }[] = [
  { dir: '-Users-gvn-Dev-Entrolution-speed-read', maxSessions: 3 },
  { dir: '-Users-gvn-Dev-Entrolution-semansiation', maxSessions: 2 },
  { dir: '-Users-gvn-Dev-Entrolution-Ultan', maxSessions: 2 },
  { dir: '-Users-gvn-Dev-Entrolution-cdx-core', maxSessions: 2 },
  { dir: '-Users-gvn-Dev-Apolitical-apolitical-assistant', maxSessions: 3 },
];

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? 'test/fixtures/corpus';

  console.log('Building test corpus from Claude Code sessions...\n');

  // Discover sessions
  const allSessionPaths: string[] = [];
  for (const { dir: projDir, maxSessions } of PROJECT_DIRS) {
    const fullDir = join(CLAUDE_PROJECTS_BASE, projDir);
    try {
      const sessions = await discoverSessions(fullDir);
      console.log(`Found ${sessions.length} sessions in ${projDir}`);
      if (sessions.length > 0) {
        allSessionPaths.push(...sessions.slice(0, maxSessions));
      }
    } catch (e) {
      console.log(`Skipping ${projDir}: ${(e as Error).message}`);
    }
  }

  if (allSessionPaths.length === 0) {
    console.error('No sessions found. Check project directories.');
    process.exit(1);
  }

  console.log(`\nProcessing ${allSessionPaths.length} sessions...\n`);

  // Build corpus
  const corpus = await buildCorpus({
    sessionPaths: allSessionPaths,
    maxChunksPerSession: 30,
    maxTokensPerChunk: 4096,
    includeThinking: true,
  });

  console.log(`\nCorpus: ${corpus.chunks.length} chunks from ${corpus.sessions.length} sessions`);

  // Generate labeled pairs — scale targets with corpus size
  const annotations = generateLabeledPairs(corpus.chunks, {
    adjacentPairs: 60,
    crossSessionPairs: 40,
    crossProjectPairs: 80,
    codeNLPairs: 20,
  });
  console.log(`Generated ${annotations.pairs.length} labeled pairs:`);

  const bySrc = new Map<string, number>();
  for (const p of annotations.pairs) {
    bySrc.set(p.source, (bySrc.get(p.source) ?? 0) + 1);
  }
  for (const [src, count] of bySrc) {
    console.log(`  ${src}: ${count}`);
  }

  // Write output
  await mkdir(outputDir, { recursive: true });

  await writeFile(
    join(outputDir, 'corpus.json'),
    JSON.stringify(corpus, null, 2),
  );
  await writeFile(
    join(outputDir, 'labeled-pairs.json'),
    JSON.stringify(annotations, null, 2),
  );

  console.log(`\nCorpus written to ${outputDir}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
