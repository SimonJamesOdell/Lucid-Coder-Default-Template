import './style.css';

const APP_HTML = "<div class='app-container'><div class='landing-container'><h1>Welcome to JLT Leisure Social Network</h1><div class='landing-image-col' aria-hidden='true'></div><div class='social-col'><h2>Continue with Social</h2><button class='social-btn' type='button'>Continue with Google</button><button class='social-btn' type='button'>Continue with Apple</button><button class='social-btn' type='button'>Continue with Facebook</button><button class='social-btn' type='button'>Continue with X</button></div><div class='auth-col'><h2 class='auth-title'>Account Access</h2><div class='auth-tabs'><button class='auth-tab active' type='button' data-tab='login'>Login</button><button class='auth-tab' type='button' data-tab='signup'>Sign up</button></div><div class='auth-panel active' data-panel='login'><div class='loginform-container'><form id='login-form' class='login-form'><h2>Login</h2><input type='email' name='email' placeholder='Email' required><input type='password' name='password' placeholder='Password' required><button type='submit'>Login</button><p class='form-error' data-error='login'></p></form></div></div><div class='auth-panel' data-panel='signup'><div class='signupform-container'><form id='signup-form' class='signup-form'><h2>Sign Up</h2><input type='text' name='name' placeholder='Name' required><input type='email' name='email' placeholder='Email' required><input type='password' name='password' placeholder='Password' required><button type='submit'>Sign Up</button><p class='form-error' data-error='signup'></p></form></div></div></div></div></div>";
const HOME_HTML = "<div class='route-home'><div class='navbar-container'><nav class='navbar'><strong>JLT Life</strong><button id='logout-btn' type='button'>Log out</button></nav></div><div class='activityfeed-container'><section class='activity-feed'><h2>Recent Activities</h2><ul><li>Yoga Class — 2026-03-01</li><li>Padel Meetup — 2026-03-04</li><li>Board Games Night — 2026-03-07</li></ul></section></div></div>";
const AUTH_CONTRACT = {"id":"contract_auth","type":"contract","description":"Canonical auth contract shared by frontend and backend LLM layers.","baseUrl":"__DYNAMIC__","login":{"method":"POST","route":"/api/login","inputs":["email","password"],"outputs":["token","user"]},"signup":{"method":"POST","route":"/api/signup","inputs":["name","email","password"],"outputs":["token","user"]},"llm_notes":"Compiler validates this contract against llm_src_backend/endpoints/*.json and fails build on mismatch. baseUrl is resolved at runtime: if window.API_BASE_URL is set, use it; else use window.location.origin with port 3001; else fallback to http://localhost:3001."};

function resolveApiBaseUrl() {
  if (typeof window !== 'undefined') {
    if (window.API_BASE_URL) return window.API_BASE_URL;
    // If running on a non-localhost host, use that host with backend port
    const { protocol, hostname } = window.location;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return protocol + '//' + hostname + ':3001';
    }
    // Fallback to localhost
    return 'http://localhost:3001';
  }
  return 'http://localhost:3001';
}

function activateTabs() {
  const tabs = document.querySelectorAll('.auth-tab');
  const panels = document.querySelectorAll('.auth-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.getAttribute('data-tab');
      tabs.forEach((candidate) => candidate.classList.remove('active'));
      tab.classList.add('active');
      panels.forEach((panel) => {
        panel.classList.toggle('active', panel.getAttribute('data-panel') === next);
      });
    });
  });
}

function getEndpoint(kind) {
  const spec = AUTH_CONTRACT[kind];
  return {
    method: spec.method,
    url: (AUTH_CONTRACT.baseUrl === '__DYNAMIC__' ? resolveApiBaseUrl() : AUTH_CONTRACT.baseUrl) + spec.route,
  };
}

function setFormError(kind, message) {
  const target = document.querySelector(`.form-error[data-error="${kind}"]`);
  if (target) target.textContent = message || '';
}

async function callAuth(kind, payload) {
  const endpoint = getEndpoint(kind);
  const response = await fetch(endpoint.url, {
    method: endpoint.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Authentication failed');
  }
  return data;
}

function renderHome() {
  const root = document.getElementById('root');
  root.innerHTML = HOME_HTML;
  const logoutButton = document.getElementById('logout-btn');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      renderLanding();
    });
  }
}

function attachAuthHandlers() {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormError('login', '');
      const formData = new FormData(loginForm);
      try {
        const result = await callAuth('login', {
          email: String(formData.get('email') || ''),
          password: String(formData.get('password') || ''),
        });
        localStorage.setItem('authToken', result.token);
        localStorage.setItem('authUser', JSON.stringify(result.user || {}));
        renderHome();
      } catch (error) {
        setFormError('login', error.message);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormError('signup', '');
      const formData = new FormData(signupForm);
      try {
        const result = await callAuth('signup', {
          name: String(formData.get('name') || ''),
          email: String(formData.get('email') || ''),
          password: String(formData.get('password') || ''),
        });
        localStorage.setItem('authToken', result.token);
        localStorage.setItem('authUser', JSON.stringify(result.user || {}));
        renderHome();
      } catch (error) {
        setFormError('signup', error.message);
      }
    });
  }
}

function renderLanding() {
  const root = document.getElementById('root');
  root.innerHTML = APP_HTML;
  activateTabs();
  attachAuthHandlers();
}

document.addEventListener('DOMContentLoaded', function() {
  if (localStorage.getItem('authToken')) {
    renderHome();
    return;
  }
  renderLanding();
});