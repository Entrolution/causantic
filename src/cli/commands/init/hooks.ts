import * as fs from 'node:fs';

export async function configureHooks(claudeConfigPath: string): Promise<void> {
  try {
    const settingsContent = fs.readFileSync(claudeConfigPath, 'utf-8');
    const config = JSON.parse(settingsContent);

    const causanticHooks = [
      {
        event: 'PreCompact',
        matcher: '',
        hook: {
          type: 'command',
          command: `npx causantic hook pre-compact`,
          timeout: 300,
          async: true,
        },
      },
      {
        event: 'SessionStart',
        matcher: '',
        hook: {
          type: 'command',
          command: `npx causantic hook session-start`,
          timeout: 60,
        },
      },
      {
        event: 'SessionEnd',
        matcher: '',
        hook: {
          type: 'command',
          command: `npx causantic hook session-end`,
          timeout: 300,
          async: true,
        },
      },
      {
        event: 'SessionEnd',
        matcher: '',
        hook: {
          type: 'command',
          command: `npx causantic hook claudemd-generator`,
          timeout: 60,
          async: true,
        },
      },
    ];

    if (!config.hooks) {
      config.hooks = {};
    }

    // Extract the hook subcommand (e.g. "hook pre-compact") used to detect
    // existing entries regardless of the install path that preceded it.
    const hookSubcommand = (cmd: string): string => {
      const match = cmd.match(/hook\s+\S+/);
      return match ? match[0] : cmd;
    };

    let hooksChanged = 0;
    for (const { event, matcher, hook } of causanticHooks) {
      if (!config.hooks[event]) {
        config.hooks[event] = [];
      }

      const subCmd = hookSubcommand(hook.command);

      // Check if an identical entry already exists (same hook object).
      const hookStr = JSON.stringify(hook);
      const exactMatch = config.hooks[event].some(
        (entry: { hooks?: Array<Record<string, unknown>> }) =>
          entry.hooks?.some((h: Record<string, unknown>) => JSON.stringify(h) === hookStr),
      );

      if (exactMatch) continue;

      // Remove any stale entries for the same hook subcommand (e.g. from a
      // different install path) so we don't accumulate duplicates.
      config.hooks[event] = config.hooks[event].filter(
        (entry: { hooks?: Array<{ command?: string }> }) =>
          !entry.hooks?.some(
            (h: { command?: string }) => h.command && hookSubcommand(h.command) === subCmd,
          ),
      );

      config.hooks[event].push({
        matcher,
        hooks: [hook],
      });
      hooksChanged++;
    }

    if (hooksChanged > 0) {
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
      const hookNames = causanticHooks.map((h) => h.event).join(', ');
      console.log(`\u2713 Configured ${hooksChanged} Claude Code hooks (${hookNames})`);
    } else {
      console.log('\u2713 Claude Code hooks already configured');
    }
  } catch {
    console.log('\u26a0 Could not configure Claude Code hooks');
  }
}
