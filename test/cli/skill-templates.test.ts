/**
 * Tests for Causantic skill templates and installation logic.
 */

import { describe, it, expect } from 'vitest';
import { CAUSANTIC_SKILLS, getMinimalClaudeMdBlock } from '../../src/cli/skill-templates.js';

describe('skill-templates', () => {
  describe('CAUSANTIC_SKILLS', () => {
    it('has 5 skill templates', () => {
      expect(CAUSANTIC_SKILLS.length).toBe(5);
    });

    it('includes causantic-recall skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-recall');
      expect(skill).toBeDefined();
    });

    it('includes causantic-explain skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-explain');
      expect(skill).toBeDefined();
    });

    it('includes causantic-predict skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-predict');
      expect(skill).toBeDefined();
    });

    it('includes causantic-list-projects skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-list-projects');
      expect(skill).toBeDefined();
    });

    it('all skills have unique directory names', () => {
      const names = CAUSANTIC_SKILLS.map((s) => s.dirName);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('SKILL.md frontmatter', () => {
    for (const skill of CAUSANTIC_SKILLS) {
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

        it('references causantic MCP server', () => {
          expect(skill.content).toContain('causantic');
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
    it('causantic-recall has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-recall')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('causantic-explain has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-explain')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('causantic-predict has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-predict')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('causantic-recall mentions range parameter', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-recall')!;
      expect(skill.content).toContain('range');
      expect(skill.content).toContain('"short"');
      expect(skill.content).toContain('"long"');
    });

    it('causantic-recall mentions project parameter', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-recall')!;
      expect(skill.content).toContain('project');
    });

    it('causantic-explain references the explain MCP tool', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-explain')!;
      expect(skill.content).toContain('`explain` MCP tool');
    });

    it('causantic-predict references the predict MCP tool', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-predict')!;
      expect(skill.content).toContain('`predict` MCP tool');
    });

    it('causantic-list-projects references the list-projects MCP tool', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-list-projects')!;
      expect(skill.content).toContain('`list-projects` MCP tool');
    });

    it('causantic-list-projects does not have argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-list-projects')!;
      expect(skill.content).not.toContain('argument-hint:');
    });
  });

  describe('getMinimalClaudeMdBlock', () => {
    const block = getMinimalClaudeMdBlock();

    it('starts with CAUSANTIC_MEMORY_START marker', () => {
      expect(block).toContain('<!-- CAUSANTIC_MEMORY_START -->');
    });

    it('ends with CAUSANTIC_MEMORY_END marker', () => {
      expect(block).toContain('<!-- CAUSANTIC_MEMORY_END -->');
    });

    it('references causantic MCP server', () => {
      expect(block).toContain('causantic');
    });

    it('references all 4 Causantic skills', () => {
      expect(block).toContain('/causantic-recall');
      expect(block).toContain('/causantic-explain');
      expect(block).toContain('/causantic-predict');
      expect(block).toContain('/causantic-list-projects');
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
      const paths = CAUSANTIC_SKILLS.map((s) => `${skillsBase}/${s.dirName}/SKILL.md`);

      expect(paths).toContain(`${skillsBase}/causantic-recall/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-explain/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-predict/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-list-projects/SKILL.md`);
    });

    it('CLAUDEMD replacement handles existing markers', () => {
      const CAUSANTIC_START = '<!-- CAUSANTIC_MEMORY_START -->';
      const CAUSANTIC_END = '<!-- CAUSANTIC_MEMORY_END -->';

      const existing = `# My CLAUDE.md
Some instructions here.

${CAUSANTIC_START}
## Old verbose instructions
Lots of text here...
${CAUSANTIC_END}

More instructions below.`;

      const newBlock = getMinimalClaudeMdBlock();

      const startIdx = existing.indexOf(CAUSANTIC_START);
      const endIdx = existing.indexOf(CAUSANTIC_END);
      const updated = existing.slice(0, startIdx) + newBlock + existing.slice(endIdx + CAUSANTIC_END.length);

      // Should contain new block
      expect(updated).toContain('/causantic-recall');
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
      expect(updated).toContain('/causantic-recall');
    });
  });
});
