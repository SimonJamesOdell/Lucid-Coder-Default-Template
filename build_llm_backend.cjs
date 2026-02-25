const fs = require('fs');
const path = require('path');
const { validateInvariants } = require('./validate_llm_invariants.cjs');

const rootDir = __dirname;
const backendManifestPath = path.join(rootDir, 'llm_src_backend', 'manifest.json');
const endpointDir = path.join(rootDir, 'llm_src_backend', 'endpoints');
const outputDir = path.join(rootDir, 'backend_dist');
const outputServerPath = path.join(outputDir, 'server.cjs');
const outputGeneratedManifestPath = path.join(outputDir, 'manifest.generated.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadEndpoints(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(dirPath, name)));
}

function sanitizeEndpoint(endpoint) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    route: endpoint.route,
    method: String(endpoint.method || 'GET').toUpperCase(),
    public: endpoint.public,
    inputs: endpoint.inputs || [],
    outputs: endpoint.outputs || [],
    logic_refs: endpoint.logic_refs || [],
  };
}

function buildServerCode(endpoints, securityPolicy) {
  const safeEndpoints = JSON.stringify(endpoints, null, 2);
  const safePolicy = JSON.stringify(securityPolicy, null, 2);

  return `'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const ENDPOINTS = ${safeEndpoints};
const SECURITY_POLICY = ${safePolicy};

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

const jwtSecretEnv = SECURITY_POLICY.jwt.secret_env;
const jwtSecret = process.env[jwtSecretEnv] || (isProduction ? '' : 'dev-insecure-jwt-secret');
if (!jwtSecret) {
  throw new Error('Missing required JWT secret env var in production: ' + jwtSecretEnv);
}
if (!process.env[jwtSecretEnv] && !isProduction) {
  console.warn('[security] JWT secret env var not set; using development fallback secret.');
}

const corsAllowlistEnv = SECURITY_POLICY.cors.allowlist_env;
let corsAllowlist = String(process.env[corsAllowlistEnv] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (corsAllowlist.length === 0 && !isProduction) {
  corsAllowlist = [
    'http://localhost:5201',
    'http://127.0.0.1:5201',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  console.warn('[security] CORS allowlist env var not set; using localhost-only development allowlist.');
}

if (SECURITY_POLICY.headers && SECURITY_POLICY.headers.helmet) {
  app.use(helmet());
}

app.use(express.json({ limit: SECURITY_POLICY.body.json_limit || '16kb' }));

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (corsAllowlist.length === 0) {
        callback(new Error('CORS origin denied: allowlist is empty'));
        return;
      }
      if (corsAllowlist.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin denied'));
    },
    credentials: Boolean(SECURITY_POLICY.cors.allow_credentials),
  })
);

function createRateLimiter(maxRequests, windowMs) {
  const hits = new Map();
  return function rateLimiter(req, res, next) {
    const bucketKey = req.ip + '::' + req.path;
    const now = Date.now();
    const bucket = hits.get(bucketKey) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    hits.set(bucketKey, bucket);

    if (bucket.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    next();
  };
}

const globalLimiter = createRateLimiter(
  Number(SECURITY_POLICY.rate_limit.max_requests || 20),
  Number(SECURITY_POLICY.rate_limit.window_ms || 60000)
);
const authLimiter = createRateLimiter(
  Number(SECURITY_POLICY.rate_limit.auth_max_requests || 10),
  Number(SECURITY_POLICY.rate_limit.window_ms || 60000)
);

app.use(globalLimiter);

function getEndpoint(name) {
  return ENDPOINTS.find((endpoint) => endpoint.name === name);
}

function requireInputs(body, inputs) {
  for (const key of inputs || []) {
    const value = body[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return key;
    }
  }
  return null;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.email, name: user.name },
    jwtSecret,
    {
      expiresIn: SECURITY_POLICY.jwt.expires_in,
      issuer: SECURITY_POLICY.jwt.issuer,
    }
  );
}

function requireAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, { issuer: SECURITY_POLICY.jwt.issuer });
    req.user = decoded;
    next();
  } catch (_error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

const usersByEmail = new Map();

const loginEndpoint = getEndpoint('login');
if (loginEndpoint) {
  app[loginEndpoint.method.toLowerCase()](loginEndpoint.route, authLimiter, async (req, res) => {
    const missingField = requireInputs(req.body || {}, loginEndpoint.inputs);
    if (missingField) {
      res.status(400).json({ error: 'Missing field: ' + missingField });
      return;
    }

    const email = String(req.body.email || '').toLowerCase();
    const password = String(req.body.password || '');
    const existingUser = usersByEmail.get(email);

    if (!existingUser) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const passwordOk = await bcrypt.compare(password, existingUser.passwordHash);
    if (!passwordOk) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken(existingUser);
    res.json({ token, user: { email: existingUser.email, name: existingUser.name } });
  });
}

const signupEndpoint = getEndpoint('signup');
if (signupEndpoint) {
  app[signupEndpoint.method.toLowerCase()](signupEndpoint.route, authLimiter, async (req, res) => {
    const missingField = requireInputs(req.body || {}, signupEndpoint.inputs);
    if (missingField) {
      res.status(400).json({ error: 'Missing field: ' + missingField });
      return;
    }

    const email = String(req.body.email || '').toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();

    if (usersByEmail.has(email)) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = { email, passwordHash, name };
    usersByEmail.set(email, user);

    const token = signToken(user);
    res.json({ token, user: { email: user.email, name: user.name } });
  });
}

for (const endpoint of ENDPOINTS) {
  if (endpoint.name === 'login' || endpoint.name === 'signup') {
    continue;
  }

  const method = endpoint.method.toLowerCase();
  const middleware = endpoint.public ? [authLimiter] : [authLimiter, requireAuth];
  app[method](endpoint.route, ...middleware, (req, res) => {
    res.status(501).json({
      error: 'Endpoint not implemented',
      endpoint: endpoint.name,
    });
  });
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', security: 'policy-enforced' });
});

app.use((error, req, res, next) => {
  if (error && String(error.message || '').toLowerCase().includes('cors')) {
    res.status(403).json({ error: 'CORS blocked request origin' });
    return;
  }
  next(error);
});

app.listen(PORT, HOST, () => {
  console.log('Backend listening on ' + HOST + ':' + PORT);
});
`;
}

function buildBackendBundle() {
  const { invariants } = validateInvariants();
  const backendManifest = readJson(backendManifestPath);

  const securityPolicyPath = path.join(rootDir, invariants.security_policy.path);
  assert(fs.existsSync(securityPolicyPath), `Missing backend security policy: ${invariants.security_policy.path}`);
  const securityPolicy = readJson(securityPolicyPath);

  const endpoints = loadEndpoints(endpointDir).map(sanitizeEndpoint);
  endpoints.forEach((endpoint) => {
    assert(typeof endpoint.public === 'boolean', `Endpoint ${endpoint.name} must declare explicit boolean public flag`);
    assert(typeof endpoint.route === 'string' && endpoint.route.startsWith('/'), `Endpoint ${endpoint.name} has invalid route`);
    assert(typeof endpoint.method === 'string' && endpoint.method.length > 0, `Endpoint ${endpoint.name} has invalid method`);
  });

  const generatedManifest = {
    generated_at: new Date().toISOString(),
    source: {
      backend_manifest: 'llm_src_backend/manifest.json',
      endpoint_dir: 'llm_src_backend/endpoints',
      security_policy: invariants.security_policy.path,
    },
    middleware: {
      helmet: Boolean(securityPolicy.headers && securityPolicy.headers.helmet),
      cors_allowlist_env: securityPolicy.cors && securityPolicy.cors.allowlist_env,
      rate_limit: securityPolicy.rate_limit || {},
      jwt_secret_env: securityPolicy.jwt && securityPolicy.jwt.secret_env,
      jwt_expires_in: securityPolicy.jwt && securityPolicy.jwt.expires_in,
      jwt_issuer: securityPolicy.jwt && securityPolicy.jwt.issuer,
    },
    entities: {
      manifest_endpoint_ids: backendManifest.endpoints || [],
      endpoint_count: endpoints.length,
    },
    endpoints,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputServerPath, buildServerCode(endpoints, securityPolicy));
  fs.writeFileSync(outputGeneratedManifestPath, JSON.stringify(generatedManifest, null, 2));

  console.log('LLM backend built: backend_dist/server.cjs and backend_dist/manifest.generated.json generated from LLM-optimized backend data.');
}

if (require.main === module) {
  buildBackendBundle();
}

module.exports = {
  buildBackendBundle,
};
