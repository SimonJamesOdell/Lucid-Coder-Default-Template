const fs = require('fs');
const path = require('path');
const { validateInvariants } = require('./validate_llm_invariants.cjs');

const componentsDir = path.join(__dirname, 'llm_src', 'components');
const routesDir = path.join(__dirname, 'llm_src', 'routes');
const stylesDir = path.join(__dirname, 'llm_src', 'styles');
const manifestPath = path.join(__dirname, 'llm_src', 'manifest.json');
const outputJsPath = path.join(__dirname, 'src', 'main.js');
const outputCssPath = path.join(__dirname, 'src', 'style.css');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function componentExists(componentId) {
  const fileName = componentId.replace('component_', '') + '.json';
  return fs.existsSync(path.join(componentsDir, fileName));
}

function buildCssBundle() {
  let cssBundle = '';
  fs.readdirSync(stylesDir).forEach((fileName) => {
    if (!fileName.endsWith('.json')) return;
    const styleJson = readJson(path.join(stylesDir, fileName));
    cssBundle += (styleJson.css || '') + '\n';
  });
  fs.writeFileSync(outputCssPath, cssBundle);
}

function renderComponent(componentId, options) {
  const componentPath = path.join(componentsDir, componentId.replace('component_', '') + '.json');
  if (!fs.existsSync(componentPath)) return '';

  const component = readJson(componentPath);
  const containerClass = component.name === 'LandingPage'
    ? 'landing-container'
    : `${component.name.toLowerCase()}-container`;

  let html = `<div class='${containerClass}'>`;

  if (component.name === 'LandingPage') {
    html += `<h1>Welcome to Your App</h1>`;
    html += `<p class='starter-copy'>Start by editing llm_src and llm_src_backend to define your product features.</p>`;

    if (options.hasAuthContract && componentExists('component_LoginForm') && componentExists('component_SignupForm')) {
      html += `<div class='auth-col'>`;
      html += `<h2 class='auth-title'>Account Access</h2>`;
      html += `<div class='auth-tabs'>`;
      html += `<button class='auth-tab active' type='button' data-tab='login'>Login</button>`;
      html += `<button class='auth-tab' type='button' data-tab='signup'>Sign up</button>`;
      html += `</div>`;
      html += `<div class='auth-panel active' data-panel='login'>${renderComponent('component_LoginForm', options)}</div>`;
      html += `<div class='auth-panel' data-panel='signup'>${renderComponent('component_SignupForm', options)}</div>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  if (component.name === 'LoginForm') {
    html += `<form id='login-form' class='login-form'><h2>Login</h2><input type='email' name='email' placeholder='Email' required><input type='password' name='password' placeholder='Password' required><button type='submit'>Login</button><p class='form-error' data-error='login'></p></form>`;
  }

  if (component.name === 'SignupForm') {
    html += `<form id='signup-form' class='signup-form'><h2>Sign Up</h2><input type='text' name='name' placeholder='Name' required><input type='email' name='email' placeholder='Email' required><input type='password' name='password' placeholder='Password' required><button type='submit'>Sign Up</button><p class='form-error' data-error='signup'></p></form>`;
  }

  if (component.name === 'NavBar') {
    html += `<nav class='navbar'><strong>Starter App</strong>${options.hasAuthContract ? `<button id='logout-btn' type='button'>Log out</button>` : ''}</nav>`;
  }

  if (component.name === 'ActivityFeed') {
    html += `<section class='activity-feed'><h2>Recent Activities</h2><ul><li>Kickoff planning</li><li>First feature draft</li><li>Initial validation run</li></ul></section>`;
  }

  if (Array.isArray(component.children) && component.children.length > 0) {
    component.children.forEach((childId) => {
      html += renderComponent(childId, options);
    });
  }

  html += `</div>`;
  return html;
}

function renderRoute(routeId, options) {
  const routePath = path.join(routesDir, routeId.replace('route_', '') + '.json');
  if (!fs.existsSync(routePath)) return '';

  const route = readJson(routePath);
  let html = `<div class='route-${String(route.name || '').toLowerCase()}'>`;
  (route.components || []).forEach((componentId) => {
    html += renderComponent(componentId, options);
  });
  html += '</div>';
  return html;
}

function buildBundle() {
  buildCssBundle();

  const manifest = readJson(manifestPath);
  const { authContract } = validateInvariants();
  const hasAuthContract = Boolean(authContract && authContract.login && authContract.signup);

  const options = { hasAuthContract };
  const appId = manifest.components.find((id) => id === 'component_App') || 'component_App';
  const appHtml = renderComponent(appId, options);
  const homeHtml = renderRoute('route_Home', options);

  const safeHtml = JSON.stringify(appHtml);
  const safeHomeHtml = JSON.stringify(homeHtml);
  const safeAuthEnabled = JSON.stringify(hasAuthContract);
  const safeAuthContract = JSON.stringify(authContract || null);

  const jsBundle = `import './style.css';\n\nconst APP_HTML = ${safeHtml};\nconst HOME_HTML = ${safeHomeHtml};\nconst AUTH_ENABLED = ${safeAuthEnabled};\nconst AUTH_CONTRACT = ${safeAuthContract};\n\nfunction resolveApiBaseUrl() {\n  if (typeof window !== 'undefined') {\n    if (window.API_BASE_URL) return window.API_BASE_URL;\n    const { protocol, hostname } = window.location;\n    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {\n      return protocol + '//' + hostname + ':3001';\n    }\n  }\n  return 'http://localhost:3001';\n}\n\nfunction activateTabs() {\n  const tabs = document.querySelectorAll('.auth-tab');\n  const panels = document.querySelectorAll('.auth-panel');\n  tabs.forEach((tab) => {\n    tab.addEventListener('click', () => {\n      const next = tab.getAttribute('data-tab');\n      tabs.forEach((candidate) => candidate.classList.remove('active'));\n      tab.classList.add('active');\n      panels.forEach((panel) => {\n        panel.classList.toggle('active', panel.getAttribute('data-panel') === next);\n      });\n    });\n  });\n}\n\nfunction setFormError(kind, message) {\n  const target = document.querySelector(\`.form-error[data-error="\${kind}"]\`);\n  if (target) target.textContent = message || '';\n}\n\nfunction getEndpoint(kind) {\n  if (!AUTH_ENABLED || !AUTH_CONTRACT || !AUTH_CONTRACT[kind]) {\n    throw new Error('Authentication capability is not enabled');\n  }\n\n  const spec = AUTH_CONTRACT[kind];\n  const baseUrl = AUTH_CONTRACT.baseUrl === '__DYNAMIC__' ? resolveApiBaseUrl() : AUTH_CONTRACT.baseUrl;\n  return { method: spec.method, url: baseUrl + spec.route };\n}\n\nasync function callAuth(kind, payload) {\n  const endpoint = getEndpoint(kind);\n  const response = await fetch(endpoint.url, {\n    method: endpoint.method,\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify(payload),\n  });\n\n  const data = await response.json().catch(() => ({}));\n  if (!response.ok) {\n    throw new Error(data.error || 'Authentication failed');\n  }\n  return data;\n}\n\nfunction renderHome() {\n  const root = document.getElementById('root');\n  root.innerHTML = HOME_HTML;\n\n  const logoutButton = document.getElementById('logout-btn');\n  if (logoutButton) {\n    logoutButton.addEventListener('click', () => {\n      localStorage.removeItem('authToken');\n      localStorage.removeItem('authUser');\n      renderLanding();\n    });\n  }\n}\n\nfunction attachAuthHandlers() {\n  if (!AUTH_ENABLED) return;\n\n  const loginForm = document.getElementById('login-form');\n  const signupForm = document.getElementById('signup-form');\n\n  if (loginForm) {\n    loginForm.addEventListener('submit', async (event) => {\n      event.preventDefault();\n      setFormError('login', '');\n      const formData = new FormData(loginForm);\n      try {\n        const result = await callAuth('login', {\n          email: String(formData.get('email') || ''),\n          password: String(formData.get('password') || ''),\n        });\n        localStorage.setItem('authToken', result.token);\n        localStorage.setItem('authUser', JSON.stringify(result.user || {}));\n        renderHome();\n      } catch (error) {\n        setFormError('login', error.message);\n      }\n    });\n  }\n\n  if (signupForm) {\n    signupForm.addEventListener('submit', async (event) => {\n      event.preventDefault();\n      setFormError('signup', '');\n      const formData = new FormData(signupForm);\n      try {\n        const result = await callAuth('signup', {\n          name: String(formData.get('name') || ''),\n          email: String(formData.get('email') || ''),\n          password: String(formData.get('password') || ''),\n        });\n        localStorage.setItem('authToken', result.token);\n        localStorage.setItem('authUser', JSON.stringify(result.user || {}));\n        renderHome();\n      } catch (error) {\n        setFormError('signup', error.message);\n      }\n    });\n  }\n}\n\nfunction renderLanding() {\n  const root = document.getElementById('root');\n  root.innerHTML = APP_HTML;\n  activateTabs();\n  attachAuthHandlers();\n}\n\ndocument.addEventListener('DOMContentLoaded', function() {\n  if (AUTH_ENABLED && localStorage.getItem('authToken')) {\n    renderHome();\n    return;\n  }\n  renderLanding();\n});`;

  fs.writeFileSync(outputJsPath, jsBundle);
  console.log('LLM bundle built: main.js and style.css generated from LLM-optimized files.');
}

if (require.main === module) {
  buildBundle();
}

module.exports = {
  buildBundle,
};