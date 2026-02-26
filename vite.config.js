import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function llmHotReloadPlugin() {
  let devServer = null;
  let debounceTimer = null;
  let pipelineRunning = false;
  let pipelineQueued = false;
  let latestChangedFile = '';

  const log = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[llm-loop ${timestamp}] ${message}`);
  };

  const runCommand = (command) => {
    log(`Running: ${command}`);
    const result = spawnSync(command, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    });
    if (result.status === 0) {
      log(`Success: ${command}`);
    } else {
      log(`Failed (${result.status}): ${command}`);
    }
    return result.status === 0;
  };

  const runBundleBuild = () => {
    const changedArg = latestChangedFile ? ` --changed "${latestChangedFile}"` : '';
    return runCommand(`"${process.execPath}" "${path.resolve(process.cwd(), 'harness', 'run_harness_gates.cjs')}" dev${changedArg}`);
  };

  const runGeneratedSyntaxCheck = () => {
    const mainPath = path.resolve(process.cwd(), 'src', 'main.js');
    return runCommand(`"${process.execPath}" --check "${mainPath}"`);
  };

  const runCompileCheck = () => runCommand('npm run build');

  const runTestsIfAvailable = () => {
    if (process.env.HARNESS_DEV_STRICT !== '1') {
      log('HARNESS_DEV_STRICT is not enabled; skipping deep tests in dev loop.');
      return true;
    }

    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return true;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const hasTestScript = Boolean(packageJson.scripts && packageJson.scripts.test);
    if (!hasTestScript) {
      log('No test script found, skipping tests.');
      return true;
    }

    return runCommand('npm run test');
  };

  const runPipeline = () => {
    log('Pipeline started.');
    const bundleBuilt = runBundleBuild();
    if (!bundleBuilt) {
      log('Pipeline stopped: bundle build failed.');
      return false;
    }

    const syntaxValid = runGeneratedSyntaxCheck();
    if (!syntaxValid) {
      log('Pipeline stopped: generated syntax check failed.');
      return false;
    }

    const testsPassed = runTestsIfAvailable();
    if (!testsPassed) {
      log('Pipeline stopped: tests failed.');
      return false;
    }

    if (process.env.HARNESS_DEV_STRICT === '1') {
      const compileOk = runCompileCheck();
      if (!compileOk) {
        log('Pipeline stopped: compile check failed.');
        return false;
      }
    } else {
      log('HARNESS_DEV_STRICT is not enabled; skipping compile check in dev loop.');
    }

    log('Pipeline completed successfully.');
    return true;
  };

  const runPipelineAndReload = () => {
    if (!devServer) {
      return;
    }

    if (pipelineRunning) {
      log('Pipeline already running; queueing one additional run.');
      pipelineQueued = true;
      return;
    }

    pipelineRunning = true;
    const ok = runPipeline();
    if (ok) {
      log('Checks passed; sending full browser reload.');
      devServer.ws.send({ type: 'full-reload' });
    } else {
      log('Checks failed; browser reload skipped.');
    }
    pipelineRunning = false;

    if (pipelineQueued) {
      log('Running queued pipeline pass.');
      pipelineQueued = false;
      runPipelineAndReload();
    }
  };

  const schedulePipeline = (changedFile) => {
    latestChangedFile = changedFile || latestChangedFile;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    log('LLM source update detected; scheduling pipeline run.');
    debounceTimer = setTimeout(runPipelineAndReload, 300);
  };

  const isLlmSourcePath = (filePath) => {
    const normalizedPath = String(filePath).replace(/\\/g, '/');
    return normalizedPath.includes('/llm_src/') || normalizedPath.includes('/llm_src_backend/');
  };

  return {
    name: 'llm-hot-reload',
    handleHotUpdate(ctx) {
      if (!isLlmSourcePath(ctx.file)) {
        return;
      }

      schedulePipeline(ctx.file);
      return [];
    },
    configureServer(server) {
      devServer = server;
      runPipelineAndReload();
      const llmGlob = 'llm_src/**/*.json';
      const llmBackendGlob = 'llm_src_backend/**/*.json';
      server.watcher.add(llmGlob);
      server.watcher.add(llmBackendGlob);

      const handleLlmUpdate = (changedFile) => {
        if (!isLlmSourcePath(changedFile)) {
          return;
        }

        schedulePipeline(changedFile);
      };

      server.watcher.on('add', handleLlmUpdate);
      server.watcher.on('unlink', handleLlmUpdate);
    },
  };
}

export default defineConfig({
  plugins: [llmHotReloadPlugin()],
  server: {
    host: '0.0.0.0',
  },
  publicDir: 'public', // Serve static files from public
});
