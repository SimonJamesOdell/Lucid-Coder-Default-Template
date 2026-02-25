const fs = require('fs');
const path = require('path');

const rootDir = __dirname;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateBackendRuntime() {
  const generatedManifestPath = path.join(rootDir, 'backend_dist', 'manifest.generated.json');
  const generatedServerPath = path.join(rootDir, 'backend_dist', 'server.cjs');
  const endpointDir = path.join(rootDir, 'llm_src_backend', 'endpoints');

  assert(fs.existsSync(generatedManifestPath), 'Missing generated backend manifest. Run npm run build:llm first.');
  assert(fs.existsSync(generatedServerPath), 'Missing generated backend runtime. Run npm run build:llm first.');

  const generatedManifest = readJson(generatedManifestPath);
  const endpointFiles = fs.readdirSync(endpointDir).filter((name) => name.endsWith('.json'));
  const sourceEndpoints = endpointFiles.map((fileName) => readJson(path.join(endpointDir, fileName)));

  assert(Array.isArray(generatedManifest.endpoints), 'Generated backend manifest missing endpoints array');
  assert(generatedManifest.endpoints.length === sourceEndpoints.length, 'Generated endpoint count does not match source endpoint count');

  sourceEndpoints.forEach((endpoint) => {
    const generated = generatedManifest.endpoints.find((item) => item.name === endpoint.name);
    assert(generated, `Missing generated endpoint for ${endpoint.name}`);
    assert(generated.route === endpoint.route, `Route drift for endpoint ${endpoint.name}`);
    assert(String(generated.method || '').toUpperCase() === String(endpoint.method || '').toUpperCase(), `Method drift for endpoint ${endpoint.name}`);
    assert(generated.public === endpoint.public, `Public flag drift for endpoint ${endpoint.name}`);
  });

  const serverCode = fs.readFileSync(generatedServerPath, 'utf8');
  assert(serverCode.includes('helmet'), 'Generated backend runtime missing helmet middleware');
  assert(serverCode.includes('requireAuth'), 'Generated backend runtime missing JWT auth middleware');
  assert(serverCode.includes('createRateLimiter'), 'Generated backend runtime missing rate limiter');
  assert(serverCode.includes('jwt.verify'), 'Generated backend runtime missing JWT verification');
  assert(serverCode.includes('bcrypt.hash'), 'Generated backend runtime missing password hashing');

  return true;
}

if (require.main === module) {
  try {
    validateBackendRuntime();
    console.log('Backend runtime validation passed.');
  } catch (error) {
    console.error(`Backend runtime validation failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  validateBackendRuntime,
};
