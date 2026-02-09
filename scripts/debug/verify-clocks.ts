/**
 * Verify that vector clocks are properly populated after ingestion.
 * Usage: npm run verify-clocks
 */

import { getDb, closeDb, getDbStats } from '../src/storage/db.js';
import { getReferenceClock, getAllAgentClocks } from '../src/storage/clock-store.js';
import { getHopCountDistribution, getClockStats } from '../src/temporal/clock-compactor.js';
import { deserialize } from '../src/temporal/vector-clock.js';

async function main(): Promise<void> {
  const db = getDb();

  console.log('=== Vector Clock Verification ===\n');

  // 1. Basic database stats
  const stats = getDbStats();
  console.log('Database Stats:');
  console.log(`  Chunks:     ${stats.chunks}`);
  console.log(`  Edges:      ${stats.edges}`);
  console.log(`  Clusters:   ${stats.clusters}`);

  // 2. Check chunks with vector clocks
  const chunksWithClock = db.prepare(`
    SELECT COUNT(*) as count FROM chunks WHERE vector_clock IS NOT NULL
  `).get() as { count: number };

  const chunksWithAgent = db.prepare(`
    SELECT COUNT(*) as count FROM chunks WHERE agent_id IS NOT NULL
  `).get() as { count: number };

  console.log('\nChunk Clock Coverage:');
  console.log(`  With vector_clock: ${chunksWithClock.count}/${stats.chunks} (${((chunksWithClock.count / stats.chunks) * 100).toFixed(1)}%)`);
  console.log(`  With agent_id:     ${chunksWithAgent.count}/${stats.chunks} (${((chunksWithAgent.count / stats.chunks) * 100).toFixed(1)}%)`);

  // 3. Check edges with vector clocks
  const edgesWithClock = db.prepare(`
    SELECT COUNT(*) as count FROM edges WHERE vector_clock IS NOT NULL
  `).get() as { count: number };

  const edgesWithBoost = db.prepare(`
    SELECT COUNT(*) as count FROM edges WHERE link_count > 1
  `).get() as { count: number };

  console.log('\nEdge Clock Coverage:');
  console.log(`  With vector_clock: ${edgesWithClock.count}/${stats.edges} (${((edgesWithClock.count / stats.edges) * 100).toFixed(1)}%)`);
  console.log(`  With link boost:   ${edgesWithBoost.count}/${stats.edges} (${((edgesWithBoost.count / stats.edges) * 100).toFixed(1)}%)`);

  // 4. Check edge types distribution
  const edgeTypes = db.prepare(`
    SELECT reference_type, COUNT(*) as count FROM edges GROUP BY reference_type ORDER BY count DESC
  `).all() as Array<{ reference_type: string | null; count: number }>;

  console.log('\nEdge Type Distribution:');
  for (const et of edgeTypes) {
    console.log(`  ${et.reference_type ?? 'null'}: ${et.count}`);
  }

  // 5. Check for brief/debrief edges
  const briefCount = db.prepare(`SELECT COUNT(*) as count FROM edges WHERE reference_type = 'brief'`).get() as { count: number };
  const debriefCount = db.prepare(`SELECT COUNT(*) as count FROM edges WHERE reference_type = 'debrief'`).get() as { count: number };

  console.log('\nSub-Agent Edges:');
  console.log(`  Brief edges:   ${briefCount.count}`);
  console.log(`  Debrief edges: ${debriefCount.count}`);

  // 6. Check vector_clocks table
  const clockCount = db.prepare(`SELECT COUNT(*) as count FROM vector_clocks`).get() as { count: number };
  const projectClocks = db.prepare(`SELECT COUNT(*) as count FROM vector_clocks WHERE id LIKE 'project:%'`).get() as { count: number };
  const agentClocks = db.prepare(`SELECT COUNT(*) as count FROM vector_clocks WHERE id LIKE 'agent:%'`).get() as { count: number };

  console.log('\nVector Clocks Table:');
  console.log(`  Total entries:   ${clockCount.count}`);
  console.log(`  Project clocks:  ${projectClocks.count}`);
  console.log(`  Agent clocks:    ${agentClocks.count}`);

  // 7. Sample a few clocks
  const sampleClocks = db.prepare(`
    SELECT id, clock_data FROM vector_clocks LIMIT 5
  `).all() as Array<{ id: string; clock_data: string }>;

  if (sampleClocks.length > 0) {
    console.log('\nSample Vector Clocks:');
    for (const sc of sampleClocks) {
      const clock = deserialize(sc.clock_data);
      const agents = Object.keys(clock);
      const totalTicks = Object.values(clock).reduce((a, b) => a + b, 0);
      console.log(`  ${sc.id}: ${agents.length} agents, ${totalTicks} total ticks`);
    }
  }

  // 8. Sample edges with clocks
  const sampleEdges = db.prepare(`
    SELECT id, reference_type, vector_clock, link_count FROM edges
    WHERE vector_clock IS NOT NULL
    LIMIT 5
  `).all() as Array<{ id: string; reference_type: string; vector_clock: string; link_count: number }>;

  if (sampleEdges.length > 0) {
    console.log('\nSample Edges with Clocks:');
    for (const edge of sampleEdges) {
      const clock = deserialize(edge.vector_clock);
      const totalTicks = Object.values(clock).reduce((a, b) => a + b, 0);
      console.log(`  ${edge.reference_type}: ${totalTicks} hops at creation, link_count=${edge.link_count}`);
    }
  }

  // 9. Get unique project slugs
  const projectSlugs = db.prepare(`SELECT DISTINCT session_slug FROM chunks`).all() as Array<{ session_slug: string }>;
  console.log(`\nProjects with chunks: ${projectSlugs.length}`);

  // 10. Get hop count distribution for first project (if exists)
  if (projectSlugs.length > 0) {
    const firstProject = projectSlugs[0].session_slug;
    console.log(`\nHop Count Distribution for "${firstProject}":`);

    try {
      const distribution = await getHopCountDistribution(firstProject);
      if (distribution.size > 0) {
        const sorted = Array.from(distribution.entries()).sort((a, b) => a[0] - b[0]);
        for (const [hops, count] of sorted.slice(0, 10)) {
          console.log(`  ${hops} hops: ${count} edges`);
        }
        if (sorted.length > 10) {
          console.log(`  ... and ${sorted.length - 10} more hop levels`);
        }
      } else {
        console.log('  No edges with vector clocks found');
      }
    } catch (err) {
      console.log(`  Error: ${err}`);
    }
  }

  console.log('\n=== Verification Complete ===');

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
