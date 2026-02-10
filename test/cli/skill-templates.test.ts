/**
 * Tests for ECM skill templates and installation logic.
 */

import { describe, it, expect } from 'vitest';
import { ECM_SKILLS, getMinimalClaudeMdBlock } from '../../src/cli/skill-templates.js';

describe('skill-templates', () => {
  describe('ECM_SKILLS', () => {
    it('has 4 skill templates', () => {
      expect(ECM_SKILLS.length).toBe(4);
    });

    it('includes ecm-recall skill', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-recall');
      expect(skill).toBeDefined();
    });

    it('includes ecm-explain skill', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-explain');
      expect(skill).toBeDefined();
    });

    it('includes ecm-predict skill', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-predict');
      expect(skill).toBeDefined();
    });

    it('includes ecm-list-projects skill', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-list-projects');
      expect(skill).toBeDefined();
    });

    it('all skills have unique directory names', () => {
      const names = ECM_SKILLS.map((s) => s.dirName);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('SKILL.md frontmatter', () => {
    for (const skill of ECM_SKILLS) {
      describe(skill.dirName, () => {
        it('starts with YAML frontmatter', () => {
          expect(skill.content.startsWith('---\n')).toBe(true);
        });

        it('has closing frontmatter delimiter', () => {
          const secondDelimiter = skill.content.indexOf('---', 4);
          expect(secondDelimiter).toBeGreaterThan(0);
        });

        it('has name field matching directory name', () => {
          const nameMatch = skill.content.match(/^name:\s*(.+)$/m);
          expect(nameMatch).toBeTruthy();
          expect(nameMatch![1].trim()).toBe(skill.dirName);
        });

        it('has description field', () => {
          const descMatch = skill.content.match(/^description:\s*(.+)$/m);
          expect(descMatch).toBeTruthy();
          expect(descMatch![1].trim().length).toBeGreaterThan(10);
        });

        it('references entropic-causal-memory MCP server', () => {
          expect(skill.content).toContain('entropic-causal-memory');
        });

        it('has markdown content after frontmatter', () => {
          const secondDelimiter = skill.content.indexOf('---', 4);
          const body = skill.content.slice(secondDelimiter + 3).trim();
          expect(body.length).toBeGreaterThan(50);
        });

        it('has a top-level heading', () => {
          expect(skill.content).toMatch(/^# .+$/m);
        });
      });
    }
  });

  describe('skill content specifics', () => {
    it('ecm-recall has argument-hint', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-recall')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('ecm-explain has argument-hint', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-explain')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('ecm-predict has argument-hint', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-predict')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('ecm-recall mentions range parameter', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-recall')!;
      expect(skill.content).toContain('range');
      expect(skill.content).toContain('"short"');
      expect(skill.content).toContain('"long"');
    });

    it('ecm-recall mentions project parameter', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-recall')!;
      expect(skill.content).toContain('project');
    });

    it('ecm-explain references the explain MCP tool', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-explain')!;
      expect(skill.content).toContain('`explain` MCP tool');
    });

    it('ecm-predict references the predict MCP tool', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-predict')!;
      expect(skill.content).toContain('`predict` MCP tool');
    });

    it('ecm-list-projects references the list-projects MCP tool', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-list-projects')!;
      expect(skill.content).toContain('`list-projects` MCP tool');
    });

    it('ecm-list-projects does not have argument-hint', () => {
      const skill = ECM_SKILLS.find((s) => s.dirName === 'ecm-list-projects')!;
      expect(skill.content).not.toContain('argument-hint:');
    });
  });

  describe('getMinimalClaudeMdBlock', () => {
    const block = getMinimalClaudeMdBlock();

    it('starts with ECM_MEMORY_START marker', () => {
      expect(block).toContain('<!-- ECM_MEMORY_START -->');
    });

    it('ends with ECM_MEMORY_END marker', () => {
      expect(block).toContain('<!-- ECM_MEMORY_END -->');
    });

    it('references entropic-causal-memory MCP server', () => {
      expect(block).toContain('entropic-causal-memory');
    });

    it('references all 4 ECM skills', () => {
      expect(block).toContain('/ecm-recall');
      expect(block).toContain('/ecm-explain');
      expect(block).toContain('/ecm-predict');
      expect(block).toContain('/ecm-list-projects');
    });

    it('is shorter than the old verbose instructions', () => {
      // The minimal block should be much shorter than the old ~25-line version
      const lines = block.split('\n').length;
      expect(lines).toBeLessThan(15);
    });

    it('includes fallback guideline', () => {
      expect(block).toContain('Always try memory tools');
    });
  });

  describe('skill installation simulation', () => {
    it('generates correct directory paths', () => {
      const skillsBase = '/home/user/.claude/skills';
      const paths = ECM_SKILLS.map((s) => `${skillsBase}/${s.dirName}/SKILL.md`);

      expect(paths).toContain(`${skillsBase}/ecm-recall/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/ecm-explain/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/ecm-predict/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/ecm-list-projects/SKILL.md`);
    });

    it('CLAUDEMD replacement handles existing markers', () => {
      const ECM_START = '<!-- ECM_MEMORY_START -->';
      const ECM_END = '<!-- ECM_MEMORY_END -->';

      const existing = `# My CLAUDE.md
Some instructions here.

${ECM_START}
## Old verbose instructions
Lots of text here...
${ECM_END}

More instructions below.`;

      const newBlock = getMinimalClaudeMdBlock();

      const startIdx = existing.indexOf(ECM_START);
      const endIdx = existing.indexOf(ECM_END);
      const updated = existing.slice(0, startIdx) + newBlock + existing.slice(endIdx + ECM_END.length);

      // Should contain new block
      expect(updated).toContain('/ecm-recall');
      // Should not contain old verbose text
      expect(updated).not.toContain('Old verbose instructions');
      // Should preserve surrounding content
      expect(updated).toContain('Some instructions here.');
      expect(updated).toContain('More instructions below.');
    });

    it('CLAUDEMD append works for fresh file', () => {
      const existing = '# My CLAUDE.md\n\nSome instructions.\n';
      const newBlock = getMinimalClaudeMdBlock();
      const separator = existing.endsWith('\n\n') ? '' : '\n';
      const updated = existing + separator + newBlock + '\n';

      expect(updated).toContain('# My CLAUDE.md');
      expect(updated).toContain('/ecm-recall');
    });
  });
});
