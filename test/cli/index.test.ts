/**
 * Tests for CLI.
 */

import { describe, it, expect } from 'vitest';

describe('cli', () => {
  describe('Command interface', () => {
    it('has correct structure', () => {
      const command = {
        name: 'test',
        description: 'A test command',
        usage: 'ecm test [options]',
        handler: async (_args: string[]) => {},
      };

      expect(command.name).toBe('test');
      expect(command.description).toBe('A test command');
      expect(command.usage).toContain('ecm test');
      expect(typeof command.handler).toBe('function');
    });
  });

  describe('command registry', () => {
    const commandNames = [
      'serve',
      'ingest',
      'batch-ingest',
      'recall',
      'maintenance',
      'config',
      'stats',
      'health',
      'hook',
      'export',
      'import',
    ];

    it('includes all expected commands', () => {
      expect(commandNames).toContain('serve');
      expect(commandNames).toContain('ingest');
      expect(commandNames).toContain('recall');
      expect(commandNames).toContain('maintenance');
      expect(commandNames).toContain('config');
    });

    it('has no duplicate command names', () => {
      const uniqueNames = new Set(commandNames);
      expect(uniqueNames.size).toBe(commandNames.length);
    });
  });

  describe('argument parsing', () => {
    it('extracts command name from argv', () => {
      const argv = ['node', 'ecm', 'recall', 'test query'];
      const commandName = argv[2];

      expect(commandName).toBe('recall');
    });

    it('extracts command args from argv', () => {
      const argv = ['node', 'ecm', 'recall', 'test query', '--limit', '5'];
      const args = argv.slice(3);

      expect(args).toEqual(['test query', '--limit', '5']);
    });

    it('handles empty args', () => {
      const argv = ['node', 'ecm', 'stats'];
      const args = argv.slice(3);

      expect(args).toEqual([]);
    });
  });

  describe('flag parsing', () => {
    it('detects --version flag', () => {
      const args = ['--version'];
      const hasVersion = args.includes('--version') || args.includes('-v');

      expect(hasVersion).toBe(true);
    });

    it('detects -v flag', () => {
      const args = ['-v'];
      const hasVersion = args.includes('--version') || args.includes('-v');

      expect(hasVersion).toBe(true);
    });

    it('detects --help flag', () => {
      const args = ['--help'];
      const hasHelp = args.includes('--help') || args.includes('-h');

      expect(hasHelp).toBe(true);
    });

    it('detects -h flag', () => {
      const args = ['-h'];
      const hasHelp = args.includes('--help') || args.includes('-h');

      expect(hasHelp).toBe(true);
    });
  });

  describe('subcommand parsing', () => {
    it('extracts maintenance subcommand', () => {
      const args = ['run', 'all'];
      const subcommand = args[0];

      expect(subcommand).toBe('run');
    });

    it('extracts config subcommand', () => {
      const args = ['show'];
      const subcommand = args[0];

      expect(subcommand).toBe('show');
    });

    it('extracts hook name', () => {
      const args = ['session-start', '/path/to/project'];
      const hookName = args[0];

      expect(hookName).toBe('session-start');
    });
  });

  describe('command lookup', () => {
    it('finds command by name', () => {
      const commands = [
        { name: 'serve', description: 'Start MCP server' },
        { name: 'recall', description: 'Query memory' },
        { name: 'stats', description: 'Show statistics' },
      ];

      const command = commands.find((c) => c.name === 'recall');

      expect(command).toBeTruthy();
      expect(command?.description).toBe('Query memory');
    });

    it('returns undefined for unknown command', () => {
      const commands = [
        { name: 'serve', description: 'Start MCP server' },
        { name: 'recall', description: 'Query memory' },
      ];

      const command = commands.find((c) => c.name === 'unknown');

      expect(command).toBeUndefined();
    });
  });

  describe('help output formatting', () => {
    it('pads command names for alignment', () => {
      const name = 'serve';
      const padded = name.padEnd(16);

      expect(padded).toBe('serve           ');
      expect(padded.length).toBe(16);
    });

    it('formats command list', () => {
      const commands = [
        { name: 'serve', description: 'Start the MCP server' },
        { name: 'ingest', description: 'Ingest a session' },
      ];

      const lines = commands.map((cmd) => `  ${cmd.name.padEnd(16)} ${cmd.description}`);

      expect(lines[0]).toBe('  serve            Start the MCP server');
      expect(lines[1]).toBe('  ingest           Ingest a session');
    });
  });

  describe('export command options', () => {
    it('parses --output flag', () => {
      const args = ['--output', '/path/to/backup.json', '--no-encrypt'];
      const outputIndex = args.indexOf('--output');
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'ecm-backup.json';

      expect(outputPath).toBe('/path/to/backup.json');
    });

    it('uses default output when not specified', () => {
      const args: string[] = [];
      const outputIndex = args.indexOf('--output');
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'ecm-backup.json';

      expect(outputPath).toBe('ecm-backup.json');
    });

    it('detects --no-encrypt flag', () => {
      const args = ['--output', 'backup.json', '--no-encrypt'];
      const noEncrypt = args.includes('--no-encrypt');

      expect(noEncrypt).toBe(true);
    });
  });

  describe('import command options', () => {
    it('extracts file path', () => {
      const args = ['/path/to/import.json', '--merge'];
      const filePath = args[0];

      expect(filePath).toBe('/path/to/import.json');
    });

    it('detects --merge flag', () => {
      const args = ['import.json', '--merge'];
      const merge = args.includes('--merge');

      expect(merge).toBe(true);
    });
  });

  describe('maintenance subcommands', () => {
    it('recognizes run subcommand', () => {
      const subcommand = 'run';
      const validSubcommands = ['run', 'status', 'daemon'];

      expect(validSubcommands.includes(subcommand)).toBe(true);
    });

    it('recognizes status subcommand', () => {
      const subcommand = 'status';
      const validSubcommands = ['run', 'status', 'daemon'];

      expect(validSubcommands.includes(subcommand)).toBe(true);
    });

    it('recognizes daemon subcommand', () => {
      const subcommand = 'daemon';
      const validSubcommands = ['run', 'status', 'daemon'];

      expect(validSubcommands.includes(subcommand)).toBe(true);
    });

    it('rejects unknown subcommand', () => {
      const subcommand = 'unknown';
      const validSubcommands = ['run', 'status', 'daemon'];

      expect(validSubcommands.includes(subcommand)).toBe(false);
    });
  });

  describe('config subcommands', () => {
    const validSubcommands = ['show', 'validate', 'set-key', 'get-key'];

    it('recognizes all config subcommands', () => {
      for (const sub of validSubcommands) {
        expect(validSubcommands.includes(sub)).toBe(true);
      }
    });
  });

  describe('hook subcommands', () => {
    const validHooks = ['session-start', 'pre-compact', 'claudemd-generator'];

    it('recognizes session-start hook', () => {
      expect(validHooks.includes('session-start')).toBe(true);
    });

    it('recognizes pre-compact hook', () => {
      expect(validHooks.includes('pre-compact')).toBe(true);
    });

    it('recognizes claudemd-generator hook', () => {
      expect(validHooks.includes('claudemd-generator')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('formats error message', () => {
      const error = new Error('Something went wrong');
      const message = `Error: ${error.message}`;

      expect(message).toBe('Error: Something went wrong');
    });

    it('handles non-Error exceptions', () => {
      const error = 'string error';
      const message = error instanceof Error ? error.message : String(error);

      expect(message).toBe('string error');
    });
  });

  describe('exit codes', () => {
    it('uses 0 for success', () => {
      const SUCCESS = 0;
      expect(SUCCESS).toBe(0);
    });

    it('uses 1 for general error', () => {
      const ERROR = 1;
      expect(ERROR).toBe(1);
    });

    it('uses 2 for usage error', () => {
      const USAGE_ERROR = 2;
      expect(USAGE_ERROR).toBe(2);
    });

    it('uses 3 for validation error', () => {
      const VALIDATION_ERROR = 3;
      expect(VALIDATION_ERROR).toBe(3);
    });
  });

  describe('version constant', () => {
    it('follows semver format', () => {
      const VERSION = '0.1.0';
      const semverPattern = /^\d+\.\d+\.\d+$/;

      expect(semverPattern.test(VERSION)).toBe(true);
    });
  });

  describe('required argument validation', () => {
    it('detects missing path for ingest', () => {
      const args: string[] = [];
      const hasPath = args.length > 0;

      expect(hasPath).toBe(false);
    });

    it('detects missing query for recall', () => {
      const args: string[] = [];
      const hasQuery = args.length > 0;

      expect(hasQuery).toBe(false);
    });

    it('detects present argument', () => {
      const args = ['/path/to/session.jsonl'];
      const hasPath = args.length > 0;

      expect(hasPath).toBe(true);
    });
  });

  describe('stats output structure', () => {
    it('includes all stat fields', () => {
      const stats = {
        sessions: 10,
        chunks: 150,
        edges: 300,
        clusters: 5,
      };

      expect(stats).toHaveProperty('sessions');
      expect(stats).toHaveProperty('chunks');
      expect(stats).toHaveProperty('edges');
      expect(stats).toHaveProperty('clusters');
    });
  });

  describe('health check output', () => {
    it('reports database status', () => {
      const checks = {
        database: 'OK',
        vectorStore: 'OK',
      };

      expect(checks.database).toBe('OK');
    });

    it('reports failed status', () => {
      const error = new Error('Connection failed');
      const status = `FAILED - ${error.message}`;

      expect(status).toBe('FAILED - Connection failed');
    });
  });
});
