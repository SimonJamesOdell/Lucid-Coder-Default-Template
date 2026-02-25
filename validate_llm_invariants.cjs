const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const invariantsPath = path.join(rootDir, 'llm_src', 'invariants.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeArray(values) {
  return [...(values || [])].sort().join('|');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureGuidelines(manifest, label) {
  const rules = manifest?.llm_guidelines?.rules;
  assert(Array.isArray(rules) && rules.length > 0, `Missing llm_guidelines.rules in ${label}`);
}

function ensureManifestIds(manifest, requirements, label) {
  Object.entries(requirements || {}).forEach(([bucket, ids]) => {
    const list = manifest[bucket];
    assert(Array.isArray(list), `${label} missing array: ${bucket}`);
    ids.forEach((id) => {
      assert(list.includes(id), `${label} missing required id in ${bucket}: ${id}`);
    });
  });
}

function loadBackendEndpoints(endpointDirPath) {
  const files = fs.readdirSync(endpointDirPath).filter((name) => name.endsWith('.json'));
  return files.map((fileName) => readJson(path.join(endpointDirPath, fileName)));
}

function detectBackendEnabled(backendSpec) {
  const manifestPath = path.join(rootDir, backendSpec.manifest_path);
  const hasManifest = fs.existsSync(manifestPath);
  const isOptional = Boolean(backendSpec.optional);

  assert(hasManifest || isOptional, `Missing required backend manifest: ${backendSpec.manifest_path}`);

  if (!hasManifest) {
    return { enabled: false, manifest: null, hasManifest: false };
  }

  const manifest = readJson(manifestPath);
  const endpointList = manifest.endpoints;
  const enabled = Array.isArray(endpointList) && endpointList.length > 0;

  return { enabled, manifest, hasManifest: true };
}

function validateAuthContract(contractSpec) {
  const contract = readJson(path.join(rootDir, contractSpec.path));
  const endpoints = loadBackendEndpoints(path.join(rootDir, contractSpec.backend_endpoint_dir));

  contractSpec.operations.forEach((operation) => {
    const opSpec = contract[operation];
    assert(opSpec, `Auth contract missing operation block: ${operation}`);
    const endpoint = endpoints.find((item) => item.name === operation);
    assert(endpoint, `Backend endpoint missing for auth operation: ${operation}`);

    contractSpec.compare_fields.forEach((field) => {
      if (field === 'inputs' || field === 'outputs') {
        assert(
          normalizeArray(endpoint[field]) === normalizeArray(opSpec[field]),
          `Auth contract mismatch for ${operation}.${field}`
        );
      } else {
        const endpointValue = String(endpoint[field] || '').toUpperCase();
        const contractValue = String(opSpec[field] || '').toUpperCase();
        assert(endpointValue === contractValue, `Auth contract mismatch for ${operation}.${field}`);
      }
    });
  });

  return contract;
}

function validateSecurityPolicy(policySpec) {
  const policyPath = path.join(rootDir, policySpec.path);
  assert(fs.existsSync(policyPath), `Missing security policy file: ${policySpec.path}`);
  const policy = readJson(policyPath);

  (policySpec.required_keys || []).forEach((key) => {
    assert(typeof policy[key] === 'object' && policy[key] !== null, `Security policy missing object key: ${key}`);
  });

  (policySpec.required_jwt_keys || []).forEach((key) => {
    assert(
      typeof policy?.jwt?.[key] === 'string' && policy.jwt[key].trim().length > 0,
      `Security policy missing jwt.${key}`
    );
  });

  if (policySpec.require_cors_allowlist) {
    assert(
      typeof policy?.cors?.allowlist_env === 'string' && policy.cors.allowlist_env.trim().length > 0,
      'Security policy must define cors.allowlist_env'
    );
  }

  return policy;
}

function validateInvariants() {
  assert(fs.existsSync(invariantsPath), 'Missing llm_src/invariants.json');
  const invariants = readJson(invariantsPath);

  const frontendManifest = readJson(path.join(rootDir, invariants.frontend.manifest_path));
  const backendState = detectBackendEnabled(invariants.backend);
  const backendManifest = backendState.manifest;
  const backendEnabled = backendState.enabled;

  if (invariants.requires_guidelines) {
    ensureGuidelines(frontendManifest, invariants.frontend.manifest_path);
    if (backendState.hasManifest) {
      ensureGuidelines(backendManifest, invariants.backend.manifest_path);
    }
  }

  ensureManifestIds(frontendManifest, invariants.frontend.required_manifest_ids, invariants.frontend.manifest_path);
  if (backendEnabled) {
    ensureManifestIds(backendManifest, invariants.backend.required_manifest_ids, invariants.backend.manifest_path);
  }

  let authContract = null;
  let securityPolicy = null;

  if (backendEnabled) {
    authContract = validateAuthContract(invariants.contracts.auth);
    securityPolicy = validateSecurityPolicy(invariants.security_policy);
  }

  // Secure-by-default endpoint invariant
  if (backendEnabled && invariants.endpoint_security) {
    const endpointDir = path.join(rootDir, invariants.endpoint_security.backend_endpoint_dir);
    const endpoints = loadBackendEndpoints(endpointDir);
    const jwtLogic = invariants.endpoint_security.require_jwt_logic;
    const hashLogic = invariants.endpoint_security.require_hash_logic;
    const tokenLogic = invariants.endpoint_security.require_token_logic;
    const publicFlag = invariants.endpoint_security.public_flag;
    const requireExplicitPublicFlag = Boolean(invariants.endpoint_security.require_explicit_public_flag);

    endpoints.forEach((ep) => {
      if (requireExplicitPublicFlag) {
        assert(
          Object.prototype.hasOwnProperty.call(ep, publicFlag) && typeof ep[publicFlag] === 'boolean',
          `Endpoint ${ep.name} must declare explicit boolean ${publicFlag}`
        );
      }

      if (ep[publicFlag] === true) return; // explicitly public
      // Must include JWT protection logic
      const logicRefs = ep.logic_refs || [];
      assert(
        logicRefs.includes(jwtLogic),
        `Endpoint ${ep.name} must include ${jwtLogic} in logic_refs or be marked public:true`
      );
    });

    const loginEndpoint = endpoints.find((ep) => ep.name === 'login');
    const signupEndpoint = endpoints.find((ep) => ep.name === 'signup');

    [loginEndpoint, signupEndpoint].forEach((ep) => {
      if (!ep) return;
      const logicRefs = ep.logic_refs || [];
      assert(logicRefs.includes(hashLogic), `Endpoint ${ep.name} must include ${hashLogic}`);
      assert(logicRefs.includes(tokenLogic), `Endpoint ${ep.name} must include ${tokenLogic}`);
      assert(ep[publicFlag] === true, `Endpoint ${ep.name} must be explicitly public:true`);
    });
  }

  return {
    invariants,
    frontendManifest,
    backendManifest,
    backendEnabled,
    authContract,
    securityPolicy,
  };
}

if (require.main === module) {
  try {
    validateInvariants();
    console.log('LLM invariants validated.');
  } catch (error) {
    console.error(`Invariant validation failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  validateInvariants,
};
