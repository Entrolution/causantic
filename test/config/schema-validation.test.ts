/**
 * Tests for config.schema.json alignment with DEFAULT_CONFIG and ExternalConfig.
 *
 * Verifies that the JSON schema defaults match the programmatic defaults in
 * memory-config.ts, and that the schema structure covers all expected sections.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/memory-config.js';

// Load the schema from the project root
const schemaPath = join(process.cwd(), 'config.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

describe('config.schema.json structure', () => {
  it('has all top-level sections', () => {
    const expectedSections = [
      'decay',
      'clustering',
      'traversal',
      'tokens',
      'storage',
      'llm',
      'encryption',
      'vectors',
      'embedding',
    ];

    const actualSections = Object.keys(schema.properties);

    for (const section of expectedSections) {
      expect(actualSections).toContain(section);
    }
  });

  it('does not allow additional properties at root level', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('all top-level sections have type and description fields', () => {
    for (const [sectionName, sectionDef] of Object.entries(schema.properties) as [string, any][]) {
      expect(sectionDef.type).toBeDefined();
      expect(sectionDef.type).toBe('object');
      expect(sectionDef.description).toBeDefined();
      expect(sectionDef.description).toBeTypeOf('string');
      expect(sectionDef.description.length).toBeGreaterThan(0);
    }
  });

  it('all leaf properties have type and description fields', () => {
    // Walk through all sections and their nested properties
    for (const [sectionName, sectionDef] of Object.entries(schema.properties) as [string, any][]) {
      if (!sectionDef.properties) continue;

      for (const [propName, propDef] of Object.entries(sectionDef.properties) as [string, any][]) {
        // Some properties are objects with nested properties (e.g., decay.backward)
        if (propDef.type === 'object' && propDef.properties) {
          for (const [nestedName, nestedDef] of Object.entries(propDef.properties) as [string, any][]) {
            expect(nestedDef.type, `${sectionName}.${propName}.${nestedName} should have type`).toBeDefined();
            expect(nestedDef.description, `${sectionName}.${propName}.${nestedName} should have description`).toBeDefined();
            expect(nestedDef.description).toBeTypeOf('string');
          }
        } else {
          expect(propDef.type, `${sectionName}.${propName} should have type`).toBeDefined();
          expect(propDef.description, `${sectionName}.${propName} should have description`).toBeDefined();
          expect(propDef.description).toBeTypeOf('string');
        }
      }
    }
  });
});

describe('schema defaults match DEFAULT_CONFIG', () => {
  it('clustering.threshold matches DEFAULT_CONFIG.clusterThreshold', () => {
    const schemaDefault = schema.properties.clustering.properties.threshold.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.clusterThreshold);
    expect(schemaDefault).toBe(0.10);
  });

  it('clustering.minClusterSize matches DEFAULT_CONFIG.minClusterSize', () => {
    const schemaDefault = schema.properties.clustering.properties.minClusterSize.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.minClusterSize);
    expect(schemaDefault).toBe(4);
  });

  it('traversal.maxDepth matches DEFAULT_CONFIG.maxTraversalDepth', () => {
    const schemaDefault = schema.properties.traversal.properties.maxDepth.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.maxTraversalDepth);
    expect(schemaDefault).toBe(15);
  });

  it('traversal.minWeight matches DEFAULT_CONFIG.minSignalThreshold', () => {
    const schemaDefault = schema.properties.traversal.properties.minWeight.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.minSignalThreshold);
    expect(schemaDefault).toBe(0.01);
  });

  it('tokens.claudeMdBudget matches DEFAULT_CONFIG.claudeMdBudgetTokens', () => {
    const schemaDefault = schema.properties.tokens.properties.claudeMdBudget.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.claudeMdBudgetTokens);
    expect(schemaDefault).toBe(500);
  });

  it('tokens.mcpMaxResponse matches DEFAULT_CONFIG.mcpMaxResponseTokens', () => {
    const schemaDefault = schema.properties.tokens.properties.mcpMaxResponse.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.mcpMaxResponseTokens);
    expect(schemaDefault).toBe(2000);
  });

  it('storage.dbPath matches DEFAULT_CONFIG.dbPath', () => {
    const schemaDefault = schema.properties.storage.properties.dbPath.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.dbPath);
    expect(schemaDefault).toBe('~/.causantic/memory.db');
  });

  it('llm.clusterRefreshModel matches DEFAULT_CONFIG.clusterRefreshModel', () => {
    const schemaDefault = schema.properties.llm.properties.clusterRefreshModel.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.clusterRefreshModel);
    expect(schemaDefault).toBe('claude-3-haiku-20240307');
  });

  it('llm.refreshRateLimitPerMin matches DEFAULT_CONFIG.refreshRateLimitPerMin', () => {
    const schemaDefault = schema.properties.llm.properties.refreshRateLimitPerMin.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.refreshRateLimitPerMin);
    expect(schemaDefault).toBe(30);
  });

  it('traversal.directHitBoost matches DEFAULT_CONFIG.directHitBoost', () => {
    const schemaDefault = schema.properties.traversal.properties.directHitBoost.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.directHitBoost);
    expect(schemaDefault).toBe(1.5);
  });

  it('traversal.graphAgreementBoost matches DEFAULT_CONFIG.graphAgreementBoost', () => {
    const schemaDefault = schema.properties.traversal.properties.graphAgreementBoost.default;
    expect(schemaDefault).toBe(DEFAULT_CONFIG.graphAgreementBoost);
    expect(schemaDefault).toBe(2.0);
  });
});

describe('schema sections do not allow additional properties', () => {
  it('all top-level sections disallow additionalProperties', () => {
    for (const [sectionName, sectionDef] of Object.entries(schema.properties) as [string, any][]) {
      expect(
        sectionDef.additionalProperties,
        `${sectionName} should disallow additional properties`,
      ).toBe(false);
    }
  });
});
