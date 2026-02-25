const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const matrixPath = path.join(__dirname, 'capability_matrix.json');
const cachePath = path.join(__dirname, '.dev_cache.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runCommand(command) {
  console.log(`[harness] Running: ${command}`);
  const result = spawnSync(command, {
    cwd: rootDir,
    shell: true,
    stdio: 'inherit',
  });
  return result.status === 0;
}

function loadDevCache() {
  if (!fs.existsSync(cachePath)) {
    return { steps: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (_error) {
    return { steps: {} };
  }
}

function saveDevCache(cache) {
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function collectJsonFiles(dirPath, output = []) {
  if (!fs.existsSync(dirPath)) {
    return output;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(fullPath, output);
      return;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      output.push(fullPath);
    }
  });

  return output;
}

function getScopeFiles(scope) {
  const frontendFiles = collectJsonFiles(path.join(rootDir, 'llm_src'));
  const backendFiles = collectJsonFiles(path.join(rootDir, 'llm_src_backend'));
  const files = [];

  if (scope === 'frontend') {
    files.push(...frontendFiles);
  } else if (scope === 'backend') {
    files.push(...backendFiles);
  } else {
    files.push(...frontendFiles, ...backendFiles);
  }

  return [...new Set(files)].sort();
}

function fingerprintScope(scope) {
  const files = getScopeFiles(scope);
  const hash = crypto.createHash('sha1');
  files.forEach((filePath) => {
    const stat = fs.statSync(filePath);
    hash.update(path.relative(rootDir, filePath));
    hash.update(String(stat.mtimeMs));
    hash.update(String(stat.size));
  });
  return hash.digest('hex');
}

function detectCapability(spec) {
  if (spec.type === 'manifest_array_non_empty') {
    const filePath = path.join(rootDir, spec.path);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const json = readJson(filePath);
    return Array.isArray(json[spec.field]) && json[spec.field].length > 0;
  }

  if (spec.type === 'auth_contract_operations') {
    const filePath = path.join(rootDir, spec.path);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const json = readJson(filePath);
    const operations = spec.operations || [];
    return operations.every((operation) => {
      const block = json[operation];
      return Boolean(block && block.method && block.route);
    });
  }

  throw new Error(`Unsupported capability detector type: ${spec.type}`);
}

function detectCapabilities(matrix) {
  const result = {};
  Object.entries(matrix.capabilities || {}).forEach(([id, spec]) => {
    result[id] = detectCapability(spec);
  });
  return result;
}

function parseCliArgs(argv) {
  const result = {
    changedPath: '',
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--changed') {
      result.changedPath = String(argv[index + 1] || '');
      index += 1;
    }
    if (token === '--strict') {
      result.strict = true;
    }
  }

  return result;
}

function classifyChangeScope(changedPath) {
  const normalized = String(changedPath || '').replace(/\\/g, '/').toLowerCase();
  if (!normalized) {
    return 'all';
  }
  if (normalized.includes('/llm_src_backend/')) {
    return 'backend';
  }
  if (normalized.includes('/llm_src/')) {
    return 'frontend';
  }
  return 'all';
}

function shouldRunByScope(step, changedScope) {
  const scopes = step.changed_in;
  if (!Array.isArray(scopes) || scopes.length === 0 || changedScope === 'all') {
    return true;
  }
  return scopes.includes(changedScope);
}

function shouldRunByEnvFlag(step, options) {
  if (!step.env_flag) {
    return true;
  }
  if (options.strict) {
    return true;
  }
  return process.env[step.env_flag] === '1';
}

function resolvePhaseCommands(matrix, phase, capabilities, changedScope, options) {
  const phaseSteps = matrix?.phases?.[phase];
  assert(Array.isArray(phaseSteps), `Unknown harness phase: ${phase}`);

  return phaseSteps
    .filter((step) => {
      if (!step.when) {
        return shouldRunByScope(step, changedScope) && shouldRunByEnvFlag(step, options);
      }
      return (
        Boolean(capabilities[step.when]) &&
        shouldRunByScope(step, changedScope) &&
        shouldRunByEnvFlag(step, options)
      );
    })
    .map((step) => step);
}

function shouldSkipByCache(phase, step, options, cache) {
  if (phase !== 'dev' || options.strict) {
    return false;
  }
  if (!step.cache_scope) {
    return false;
  }

  const scopeFingerprint = fingerprintScope(step.cache_scope);
  const stepKey = `${phase}:${step.command}`;
  const previous = cache.steps[stepKey];
  const unchanged = previous && previous.fingerprint === scopeFingerprint;

  if (!unchanged) {
    cache.steps[stepKey] = {
      scope: step.cache_scope,
      fingerprint: scopeFingerprint,
      updated_at: new Date().toISOString(),
    };
  }

  return unchanged;
}

function runHarnessPhase(phase, options = {}) {
  assert(fs.existsSync(matrixPath), 'Missing harness/capability_matrix.json');
  const matrix = readJson(matrixPath);

  const capabilities = detectCapabilities(matrix);
  const changedScope = classifyChangeScope(options.changedPath);
  if (phase === 'detect') {
    console.log(`[harness] Capabilities: ${JSON.stringify(capabilities)}`);
    console.log(`[harness] Changed scope: ${changedScope}`);
    return;
  }

  const steps = resolvePhaseCommands(matrix, phase, capabilities, changedScope, options);
  const cache = loadDevCache();

  console.log(`[harness] Phase: ${phase}`);
  console.log(`[harness] Capabilities: ${JSON.stringify(capabilities)}`);
  console.log(`[harness] Changed scope: ${changedScope}`);
  console.log(`[harness] Strict mode: ${options.strict ? 'on' : 'off'}`);

  for (const step of steps) {
    const command = step.command;
    if (shouldSkipByCache(phase, step, options, cache)) {
      console.log(`[harness] Skip (cache hit): ${command}`);
      continue;
    }

    const ok = runCommand(command);
    if (!ok) {
      throw new Error(`Harness phase '${phase}' failed while running: ${command}`);
    }
  }

  saveDevCache(cache);

  console.log(`[harness] Phase '${phase}' passed.`);
}

if (require.main === module) {
  const phase = process.argv[2];
  if (!phase) {
    console.error('Usage: node harness/run_harness_gates.cjs <phase>');
    process.exit(1);
  }

  const options = parseCliArgs(process.argv.slice(3));

  try {
    runHarnessPhase(phase, options);
  } catch (error) {
    console.error(`[harness] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runHarnessPhase,
};
