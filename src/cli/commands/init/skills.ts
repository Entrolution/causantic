import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export async function installSkillsAndClaudeMd(): Promise<void> {
  const { CAUSANTIC_SKILLS, getMinimalClaudeMdBlock } = await import('../../skill-templates.js');

  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  let skillsInstalled = 0;

  for (const skill of CAUSANTIC_SKILLS) {
    try {
      const skillDir = path.join(skillsDir, skill.dirName);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill.content);
      skillsInstalled++;
    } catch {
      console.log(`\u26a0 Could not install skill: ${skill.dirName}`);
    }
  }

  if (skillsInstalled > 0) {
    console.log(`\u2713 Installed ${skillsInstalled} Causantic skills to ~/.claude/skills/`);
  }

  // Clean up removed skills (causantic-context merged into causantic-explain)
  const removedSkills = [
    'causantic-context',
    'causantic-explain',
    'causantic-debug',
    'causantic-summary',
    'causantic-crossref',
    'causantic-retro',
  ];
  for (const name of removedSkills) {
    const removedDir = path.join(skillsDir, name);
    if (fs.existsSync(removedDir)) {
      try {
        fs.rmSync(removedDir, { recursive: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  const CAUSANTIC_START = '<!-- CAUSANTIC_MEMORY_START -->';
  const CAUSANTIC_END = '<!-- CAUSANTIC_MEMORY_END -->';
  const memoryInstructions = getMinimalClaudeMdBlock();

  try {
    let claudeMd = '';
    if (fs.existsSync(claudeMdPath)) {
      claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
    }

    if (claudeMd.includes(CAUSANTIC_START)) {
      const startIdx = claudeMd.indexOf(CAUSANTIC_START);
      const endIdx = claudeMd.indexOf(CAUSANTIC_END);
      if (endIdx > startIdx) {
        claudeMd =
          claudeMd.slice(0, startIdx) +
          memoryInstructions +
          claudeMd.slice(endIdx + CAUSANTIC_END.length);
        fs.writeFileSync(claudeMdPath, claudeMd);
        console.log('\u2713 Updated CLAUDE.md with skill references');
      }
    } else {
      const separator = claudeMd.length > 0 && !claudeMd.endsWith('\n\n') ? '\n' : '';
      fs.writeFileSync(claudeMdPath, claudeMd + separator + memoryInstructions + '\n');
      console.log('\u2713 Added Causantic reference to CLAUDE.md');
    }
  } catch {
    console.log('\u26a0 Could not update CLAUDE.md');
  }
}
