import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the CLI entry point path for MCP/hook configuration. */
export function getCliEntryPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.js');
}

/** Create a terminal spinner for progress display. */
export function createSpinner() {
  const frames = [
    '\u280b',
    '\u2819',
    '\u2839',
    '\u2838',
    '\u283c',
    '\u2834',
    '\u2826',
    '\u2827',
    '\u2807',
    '\u280f',
  ];
  let idx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let text = '';

  const writeLine = (line: string) => {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K' + line);
    }
  };

  return {
    start(label: string) {
      if (!process.stdout.isTTY) return;
      text = label;
      idx = 0;
      writeLine(`${frames[0]} ${text}`);
      timer = setInterval(() => {
        idx = (idx + 1) % frames.length;
        writeLine(`${frames[idx]} ${text}`);
      }, 80);
    },
    update(label: string) {
      text = label;
    },
    stop(doneText?: string) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write('\r\x1b[K');
      }
      if (doneText) {
        console.log(doneText);
      }
    },
  };
}
