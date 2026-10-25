import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { e2eBatches } from './e2e-batches.mjs';

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
for (const args of e2eBatches(process.argv.slice(2))) {
  const code = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit', windowsHide: true });
    const stop = () => child.kill();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.on('error', reject);
    child.on('exit', (code) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      accept(code ?? 1);
    });
  });
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}
