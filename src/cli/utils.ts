/**
 * Shared CLI utilities.
 */

/** Magic bytes for encrypted archives */
export const ENCRYPTED_MAGIC = Buffer.from('ECM\x00');

/**
 * Prompt for password with hidden input.
 * Falls back to visible input if raw mode is not available.
 */
export async function promptPassword(prompt: string): Promise<string> {
  const readline = await import('node:readline');

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Check if we can use raw mode for hidden input
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let password = '';
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode!(false);
          process.stdin.removeListener('data', onData);
          process.stdin.pause();
          console.log(''); // newline
          rl.close();
          resolve(password);
        } else if (c === '\u0003') {
          // Ctrl+C
          process.stdin.setRawMode!(false);
          process.exit(0);
        } else if (c === '\u007F' || c === '\b') {
          // Backspace
          password = password.slice(0, -1);
        } else if (c.charCodeAt(0) >= 32) {
          // Printable character
          password += c;
        }
      };
      process.stdin.on('data', onData);
    } else {
      // Fallback to visible input (non-TTY environments)
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Check if a file is an encrypted ECM archive.
 */
export async function isEncryptedArchive(filePath: string): Promise<boolean> {
  const fs = await import('node:fs');
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    return header.equals(ENCRYPTED_MAGIC);
  } catch {
    return false;
  }
}
