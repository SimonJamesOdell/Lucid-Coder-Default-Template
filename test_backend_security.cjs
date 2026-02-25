const { spawn } = require('child_process');
const net = require('net');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // retry
    }
    await sleep(250);
  }
  throw new Error('Backend did not become healthy in time');
}

function startServer(env) {
  const child = spawn(process.execPath, ['backend_dist/server.cjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk || '');
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  return { child, getLogs: () => ({ stdout, stderr }) };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function expectProductionGuardFailure() {
  const port = Number(process.env.SMOKE_BACKEND_PORT_GUARD || (await findFreePort()));
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    CORS_ORIGINS: process.env.CORS_ORIGINS || 'https://example.com',
  };
  delete env.JWT_SECRET;

  const { child, getLogs } = startServer(env);

  const exitCode = await new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), 4000);
    child.once('exit', (code) => {
      clearTimeout(timeoutId);
      resolve(code);
    });
  });

  if (exitCode === null) {
    child.kill('SIGTERM');
    throw new Error('Expected production startup to fail without JWT secret, but process did not exit');
  }

  if (exitCode === 0) {
    throw new Error('Expected non-zero exit when JWT secret is missing in production mode');
  }

  const logs = getLogs();
  const combined = `${logs.stdout}\n${logs.stderr}`;
  if (!combined.includes('Missing required JWT secret env var in production')) {
    throw new Error('Production guard failed, but expected missing JWT secret message was not found');
  }
}

async function expectRateLimitingWorks() {
  const port = Number(process.env.SMOKE_BACKEND_PORT_RATE || (await findFreePort()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    JWT_SECRET: process.env.JWT_SECRET || 'security-test-secret',
    CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:5201,http://127.0.0.1:5201',
  };

  const { child } = startServer(env);

  try {
    await waitForHealth(baseUrl, 8000);

    let saw429 = false;
    for (let index = 0; index < 12; index += 1) {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
      });

      if (response.status === 429) {
        saw429 = true;
        break;
      }
    }

    if (!saw429) {
      throw new Error('Expected rate limiter to return 429 for repeated auth attempts');
    }
  } finally {
    child.kill('SIGTERM');
    await sleep(200);
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }
}

async function runSecurityTest() {
  await expectProductionGuardFailure();
  await expectRateLimitingWorks();
  console.log('Backend security test passed.');
}

if (require.main === module) {
  runSecurityTest().catch((error) => {
    console.error(`Backend security test failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runSecurityTest,
};
