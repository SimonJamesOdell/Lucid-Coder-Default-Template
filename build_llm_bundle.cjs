const fs = require('fs');
const path = require('path');
const { validateInvariants } = require('./validate_llm_invariants.cjs');


// Build output JS bundle from LLM-optimized files
const componentsDir = path.join(__dirname, 'llm_src', 'components');
const routesDir = path.join(__dirname, 'llm_src', 'routes');
const stylesDir = path.join(__dirname, 'llm_src', 'styles');
const manifestPath = path.join(__dirname, 'llm_src', 'manifest.json');
const outputJsPath = path.join(__dirname, 'src', 'main.js');
const outputCssPath = path.join(__dirname, 'src', 'style.css');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Collect styles
let cssBundle = '';
fs.readdirSync(stylesDir).forEach(file => {
  const styleJson = readJson(path.join(stylesDir, file));
  cssBundle += styleJson.css + '\n';
});
fs.writeFileSync(outputCssPath, cssBundle);

// Helper: Render component tree recursively
function renderComponent(componentId) {
  const compPath = path.join(componentsDir, componentId.replace('component_', '') + '.json');
  if (!fs.existsSync(compPath)) return '';
  const comp = readJson(compPath);
  const containerClass = comp.name === 'LandingPage'
    ? 'landing-container'
    : `${comp.name.toLowerCase()}-container`;
  let html = `<div class='${containerClass}'>`;
  if (comp.name === 'LandingPage') {
    html += `<h1>Welcome to JLT Leisure Social Network</h1>`;
    html += `<div class='landing-image-col' aria-hidden='true'></div>`;
    html += `<div class='social-col'>`;
    html += `<h2>Continue with Social</h2>`;
    html += `<button class='social-btn' type='button'>Continue with Google</button>`;
    html += `<button class='social-btn' type='button'>Continue with Apple</button>`;
    html += `<button class='social-btn' type='button'>Continue with Facebook</button>`;
    html += `<button class='social-btn' type='button'>Continue with X</button>`;
    html += `</div>`;
    html += `<div class='auth-col'>`;
    html += `<h2 class='auth-title'>Account Access</h2>`;
    html += `<div class='auth-tabs'>`;
    html += `<button class='auth-tab active' type='button' data-tab='login'>Login</button>`;
    html += `<button class='auth-tab' type='button' data-tab='signup'>Sign up</button>`;
    html += `</div>`;
    html += `<div class='auth-panel active' data-panel='login'>${renderComponent('component_LoginForm')}</div>`;
    html += `<div class='auth-panel' data-panel='signup'>${renderComponent('component_SignupForm')}</div>`;
    html += `</div>`;
    html += `</div>`;
    return html;
  }
  if (comp.name === 'SocialLogins') {
    html += `<div class='social-col'>`;
    html += `<h2>Continue with Social</h2>`;
    html += `<button class='social-btn' type='button'>Continue with Google</button>`;
    html += `<button class='social-btn' type='button'>Continue with Apple</button>`;
    html += `<button class='social-btn' type='button'>Continue with Facebook</button>`;
    html += `<button class='social-btn' type='button'>Continue with X</button>`;
    html += `</div>`;
  }
  if (comp.name === 'LoginForm') {
    html += `<form id='login-form' class='login-form'><h2>Login</h2><input type='email' name='email' placeholder='Email' required><input type='password' name='password' placeholder='Password' required><button type='submit'>Login</button><p class='form-error' data-error='login'></p></form>`;
  }
  if (comp.name === 'SignupForm') {
    html += `<form id='signup-form' class='signup-form'><h2>Sign Up</h2><input type='text' name='name' placeholder='Name' required><input type='email' name='email' placeholder='Email' required><input type='password' name='password' placeholder='Password' required><button type='submit'>Sign Up</button><p class='form-error' data-error='signup'></p></form>`;
  }
  if (comp.name === 'NavBar') {
    html += `<nav class='navbar'><strong>JLT Life</strong><button id='logout-btn' type='button'>Log out</button></nav>`;
  }
  if (comp.name === 'ActivityFeed') {
    html += `<section class='activity-feed'><h2>Recent Activities</h2><ul><li>Yoga Class — 2026-03-01</li><li>Padel Meetup — 2026-03-04</li><li>Board Games Night — 2026-03-07</li></ul></section>`;
  }
  if (comp.children && comp.children.length) {
    comp.children.forEach(childId => {
      html += renderComponent(childId);
    });
  }
  html += `</div>`;
  return html;
}

function renderRoute(routeId) {
  const routePath = path.join(routesDir, routeId.replace('route_', '') + '.json');
  if (!fs.existsSync(routePath)) return '';
  const route = readJson(routePath);
  let html = `<div class='route-${route.name.toLowerCase()}'>`;
  (route.components || []).forEach((componentId) => {
    html += renderComponent(componentId);
  });
  html += '</div>';
  return html;
}

// Get root component from manifest
const manifest = readJson(manifestPath);
const { authContract } = validateInvariants();
const resolvedAuthContract = authContract || {
  baseUrl: '__DISABLED__',
  login: { method: 'POST', route: '/__disabled__/login' },
  signup: { method: 'POST', route: '/__disabled__/signup' },
};
const appId = manifest.components.find(id => id === 'component_App') || 'component_App';
const appHtml = renderComponent(appId);
const homeHtml = renderRoute('route_Home');

// Output main.js to render App tree
const safeHtml = JSON.stringify(appHtml);
const safeHomeHtml = JSON.stringify(homeHtml);
const safeAuthContract = JSON.stringify(resolvedAuthContract);
const jsBundle = `import './style.css';\n\nconst APP_HTML = ${safeHtml};\nconst HOME_HTML = ${safeHomeHtml};\nconst AUTH_CONTRACT = ${safeAuthContract};\n\nfunction resolveApiBaseUrl() {\n  if (typeof window !== 'undefined') {\n    if (window.API_BASE_URL) return window.API_BASE_URL;\n    // If running on a non-localhost host, use that host with backend port\n    const { protocol, hostname } = window.location;\n    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {\n      return protocol + '//' + hostname + ':3001';\n    }\n    // Fallback to localhost\n    return 'http://localhost:3001';\n  }\n  return 'http://localhost:3001';\n}\n\nfunction activateTabs() {\n  const tabs = document.querySelectorAll('.auth-tab');\n  const panels = document.querySelectorAll('.auth-panel');\n  tabs.forEach((tab) => {\n    tab.addEventListener('click', () => {\n      const next = tab.getAttribute('data-tab');\n      tabs.forEach((candidate) => candidate.classList.remove('active'));\n      tab.classList.add('active');\n      panels.forEach((panel) => {\n        panel.classList.toggle('active', panel.getAttribute('data-panel') === next);\n      });\n    });\n  });\n}\n\nfunction getEndpoint(kind) {\n  const spec = AUTH_CONTRACT[kind];\n  return {\n    method: spec.method,\n    url: (AUTH_CONTRACT.baseUrl === '__DYNAMIC__' ? resolveApiBaseUrl() : AUTH_CONTRACT.baseUrl) + spec.route,\n  };\n}\n\nfunction setFormError(kind, message) {\n  const target = document.querySelector(\`.form-error[data-error="\${kind}"]\`);\n  if (target) target.textContent = message || '';\n}\n\nasync function callAuth(kind, payload) {\n  const endpoint = getEndpoint(kind);\n  const response = await fetch(endpoint.url, {\n    method: endpoint.method,\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify(payload),\n  });\n\n  const data = await response.json().catch(() => ({}));\n  if (!response.ok) {\n    throw new Error(data.error || 'Authentication failed');\n  }\n  return data;\n}\n\nfunction renderHome() {\n  const root = document.getElementById('root');\n  root.innerHTML = HOME_HTML;\n  const logoutButton = document.getElementById('logout-btn');\n  if (logoutButton) {\n    logoutButton.addEventListener('click', () => {\n      localStorage.removeItem('authToken');\n      localStorage.removeItem('authUser');\n      renderLanding();\n    });\n  }\n}\n\nfunction attachAuthHandlers() {\n  const loginForm = document.getElementById('login-form');\n  const signupForm = document.getElementById('signup-form');\n\n  if (loginForm) {\n    loginForm.addEventListener('submit', async (event) => {\n      event.preventDefault();\n      setFormError('login', '');\n      const formData = new FormData(loginForm);\n      try {\n        const result = await callAuth('login', {\n          email: String(formData.get('email') || ''),\n          password: String(formData.get('password') || ''),\n        });\n        localStorage.setItem('authToken', result.token);\n        localStorage.setItem('authUser', JSON.stringify(result.user || {}));\n        renderHome();\n      } catch (error) {\n        setFormError('login', error.message);\n      }\n    });\n  }\n\n  if (signupForm) {\n    signupForm.addEventListener('submit', async (event) => {\n      event.preventDefault();\n      setFormError('signup', '');\n      const formData = new FormData(signupForm);\n      try {\n        const result = await callAuth('signup', {\n          name: String(formData.get('name') || ''),\n          email: String(formData.get('email') || ''),\n          password: String(formData.get('password') || ''),\n        });\n        localStorage.setItem('authToken', result.token);\n        localStorage.setItem('authUser', JSON.stringify(result.user || {}));\n        renderHome();\n      } catch (error) {\n        setFormError('signup', error.message);\n      }\n    });\n  }\n}\n\nfunction renderLanding() {\n  const root = document.getElementById('root');\n  root.innerHTML = APP_HTML;\n  activateTabs();\n  attachAuthHandlers();\n}\n\ndocument.addEventListener('DOMContentLoaded', function() {\n  if (localStorage.getItem('authToken')) {\n    renderHome();\n    return;\n  }\n  renderLanding();\n});`;
fs.writeFileSync(outputJsPath, jsBundle);

console.log('LLM bundle built: main.js and style.css generated from LLM-optimized files with validated auth contract.');
