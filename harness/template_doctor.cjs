const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Missing required file: ${relativePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function assertArray(json, field, label) {
  if (!Array.isArray(json[field])) {
    fail(`${label} must contain array field: ${field}`);
  }
}

function runCommand(command) {
  const result = spawnSync(command, {
    cwd: rootDir,
    shell: true,
    stdio: 'inherit',
  });
  return result.status === 0;
}

function validateFiles() {
  const requiredFiles = [
    'llm_src/manifest.json',
    'llm_src_backend/manifest.json',
    'llm_src/invariants.json',
    'harness/plugins/registry.json',
    'harness/active_plugins.json',
    'harness/capability_matrix.json',
    'harness/run_harness_gates.cjs',
    'harness/plugin_manager.cjs',
    'build_llm_bundle.cjs',
    'build_llm_backend.cjs',
    'validate_llm_invariants.cjs',
    'package.json',
  ];

  requiredFiles.forEach((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      fail(`Missing required file: ${relativePath}`);
    }
  });
}

function validateManifests() {
  const frontendManifest = readJson('llm_src/manifest.json');
  const backendManifest = readJson('llm_src_backend/manifest.json');

  assertArray(frontendManifest, 'components', 'llm_src/manifest.json');
  assertArray(frontendManifest, 'routes', 'llm_src/manifest.json');
  assertArray(frontendManifest, 'styles', 'llm_src/manifest.json');
  assertArray(frontendManifest, 'contracts', 'llm_src/manifest.json');

  assertArray(backendManifest, 'endpoints', 'llm_src_backend/manifest.json');
  assertArray(backendManifest, 'logic', 'llm_src_backend/manifest.json');
  assertArray(backendManifest, 'models', 'llm_src_backend/manifest.json');
  assertArray(backendManifest, 'security', 'llm_src_backend/manifest.json');
}

function validatePluginRegistry() {
  const registry = readJson('harness/plugins/registry.json');
  const state = readJson('harness/active_plugins.json');

  assertArray(registry, 'plugins', 'harness/plugins/registry.json');
  assertArray(state, 'active', 'harness/active_plugins.json');

  const pluginIds = new Set(registry.plugins.map((plugin) => plugin.id));
  if (!pluginIds.has('core')) {
    fail('Plugin registry must include core plugin');
  }

  state.active.forEach((pluginId) => {
    if (!pluginIds.has(pluginId)) {
      fail(`Active plugin not found in registry: ${pluginId}`);
    }
  });

  if (!state.active.includes('core')) {
    fail('active_plugins.json must include core plugin');
  }

  const knownPluginIds = new Set();
  registry.plugins.forEach((entry) => {
    knownPluginIds.add(entry.id);
    if (!entry.manifest) {
      fail(`Plugin entry missing manifest path: ${entry.id}`);
    }
    const manifestPath = path.join(rootDir, entry.manifest);
    if (!fs.existsSync(manifestPath)) {
      fail(`Plugin manifest file missing: ${entry.manifest}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.id) {
      fail(`Plugin manifest missing id: ${entry.manifest}`);
    }

    (manifest.dependencies || []).forEach((dependencyId) => {
      if (!knownPluginIds.has(dependencyId) && dependencyId !== entry.id) {
        const existsInRegistry = registry.plugins.some((candidate) => candidate.id === dependencyId);
        if (!existsInRegistry) {
          fail(`Plugin dependency missing from registry: ${manifest.id} -> ${dependencyId}`);
        }
      }
    });

    (manifest.files || []).forEach((fileEntry) => {
      if (!fileEntry.from || !fileEntry.to) {
        fail(`Plugin file entry requires from/to: ${manifest.id}`);
      }
      const sourcePath = path.join(path.dirname(manifestPath), 'files', fileEntry.from);
      if (!fs.existsSync(sourcePath)) {
        fail(`Plugin source file missing: ${manifest.id} -> ${fileEntry.from}`);
      }
    });

    (manifest.manifest_mutations || []).forEach((mutation) => {
      if (!mutation.file || !mutation.field) {
        fail(`Plugin mutation requires file/field: ${manifest.id}`);
      }
    });
  });
}

function validateScripts() {
  const packageJson = readJson('package.json');
  const scripts = packageJson.scripts || {};

  const requiredScripts = [
    'build:llm',
    'dev:check',
    'release:assure',
    'plugin:list',
    'plugin:plan',
    'plugin:apply-plan',
    'template:doctor',
  ];

  requiredScripts.forEach((scriptName) => {
    if (!scripts[scriptName]) {
      fail(`package.json missing required script: ${scriptName}`);
    }
  });
}

function runDeepChecks() {
  const commands = [
    'node harness/run_harness_gates.cjs detect',
    'npm run validate:llm',
  ];

  commands.forEach((command) => {
    const ok = runCommand(command);
    if (!ok) {
      fail(`Deep check failed: ${command}`);
    }
  });
}

function parseArgs(argv) {
  return {
    deep: argv.includes('--deep'),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  validateFiles();
  validateManifests();
  validatePluginRegistry();
  validateScripts();

  if (args.deep) {
    runDeepChecks();
  }

  const mode = args.deep ? 'deep' : 'quick';
  console.log(`template:doctor passed (${mode}).`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`template:doctor failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  main,
};
