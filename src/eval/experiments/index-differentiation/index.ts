/**
 * Index entry differentiation experiment — barrel export.
 */

export type {
  ClusterSimilarityResult,
  DiscriminationResult,
  RefinementResult,
  DifferentiationReport,
} from './types.js';

export { runSimilarityAnalysis, analyseCluster } from './similarity-analysis.js';
export type { ClusterForAnalysis } from './similarity-analysis.js';
export { runDiscriminationTest, testClusterDiscrimination } from './discrimination-test.js';
export { runAlignmentAnalysis, analyseClusterAlignment } from './alignment-analysis.js';
export type { EntryAlignment, ClusterAlignmentResult } from './alignment-analysis.js';
export { runRefinementTest, testClusterRefinement } from './refinement-test.js';
