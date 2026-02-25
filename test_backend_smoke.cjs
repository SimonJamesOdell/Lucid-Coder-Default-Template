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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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

async function runSmoke() {
  const port = Number(process.env.SMOKE_BACKEND_PORT || (await findFreePort()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const email = `smoke_${Date.now()}@example.com`;
  const password = 'pw12345smoke';
  const name = 'Smoke User';

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    JWT_SECRET: process.env.JWT_SECRET || 'smoke-dev-secret',
    CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:5201,http://127.0.0.1:5201',
  };

  const backendProcess = spawn(process.execPath, ['backend_dist/server.cjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  backendProcess.stdout.on('data', (chunk) => {
    stdout += String(chunk || '');
  });
  backendProcess.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  let processExited = false;
  backendProcess.on('exit', () => {
    processExited = true;
  });

  try {
    await waitForHealth(baseUrl, 8000);

    const signup = await postJson(`${baseUrl}/api/signup`, { email, password, name });
    if (!signup.response.ok) {
      throw new Error(`Signup failed: ${signup.response.status} ${JSON.stringify(signup.payload)}`);
    }
    if (!signup.payload.token || !signup.payload.user || signup.payload.user.email !== email) {
      throw new Error('Signup response missing expected token/user payload');
    }

    const duplicate = await postJson(`${baseUrl}/api/signup`, { email, password, name });
    if (duplicate.response.status !== 409) {
      throw new Error(`Expected duplicate signup to return 409, got ${duplicate.response.status}`);
    }

    const login = await postJson(`${baseUrl}/api/login`, { email, password });
    if (!login.response.ok) {
      throw new Error(`Login failed: ${login.response.status} ${JSON.stringify(login.payload)}`);
    }
    if (!login.payload.token || !login.payload.user || login.payload.user.email !== email) {
      throw new Error('Login response missing expected token/user payload');
    }

    const badLogin = await postJson(`${baseUrl}/api/login`, { email, password: `${password}-wrong` });
    if (badLogin.response.status !== 401) {
      throw new Error(`Expected bad login to return 401, got ${badLogin.response.status}`);
    }

    console.log('Backend smoke test passed.');
  } catch (error) {
    const details = [
      `port=${port}`,
      `processExited=${processExited}`,
      `stdout=${JSON.stringify(stdout.trim())}`,
      `stderr=${JSON.stringify(stderr.trim())}`,
    ].join(' | ');
    throw new Error(`${error.message} (${details})`);
  } finally {
    backendProcess.kill('SIGTERM');
    await sleep(200);
    if (!backendProcess.killed) {
      backendProcess.kill('SIGKILL');
    }
  }
}

if (require.main === module) {
  runSmoke().catch((error) => {
    console.error(`Backend smoke test failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runSmoke,
};
