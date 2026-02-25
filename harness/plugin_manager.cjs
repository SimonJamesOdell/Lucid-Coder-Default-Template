const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const registryPath = path.join(__dirname, 'plugins', 'registry.json');
const statePath = path.join(__dirname, 'active_plugins.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, json) {
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
}

function parseArgs(argv) {
  const result = {
    command: argv[2] || 'list',
    pluginId: argv[3] || '',
    targetPath: argv[3] || '',
    dryRun: false,
  };

  for (let index = 4; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      result.dryRun = true;
    }
  }

  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, content);
  }
}

function loadRegistry() {
  assert(fs.existsSync(registryPath), 'Missing harness/plugins/registry.json');
  const registry = readJson(registryPath);
  const map = new Map();

  (registry.plugins || []).forEach((entry) => {
    const manifestPath = path.join(rootDir, entry.manifest);
    assert(fs.existsSync(manifestPath), `Plugin manifest not found: ${entry.manifest}`);
    const manifest = readJson(manifestPath);
    map.set(manifest.id, {
      ...manifest,
      _entry: entry,
      _manifestPath: manifestPath,
      _packRoot: path.dirname(manifestPath),
    });
  });

  return {
    raw: registry,
    map,
  };
}

function loadState(registry) {
  const defaults = (registry.raw.plugins || [])
    .filter((plugin) => Boolean(plugin.default_active))
    .map((plugin) => plugin.id);

  ensureFile(statePath, {
    active: defaults,
    managed_files: {},
    updated_at: new Date().toISOString(),
  });

  const state = readJson(statePath);
  state.active = Array.isArray(state.active) ? state.active : [];
  state.managed_files = state.managed_files || {};
  return state;
}

function saveState(state, dryRun) {
  state.updated_at = new Date().toISOString();
  if (dryRun) {
    return;
  }
  writeJson(statePath, state);
}

function unique(values) {
  return [...new Set(values)];
}

function addIds(target, values) {
  const list = Array.isArray(target) ? target : [];
  return unique([...list, ...(values || [])]);
}

function removeIds(target, values) {
  const valueSet = new Set(values || []);
  return (target || []).filter((item) => !valueSet.has(item));
}

function applyManifestMutations(plugin, mode, dryRun) {
  const mutations = plugin.manifest_mutations || [];
  mutations.forEach((mutation) => {
    const filePath = path.join(rootDir, mutation.file);
    if (!fs.existsSync(filePath)) {
      if (mode === 'disable') {
        return;
      }
      throw new Error(`Mutation target file not found: ${mutation.file}`);
    }

    const json = readJson(filePath);
    const current = json[mutation.field];
    if (!Array.isArray(current)) {
      throw new Error(`Mutation target field is not an array: ${mutation.file}#${mutation.field}`);
    }

    if (mode === 'enable') {
      json[mutation.field] = addIds(current, mutation.add || []);
    } else {
      json[mutation.field] = removeIds(current, mutation.remove || []);
    }

    if (!dryRun) {
      writeJson(filePath, json);
    }
  });
}

function collectManifestMutations(plugin, mode) {
  const mutations = plugin.manifest_mutations || [];
  return mutations.map((mutation) => {
    const filePath = path.join(rootDir, mutation.file);
    if (!fs.existsSync(filePath)) {
      return {
        file: mutation.file,
        field: mutation.field,
        action: mode,
        error: 'target file missing',
      };
    }

    const json = readJson(filePath);
    const before = Array.isArray(json[mutation.field]) ? clone(json[mutation.field]) : [];
    const after = mode === 'enable'
      ? addIds(before, mutation.add || [])
      : removeIds(before, mutation.remove || []);

    return {
      file: mutation.file,
      field: mutation.field,
      action: mode,
      before,
      after,
    };
  });
}

function copyPluginFiles(plugin, dryRun) {
  const copied = [];
  (plugin.files || []).forEach((item) => {
    const sourcePath = path.join(plugin._packRoot, 'files', item.from);
    const targetPath = path.join(rootDir, item.to);
    assert(fs.existsSync(sourcePath), `Plugin source file not found: ${sourcePath}`);

    copied.push(item.to);
    if (dryRun) {
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  });

  return copied;
}

function removePluginFiles(plugin, state, dryRun) {
  const fromState = state.managed_files[plugin.id] || [];
  const configured = plugin.remove_on_disable || [];
  const files = unique([...fromState, ...configured]);

  files.forEach((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return;
    }
    if (dryRun) {
      return;
    }
    fs.rmSync(absolutePath);
  });
}

function resolveDependencies(pluginMap, pluginId, output = [], visiting = new Set()) {
  if (output.includes(pluginId)) {
    return output;
  }
  if (visiting.has(pluginId)) {
    throw new Error(`Dependency cycle detected at plugin: ${pluginId}`);
  }

  visiting.add(pluginId);
  const plugin = pluginMap.get(pluginId);
  assert(plugin, `Unknown plugin: ${pluginId}`);

  (plugin.dependencies || []).forEach((dependencyId) => {
    if (!output.includes(dependencyId)) {
      resolveDependencies(pluginMap, dependencyId, output, visiting);
    }
  });

  if (!output.includes(pluginId)) {
    output.push(pluginId);
  }

  visiting.delete(pluginId);

  return output;
}

function findDependents(pluginMap, targetPluginId, activePlugins) {
  const activeSet = new Set(activePlugins);
  return [...pluginMap.values()]
    .filter((plugin) => activeSet.has(plugin.id))
    .filter((plugin) => (plugin.dependencies || []).includes(targetPluginId))
    .map((plugin) => plugin.id);
}

function enablePlugin(pluginMap, state, pluginId, dryRun) {
  const installOrder = resolveDependencies(pluginMap, pluginId);

  installOrder.forEach((id) => {
    if (state.active.includes(id)) {
      return;
    }

    const plugin = pluginMap.get(id);
    const copied = copyPluginFiles(plugin, dryRun);
    applyManifestMutations(plugin, 'enable', dryRun);
    state.active.push(id);
    state.managed_files[id] = unique([...(state.managed_files[id] || []), ...copied]);
    console.log(`[plugin] Enabled: ${id}`);
  });
}

function disablePlugin(pluginMap, state, pluginId, dryRun) {
  assert(pluginId !== 'core', 'core plugin cannot be disabled');
  assert(state.active.includes(pluginId), `Plugin is not active: ${pluginId}`);

  const dependents = findDependents(pluginMap, pluginId, state.active);
  assert(
    dependents.length === 0,
    `Cannot disable ${pluginId}; active dependents: ${dependents.join(', ')}`
  );

  const plugin = pluginMap.get(pluginId);
  applyManifestMutations(plugin, 'disable', dryRun);
  removePluginFiles(plugin, state, dryRun);
  state.active = state.active.filter((id) => id !== pluginId);
  delete state.managed_files[pluginId];
  console.log(`[plugin] Disabled: ${pluginId}`);
}

function planEnable(pluginMap, state, pluginId) {
  const installOrder = resolveDependencies(pluginMap, pluginId);
  const plan = {
    command: 'enable',
    plugin: pluginId,
    install_order: installOrder,
    changes: [],
  };

  installOrder.forEach((id) => {
    if (state.active.includes(id)) {
      plan.changes.push({ plugin: id, skipped: 'already active' });
      return;
    }

    const plugin = pluginMap.get(id);
    const copyOps = (plugin.files || []).map((item) => ({
      from: path.join('harness', 'plugin_packs', id, 'files', item.from),
      to: item.to,
    }));

    const manifestOps = collectManifestMutations(plugin, 'enable');
    plan.changes.push({
      plugin: id,
      copy_files: copyOps,
      manifest_mutations: manifestOps,
    });
  });

  return plan;
}

function planDisable(pluginMap, state, pluginId) {
  const dependents = findDependents(pluginMap, pluginId, state.active);
  if (dependents.length > 0) {
    return {
      command: 'disable',
      plugin: pluginId,
      blocked_by_dependents: dependents,
    };
  }

  const plugin = pluginMap.get(pluginId);
  return {
    command: 'disable',
    plugin: pluginId,
    remove_files: unique([...(state.managed_files[pluginId] || []), ...((plugin && plugin.remove_on_disable) || [])]),
    manifest_mutations: collectManifestMutations(plugin, 'disable'),
  };
}

function printList(pluginMap, state) {
  const activeSet = new Set(state.active);
  console.log('Plugins:');
  [...pluginMap.values()].forEach((plugin) => {
    const mark = activeSet.has(plugin.id) ? '[x]' : '[ ]';
    console.log(`${mark} ${plugin.id} (${plugin.risk || 'n/a'})`);
  });
}

function printStatus(state) {
  console.log(JSON.stringify(state, null, 2));
}

function ensureArrayEqual(actual, expected, label) {
  const left = JSON.stringify(actual || []);
  const right = JSON.stringify(expected || []);
  if (left !== right) {
    throw new Error(`Plan precondition failed for ${label}`);
  }
}

function applyManifestMutationFromPlan(mutation, dryRun) {
  const filePath = path.join(rootDir, mutation.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Plan target file not found: ${mutation.file}`);
  }

  const json = readJson(filePath);
  const current = json[mutation.field];
  if (!Array.isArray(current)) {
    throw new Error(`Plan target field is not array: ${mutation.file}#${mutation.field}`);
  }

  if (Object.prototype.hasOwnProperty.call(mutation, 'before')) {
    ensureArrayEqual(current, mutation.before, `${mutation.file}#${mutation.field}`);
  }

  if (!dryRun) {
    json[mutation.field] = mutation.after || [];
    writeJson(filePath, json);
  }
}

function copyFromPlan(copyOp, dryRun) {
  const sourcePath = path.join(rootDir, copyOp.from);
  const targetPath = path.join(rootDir, copyOp.to);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Plan source file not found: ${copyOp.from}`);
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function removeFromPlan(relativePath, dryRun) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return;
  }
  if (!dryRun) {
    fs.rmSync(filePath);
  }
}

function applyEnablePlan(plan, state, dryRun) {
  const installOrder = plan.install_order || [];
  const activeSet = new Set(state.active);

  (plan.changes || []).forEach((change) => {
    if (change.skipped) {
      return;
    }

    (change.copy_files || []).forEach((copyOp) => copyFromPlan(copyOp, dryRun));
    (change.manifest_mutations || []).forEach((mutation) => applyManifestMutationFromPlan(mutation, dryRun));

    activeSet.add(change.plugin);
    state.managed_files[change.plugin] = unique([
      ...(state.managed_files[change.plugin] || []),
      ...((change.copy_files || []).map((item) => item.to)),
    ]);
  });

  installOrder.forEach((pluginId) => activeSet.add(pluginId));
  state.active = [...activeSet];
}

function applyDisablePlan(plan, state, dryRun) {
  if (Array.isArray(plan.blocked_by_dependents) && plan.blocked_by_dependents.length > 0) {
    throw new Error(
      `Plan cannot be applied; blocked by dependents: ${plan.blocked_by_dependents.join(', ')}`
    );
  }

  (plan.manifest_mutations || []).forEach((mutation) => applyManifestMutationFromPlan(mutation, dryRun));
  (plan.remove_files || []).forEach((relativePath) => removeFromPlan(relativePath, dryRun));

  state.active = (state.active || []).filter((id) => id !== plan.plugin);
  delete state.managed_files[plan.plugin];
}

function applyPlanFromFile(planPath, state, dryRun) {
  const absolutePlanPath = path.isAbsolute(planPath) ? planPath : path.join(rootDir, planPath);
  if (!fs.existsSync(absolutePlanPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  const plan = readJson(absolutePlanPath);
  if (plan.command === 'enable') {
    applyEnablePlan(plan, state, dryRun);
    console.log(`[plugin] Applied enable plan for: ${plan.plugin}`);
    return;
  }

  if (plan.command === 'disable') {
    applyDisablePlan(plan, state, dryRun);
    console.log(`[plugin] Applied disable plan for: ${plan.plugin}`);
    return;
  }

  throw new Error('Unknown plan command; expected enable or disable');
}

function run() {
  const args = parseArgs(process.argv);
  const registry = loadRegistry();
  const state = loadState(registry);
  const pluginMap = registry.map;

  if (args.command === 'list') {
    printList(pluginMap, state);
    return;
  }

  if (args.command === 'status') {
    printStatus(state);
    return;
  }

  if (args.command === 'enable') {
    assert(args.pluginId, 'Usage: node harness/plugin_manager.cjs enable <pluginId> [--dry-run]');
    enablePlugin(pluginMap, state, args.pluginId, args.dryRun);
    saveState(state, args.dryRun);
    return;
  }

  if (args.command === 'plan') {
    assert(args.pluginId, 'Usage: node harness/plugin_manager.cjs plan <pluginId> [enable|disable]');
    const modeToken = process.argv[4] || 'enable';
    assert(modeToken === 'enable' || modeToken === 'disable', 'Plan mode must be enable or disable');
    const plan = modeToken === 'enable'
      ? planEnable(pluginMap, state, args.pluginId)
      : planDisable(pluginMap, state, args.pluginId);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (args.command === 'apply-plan') {
    assert(args.targetPath, 'Usage: node harness/plugin_manager.cjs apply-plan <planPath> [--dry-run]');
    applyPlanFromFile(args.targetPath, state, args.dryRun);
    saveState(state, args.dryRun);
    return;
  }

  if (args.command === 'disable') {
    assert(args.pluginId, 'Usage: node harness/plugin_manager.cjs disable <pluginId> [--dry-run]');
    disablePlugin(pluginMap, state, args.pluginId, args.dryRun);
    saveState(state, args.dryRun);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`[plugin] ${error.message}`);
    process.exit(1);
  }
}
