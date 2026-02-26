import './style.css';

const APP_HTML = "<div class='app-container'><div class='landing-container'><h1>Welcome to Your App</h1><p class='starter-copy'>Start by editing llm_src and llm_src_backend to define your product features.</p></div><div class='navbar-container'><nav class='navbar'><strong>Starter App</strong></nav></div><div class='activityfeed-container'><section class='activity-feed'><h2>Recent Activities</h2><ul><li>Kickoff planning</li><li>First feature draft</li><li>Initial validation run</li></ul></section></div></div>";
const HOME_HTML = "<div class='route-home'><div class='navbar-container'><nav class='navbar'><strong>Starter App</strong></nav></div><div class='activityfeed-container'><section class='activity-feed'><h2>Recent Activities</h2><ul><li>Kickoff planning</li><li>First feature draft</li><li>Initial validation run</li></ul></section></div></div>";
const AUTH_ENABLED = false;
const AUTH_CONTRACT = null;

function resolveApiBaseUrl() {
  if (typeof window !== 'undefined') {
    if (window.API_BASE_URL) return window.API_BASE_URL;
    const { protocol, hostname } = window.location;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return protocol + '//' + hostname + ':3001';
    }
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

function setFormError(kind, message) {
  const target = document.querySelector(`.form-error[data-error="${kind}"]`);
  if (target) target.textContent = message || '';
}

function getEndpoint(kind) {
  if (!AUTH_ENABLED || !AUTH_CONTRACT || !AUTH_CONTRACT[kind]) {
    throw new Error('Authentication capability is not enabled');
  }

  const spec = AUTH_CONTRACT[kind];
  const baseUrl = AUTH_CONTRACT.baseUrl === '__DYNAMIC__' ? resolveApiBaseUrl() : AUTH_CONTRACT.baseUrl;
  return { method: spec.method, url: baseUrl + spec.route };
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
  if (!AUTH_ENABLED) return;

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
  if (AUTH_ENABLED && localStorage.getItem('authToken')) {
    renderHome();
    return;
  }
  renderLanding();
});