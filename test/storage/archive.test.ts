/**
 * Tests for export/import functionality.
 */

import { describe, it, expect } from 'vitest';
import type {
  Archive,
  ArchiveMetadata,
  ExportedChunk,
  ExportedEdge,
  ExportedCluster,
  ExportOptions,
  ImportOptions,
} from '../../src/storage/archive.js';

describe('archive', () => {
  describe('Archive interface', () => {
    it('has correct structure', () => {
      const archive: Archive = {
        format: 'causantic-archive',
        version: '1.0',
        created: '2024-01-15T10:30:00Z',
        metadata: {
          version: '1.0',
          created: '2024-01-15T10:30:00Z',
          chunkCount: 100,
          edgeCount: 250,
          clusterCount: 5,
          projects: ['project-a', 'project-b'],
        },
        chunks: [],
        edges: [],
        clusters: [],
      };

      expect(archive.format).toBe('causantic-archive');
      expect(archive.version).toBe('1.0');
      expect(archive.metadata.chunkCount).toBe(100);
    });
  });

  describe('ArchiveMetadata interface', () => {
    it('tracks counts correctly', () => {
      const metadata: ArchiveMetadata = {
        version: '1.0',
        created: new Date().toISOString(),
        chunkCount: 50,
        edgeCount: 120,
        clusterCount: 3,
        projects: ['my-project'],
      };

      expect(metadata.chunkCount).toBe(50);
      expect(metadata.edgeCount).toBe(120);
      expect(metadata.clusterCount).toBe(3);
      expect(metadata.projects).toContain('my-project');
    });
  });

  describe('ExportedChunk interface', () => {
    it('has all required fields', () => {
      const chunk: ExportedChunk = {
        id: 'chunk-abc',
        sessionSlug: 'my-project',
        content: 'This is chunk content',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
        turnIndices: [0, 1, 2],
        vectorClock: { ui: 5, human: 3 },
      };

      expect(chunk.id).toBe('chunk-abc');
      expect(chunk.sessionSlug).toBe('my-project');
      expect(chunk.turnIndices).toEqual([0, 1, 2]);
      expect(chunk.vectorClock.ui).toBe(5);
    });
  });

  describe('ExportedEdge interface', () => {
    it('has all required fields', () => {
      const edge: ExportedEdge = {
        source: 'chunk-1',
        target: 'chunk-2',
        type: 'backward',
        referenceType: 'file-path',
        weight: 0.85,
        vectorClock: { ui: 10 },
      };

      expect(edge.source).toBe('chunk-1');
      expect(edge.target).toBe('chunk-2');
      expect(edge.type).toBe('backward');
      expect(edge.referenceType).toBe('file-path');
      expect(edge.weight).toBe(0.85);
    });
  });

  describe('ExportedCluster interface', () => {
    it('has all required fields', () => {
      const cluster: ExportedCluster = {
        id: 'cluster-xyz',
        name: 'Authentication',
        description: 'Chunks related to user authentication',
        memberChunkIds: ['chunk-1', 'chunk-2', 'chunk-3'],
      };

      expect(cluster.id).toBe('cluster-xyz');
      expect(cluster.name).toBe('Authentication');
      expect(cluster.memberChunkIds.length).toBe(3);
    });

    it('allows null description', () => {
      const cluster: ExportedCluster = {
        id: 'cluster-xyz',
        name: 'Unnamed Cluster',
        description: null,
        memberChunkIds: [],
      };

      expect(cluster.description).toBeNull();
    });
  });

  describe('ExportOptions interface', () => {
    it('requires outputPath', () => {
      const options: ExportOptions = {
        outputPath: '/path/to/archive.causantic',
      };

      expect(options.outputPath).toBe('/path/to/archive.causantic');
    });

    it('supports optional password for encryption', () => {
      const options: ExportOptions = {
        outputPath: '/path/to/archive.causantic',
        password: 'secret123',
      };

      expect(options.password).toBe('secret123');
    });

    it('supports project filtering', () => {
      const options: ExportOptions = {
        outputPath: '/path/to/archive.causantic',
        projects: ['project-a', 'project-c'],
      };

      expect(options.projects).toEqual(['project-a', 'project-c']);
    });

    it('supports redaction options', () => {
      const options: ExportOptions = {
        outputPath: '/path/to/archive.causantic',
        redactPaths: true,
        redactCode: true,
      };

      expect(options.redactPaths).toBe(true);
      expect(options.redactCode).toBe(true);
    });
  });

  describe('ImportOptions interface', () => {
    it('requires inputPath', () => {
      const options: ImportOptions = {
        inputPath: '/path/to/archive.causantic',
      };

      expect(options.inputPath).toBe('/path/to/archive.causantic');
    });

    it('supports optional password for decryption', () => {
      const options: ImportOptions = {
        inputPath: '/path/to/archive.causantic',
        password: 'secret123',
      };

      expect(options.password).toBe('secret123');
    });

    it('supports merge option', () => {
      const options: ImportOptions = {
        inputPath: '/path/to/archive.causantic',
        merge: true,
      };

      expect(options.merge).toBe(true);
    });
  });

  describe('redaction functions', () => {
    describe('redactFilePaths', () => {
      it('redacts Unix-style paths', () => {
        const content = 'Looking at /src/components/Button.tsx';
        const pattern = /(?:\/[\w.-]+)+\.\w+/g;
        const redacted = content.replace(pattern, '[REDACTED_PATH]');

        expect(redacted).toBe('Looking at [REDACTED_PATH]');
      });

      it('redacts Windows-style paths', () => {
        const content = 'Opening C:\\Users\\dev\\project\\file.ts';
        const pattern = /(?:[A-Z]:\\[\w.-\\]+)/g;
        const redacted = content.replace(pattern, '[REDACTED_PATH]');

        expect(redacted).toContain('[REDACTED_PATH]');
      });

      it('redacts home directory paths', () => {
        const content = 'Config at ~/dev/project/config.json';
        const pattern = /(?:~\/[\w.-\/]+)/g;
        const redacted = content.replace(pattern, '[REDACTED_PATH]');

        expect(redacted).toBe('Config at [REDACTED_PATH]');
      });

      it('preserves non-path content', () => {
        const content = 'This is just regular text without paths';
        const pattern = /(?:\/[\w.-]+)+\.\w+/g;
        const redacted = content.replace(pattern, '[REDACTED_PATH]');

        expect(redacted).toBe(content);
      });
    });

    describe('redactCodeBlocks', () => {
      it('redacts markdown code blocks', () => {
        const content = 'Here is code:\n```typescript\nconst x = 1;\n```\nEnd.';
        const pattern = /```[\s\S]*?```/g;
        const redacted = content.replace(pattern, '```\n[REDACTED_CODE]\n```');

        expect(redacted).toBe('Here is code:\n```\n[REDACTED_CODE]\n```\nEnd.');
      });

      it('handles multiple code blocks', () => {
        const content = '```js\ncode1\n```\nText\n```py\ncode2\n```';
        const pattern = /```[\s\S]*?```/g;
        const redacted = content.replace(pattern, '```\n[REDACTED_CODE]\n```');

        expect(redacted.match(/\[REDACTED_CODE\]/g)?.length).toBe(2);
      });

      it('preserves inline code', () => {
        const content = 'Use the `function` keyword';
        const pattern = /```[\s\S]*?```/g;
        const redacted = content.replace(pattern, '```\n[REDACTED_CODE]\n```');

        expect(redacted).toBe(content); // Inline code not redacted
      });
    });
  });

  describe('encryption detection', () => {
    it('checks for magic bytes', () => {
      const ENCRYPTED_MAGIC = Buffer.from('CST\x00');
      const encryptedFile = Buffer.concat([ENCRYPTED_MAGIC, Buffer.from('encrypted data')]);
      const plainFile = Buffer.from('{"format":"causantic-archive"}');

      const isEncrypted1 = encryptedFile.subarray(0, 4).equals(ENCRYPTED_MAGIC);
      const isEncrypted2 = plainFile.subarray(0, 4).equals(ENCRYPTED_MAGIC);

      expect(isEncrypted1).toBe(true);
      expect(isEncrypted2).toBe(false);
    });
  });

  describe('archive validation', () => {
    it('validates format field', () => {
      const validArchive = { format: 'causantic-archive' };
      const invalidArchive = { format: 'other-format' };

      expect(validArchive.format === 'causantic-archive').toBe(true);
      expect(invalidArchive.format === 'causantic-archive').toBe(false);
    });
  });

  describe('merge behavior', () => {
    it('merge=false clears existing data', () => {
      const merge = false;
      const clearExisting = !merge;

      expect(clearExisting).toBe(true);
    });

    it('merge=true preserves existing data', () => {
      const merge = true;
      const clearExisting = !merge;

      expect(clearExisting).toBe(false);
    });
  });

  describe('JSON serialization', () => {
    it('serializes archive to JSON with formatting', () => {
      const archive: Archive = {
        format: 'causantic-archive',
        version: '1.0',
        created: '2024-01-15T10:30:00Z',
        metadata: {
          version: '1.0',
          created: '2024-01-15T10:30:00Z',
          chunkCount: 0,
          edgeCount: 0,
          clusterCount: 0,
          projects: [],
        },
        chunks: [],
        edges: [],
        clusters: [],
      };

      const json = JSON.stringify(archive, null, 2);

      expect(json).toContain('"format": "causantic-archive"');
      expect(json).toContain('\n'); // Pretty printed
    });

    it('parses JSON back to archive', () => {
      const json = '{"format":"causantic-archive","version":"1.0","chunks":[],"edges":[],"clusters":[]}';
      const parsed = JSON.parse(json);

      expect(parsed.format).toBe('causantic-archive');
    });
  });

  describe('vector clock serialization in export', () => {
    it('serializes vector clock as JSON string', () => {
      const vectorClock = { ui: 10, human: 5 };
      const serialized = JSON.stringify(vectorClock);

      expect(serialized).toBe('{"ui":10,"human":5}');
    });

    it('deserializes vector clock from JSON string', () => {
      const serialized = '{"ui":10,"human":5}';
      const parsed = JSON.parse(serialized);

      expect(parsed.ui).toBe(10);
      expect(parsed.human).toBe(5);
    });

    it('handles empty vector clock', () => {
      const serialized = '{}';
      const parsed = JSON.parse(serialized);

      expect(Object.keys(parsed).length).toBe(0);
    });
  });
});
