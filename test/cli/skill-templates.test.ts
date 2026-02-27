/**
 * Tests for Causantic skill templates and installation logic.
 */

import { describe, it, expect } from 'vitest';
import { CAUSANTIC_SKILLS, getMinimalClaudeMdBlock } from '../../src/cli/skill-templates.js';

describe('skill-templates', () => {
  describe('CAUSANTIC_SKILLS', () => {
    it('has 10 skill templates', () => {
      expect(CAUSANTIC_SKILLS.length).toBe(10);
    });

    it('includes causantic-recall skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-recall');
      expect(skill).toBeDefined();
    });

    it('includes causantic-search skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-search');
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

    it('includes causantic-reconstruct skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-reconstruct');
      expect(skill).toBeDefined();
    });

    it('includes causantic-resume skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-resume');
      expect(skill).toBeDefined();
    });

    it('includes causantic-cleanup skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-cleanup');
      expect(skill).toBeDefined();
    });

    it('does not include removed skills', () => {
      const removed = ['causantic-explain', 'causantic-debug', 'causantic-summary', 'causantic-crossref', 'causantic-retro'];
      for (const name of removed) {
        expect(CAUSANTIC_SKILLS.find((s) => s.dirName === name)).toBeUndefined();
      }
    });

    it('includes causantic-forget skill', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-forget');
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

    it('causantic-search has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-search')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('causantic-predict has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-predict')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('no skill references phantom range parameter', () => {
      for (const skill of CAUSANTIC_SKILLS) {
        expect(skill.content).not.toMatch(/range:\s*"(short|long)"/);
      }
    });

    it('causantic-recall mentions project parameter', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-recall')!;
      expect(skill.content).toContain('project');
    });

    it('causantic-search references the search MCP tool', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-search')!;
      expect(skill.content).toContain('`search` MCP tool');
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

    // New skill content tests
    it('causantic-resume has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-resume')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('causantic-resume references reconstruct and recall tools', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-resume')!;
      expect(skill.content).toContain('`reconstruct`');
      expect(skill.content).toContain('`recall`');
    });

    it('causantic-resume has interpreting user intent table', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-resume')!;
      expect(skill.content).toContain('Interpreting User Intent');
      expect(skill.content).toContain('previous_session');
    });


    it('causantic-cleanup does not have argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-cleanup')!;
      expect(skill.content).not.toContain('argument-hint:');
    });


    it('causantic-predict documents context as required parameter', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-predict')!;
      expect(skill.content).toContain('**context** (required)');
      expect(skill.content).not.toContain('**query** (optional)');
    });

    it('causantic-cleanup has phases with checkpoints', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-cleanup')!;
      expect(skill.content).toContain('Phase 1');
      expect(skill.content).toContain('Phase 2');
      expect(skill.content).toContain('Phase 3');
      expect(skill.content).toContain('Phase 4');
      expect(skill.content).toContain('CHECKPOINT');
    });

    it('causantic-cleanup mentions planning mode', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-cleanup')!;
      expect(skill.content).toContain('planning mode');
    });

    it('causantic-cleanup references memory tools in Phase 1.5', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-cleanup')!;
      expect(skill.content).toContain('`recall`');
      expect(skill.content).toContain('`search`');
      expect(skill.content).toContain('Phase 1.5');
      expect(skill.content).toContain('max_tokens: 8000');
    });

    it('causantic-forget has argument-hint', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-forget')!;
      expect(skill.content).toContain('argument-hint:');
    });

    it('causantic-forget references forget MCP tool', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-forget')!;
      expect(skill.content).toContain('`forget` MCP tool');
    });

    it('causantic-forget mentions dry_run parameter', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-forget')!;
      expect(skill.content).toContain('dry_run');
    });

    it('causantic-forget mentions query and threshold parameters', () => {
      const skill = CAUSANTIC_SKILLS.find((s) => s.dirName === 'causantic-forget')!;
      expect(skill.content).toContain('**query**');
      expect(skill.content).toContain('**threshold**');
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

    it('references all 10 Causantic skills', () => {
      expect(block).toContain('/causantic-recall');
      expect(block).toContain('/causantic-search');
      expect(block).toContain('/causantic-predict');
      expect(block).toContain('/causantic-list-projects');
      expect(block).toContain('/causantic-reconstruct');
      expect(block).toContain('/causantic-resume');
      expect(block).toContain('/causantic-cleanup');
      expect(block).toContain('/causantic-roadmap');
      expect(block).toContain('/causantic-status');
      expect(block).toContain('/causantic-forget');
    });

    it('does not reference removed skills', () => {
      expect(block).not.toContain('/causantic-context');
      expect(block).not.toContain('/causantic-explain');
      expect(block).not.toContain('/causantic-debug');
      expect(block).not.toContain('/causantic-summary');
      expect(block).not.toContain('/causantic-crossref');
      expect(block).not.toContain('/causantic-retro');
    });

    it('has proactive memory usage section', () => {
      expect(block).toContain('Proactive Memory Usage');
      expect(block).toContain('Check memory');
      expect(block).toContain('Skip memory');
    });

    it('has combining memory with other tools section', () => {
      expect(block).toContain('Combining Memory with Other Tools');
      expect(block).toContain('verify');
    });

    it('has CLI commands reference section', () => {
      expect(block).toContain('### CLI Commands');
      expect(block).toContain('npx causantic init');
      expect(block).toContain('npx causantic serve');
      expect(block).toContain('npx causantic dashboard');
      expect(block).toContain('npx causantic batch-ingest');
      expect(block).toContain('npx causantic benchmark-collection');
      expect(block).toContain('npx causantic export');
      expect(block).toContain('npx causantic uninstall');
    });

    it('includes concise guidance', () => {
      expect(block).toContain('search');
      expect(block).toContain('recall');
      expect(block).toContain('reconstruct');
    });

    it('groups skills by use case', () => {
      expect(block).toContain('Retrieval:');
      expect(block).toContain('Session navigation:');
      expect(block).toContain('Planning:');
      expect(block).toContain('Memory management:');
    });

    it('has quick decision guide', () => {
      expect(block).toContain('Quick Decision Guide');
      expect(block).toContain('search');
      expect(block).toContain('recall');
      expect(block).toContain('predict');
    });
  });

  describe('skill installation simulation', () => {
    it('generates correct directory paths', () => {
      const skillsBase = '/home/user/.claude/skills';
      const paths = CAUSANTIC_SKILLS.map((s) => `${skillsBase}/${s.dirName}/SKILL.md`);

      expect(paths).toContain(`${skillsBase}/causantic-recall/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-search/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-predict/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-list-projects/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-reconstruct/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-resume/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-status/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-cleanup/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-roadmap/SKILL.md`);
      expect(paths).toContain(`${skillsBase}/causantic-forget/SKILL.md`);
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
      const updated =
        existing.slice(0, startIdx) + newBlock + existing.slice(endIdx + CAUSANTIC_END.length);

      // Should contain new block
      expect(updated).toContain('/causantic-recall');
      expect(updated).toContain('/causantic-resume');
      expect(updated).toContain('/causantic-cleanup');
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
      expect(updated).toContain('/causantic-resume');
    });
  });
});
