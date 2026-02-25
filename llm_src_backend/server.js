import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const generatedServerPath = path.resolve(currentDir, '..', 'backend_dist', 'server.cjs');

if (!existsSync(generatedServerPath)) {
  throw new Error('Missing generated backend runtime at backend_dist/server.cjs. Run `npm run build:llm` first.');
}

await import(pathToFileURL(generatedServerPath).href);
