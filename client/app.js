// ===== STATE =====
const state = {
  currentCaseId: null,
  currentProfile: null,
  currentAnalysis: null,
  cases: [],
  uploadedFiles: [],
  quizState: null,
  activeTab: 'terminology',
  mode: 'upload', // 'upload' | 'analysis'
  user: null,
  token: null,
  preferences: { theme: 'system', language: 'zh' },
  currentNotes: '',
  currentTags: [],
  currentHearingDate: '',
  flashcardState: null,
  sidebarTagFilter: '',
  analysisRetryCount: 0
};

// ===== DOM REFS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== AUTH =====
function getToken() { return localStorage.getItem('cpe_token'); }
function setToken(t) { localStorage.setItem('cpe_token', t); state.token = t; }
function clearToken() { localStorage.removeItem('cpe_token'); state.token = null; state.user = null; }

function apiFetch(url, options = {}) {
  const token = getToken();
  if (!token && !url.startsWith('/api/auth/')) {
    showAuthScreen();
    return Promise.reject(new Error('Not authenticated'));
  }
  options.headers = { ...options.headers };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, options).then(res => {
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      clearToken();
      showAuthScreen();
      throw new Error('Session expired');
    }
    // Guard against non-JSON responses (e.g. Render cold-start HTML pages)
    const ct = res.headers.get('content-type') || '';
    if (!res.ok && !ct.includes('application/json')) {
      throw new Error(res.status === 502 || res.status === 503
        ? 'Server is starting up — please try again in a few seconds'
        : `Server error (${res.status})`);
    }
    return res;
  });
}

function showAuthScreen() {
  $('#auth-screen').style.display = 'flex';
  $('#app').style.display = 'none';
}

function showApp() {
  $('#auth-screen').style.display = 'none';
  $('#app').style.display = '';
  if (state.user) {
    $('#user-email').textContent = state.isGuest ? 'Guest Mode' : state.user.email;
    updateKeyStatus();
  }
}

function updateKeyStatus() {
  const el = $('#api-key-status');
  const btn = $('#api-key-btn');
  if (!el) return;
  if (state.user?.has_api_key) {
    el.textContent = 'API key saved (encrypted)';
    el.className = 'api-key-status valid';
    if (btn) btn.style.color = 'var(--success)';
  } else {
    el.textContent = 'No API key set — required for analysis';
    el.className = 'api-key-status invalid';
    if (btn) btn.style.color = '';
  }
}

// ===== THEME / PREFERENCES =====
function applyTheme(theme) {
  const html = document.documentElement;
  html.removeAttribute('data-theme');
  if (theme === 'dark') html.setAttribute('data-theme', 'dark');
  else if (theme === 'light') html.setAttribute('data-theme', 'light');
  // 'system' = no attribute, falls through to @media query
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const idx = order.indexOf(state.preferences.theme);
  state.preferences.theme = order[(idx + 1) % 3];
  applyTheme(state.preferences.theme);
  savePreferences();
  const icons = { system: '\u{263D}', light: '\u{2600}', dark: '\u{1F319}' };
  const btn = $('#dark-mode-toggle');
  if (btn) btn.textContent = icons[state.preferences.theme] || '\u{263D}';
}

async function loadPreferences() {
  try {
    const res = await apiFetch('/api/auth/preferences');
    if (res.ok) {
      const prefs = await res.json();
      if (prefs && typeof prefs === 'object') {
        Object.assign(state.preferences, prefs);
      }
    }
  } catch {}
  applyTheme(state.preferences.theme);
  // Also try localStorage fallback
  const local = localStorage.getItem('cpe_preferences');
  if (local) {
    try { Object.assign(state.preferences, JSON.parse(local)); } catch {}
    applyTheme(state.preferences.theme);
  }
}

function savePreferences() {
  localStorage.setItem('cpe_preferences', JSON.stringify(state.preferences));
  apiFetch('/api/auth/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: state.preferences })
  }).catch(() => {});
}

// ===== OFFLINE CACHE =====
function cacheCase(id, data) {
  try { localStorage.setItem(`cpe_case_${id}`, JSON.stringify(data)); } catch {}
}

function getCachedCase(id) {
  try { return JSON.parse(localStorage.getItem(`cpe_case_${id}`)); } catch { return null; }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  loadPreferences();

  const token = getToken();
  if (token) {
    try {
      const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const user = await res.json();
        state.user = user;
        state.token = token;
        showApp();
        loadCases();
        loadPreferences();
        return;
      }
    } catch {}
    clearToken();
  }
  showAuthScreen();
});

function bindEvents() {
  // Sidebar
  $('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('collapsed'));
  $('#new-case-btn').addEventListener('click', newCase);

  // Upload hero — click to browse
  const dropzone = $('#upload-dropzone');
  dropzone.addEventListener('click', () => $('#file-input').click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  $('#file-input').addEventListener('change', e => handleFiles(Array.from(e.target.files)));

  // Topbar add files (when in analysis mode)
  $('#upload-btn-topbar').addEventListener('click', () => $('#file-input-topbar').click());
  $('#file-input-topbar').addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
  });

  // Analyze buttons
  $('#upload-analyze-btn').addEventListener('click', runAnalysis);
  $('#analyze-btn').addEventListener('click', runAnalysis);

  // Tabs
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Term table
  $$('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => sortTermTable(th.dataset.sort));
  });
  $('#term-search').addEventListener('input', filterTermTable);
  $('#term-domain-filter').addEventListener('change', filterTermTable);
  $('#term-export').addEventListener('click', exportTerms);

  // Simp/Trad toggle
  $('#zh-toggle').addEventListener('click', (e) => {
    const opt = e.target.closest('.zh-toggle-opt');
    if (!opt) return;
    zhMode = opt.dataset.mode;
    $$('.zh-toggle-opt').forEach(o => o.classList.toggle('active', o.dataset.mode === zhMode));
    renderTermRows(state.currentAnalysis?.terminology || []);
  });

  // Hazard sort
  $('#hazard-sort').addEventListener('change', renderHazards);

  // Export PDF
  $('#export-pdf-btn').addEventListener('click', exportAllTabsPDF);

  // API Key modal (server-backed)
  $('#api-key-btn').addEventListener('click', () => {
    $('#api-key-input').value = '';
    updateKeyStatus();
    $('#api-key-modal').classList.remove('hidden');
  });
  $('#api-key-close').addEventListener('click', () => $('#api-key-modal').classList.add('hidden'));
  $('#api-key-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#api-key-modal').classList.add('hidden');
  });
  $('#api-key-save').addEventListener('click', async () => {
    const key = $('#api-key-input').value.trim();
    if (!key || !key.startsWith('sk-')) {
      $('#api-key-status').textContent = 'Invalid key format — should start with sk-';
      $('#api-key-status').className = 'api-key-status invalid';
      return;
    }
    try {
      const res = await apiFetch('/api/auth/api-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key })
      });
      if (res.ok) {
        state.user.has_api_key = true;
        updateKeyStatus();
        $('#api-key-input').value = '';
        $('#api-key-modal').classList.add('hidden');
      }
    } catch {}
  });
  $('#api-key-clear').addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/api-key', { method: 'DELETE' });
      state.user.has_api_key = false;
      updateKeyStatus();
      $('#api-key-input').value = '';
    } catch {}
  });
  $('#api-key-toggle').addEventListener('click', () => {
    const inp = $('#api-key-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Auth
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.auth;
      $('#auth-submit').textContent = mode === 'login' ? 'Login' : 'Create Account';
      $('#auth-error').textContent = '';
    });
  });
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const mode = $('.auth-tab.active').dataset.auth;
    $('#auth-error').textContent = '';
    $('#auth-submit').disabled = true;
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken(data.token);
      state.user = data.user;
      showApp();
      loadCases();
      if (!data.user.has_api_key) $('#api-key-modal').classList.remove('hidden');
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      $('#auth-submit').disabled = false;
    }
  });
  $('#logout-btn').addEventListener('click', () => {
    clearToken();
    state.cases = [];
    state.currentCaseId = null;
    state.currentAnalysis = null;
    state.isGuest = false;
    showAuthScreen();
  });

  // Guest mode
  $('#guest-btn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken(data.token);
      state.user = data.user;
      state.isGuest = true;
      showApp();
      // Immediately show API key modal for guests
      $('#api-key-modal').classList.remove('hidden');
    } catch (err) {
      $('#auth-error').textContent = err.message;
    }
  });

  // Forgot password
  $('#forgot-pw-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('#forgot-modal').classList.remove('hidden');
  });
  $('#forgot-close').addEventListener('click', () => $('#forgot-modal').classList.add('hidden'));
  $('#forgot-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#forgot-modal').classList.add('hidden');
  });
  $('#forgot-submit').addEventListener('click', async () => {
    const email = $('#forgot-email').value.trim();
    if (!email) { $('#forgot-status').textContent = 'Enter your email'; return; }
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      $('#forgot-status').textContent = data.message || 'If an account exists, a reset link has been sent.';
      $('#forgot-status').style.color = 'var(--success)';
    } catch {
      $('#forgot-status').textContent = 'If an account exists, a reset link has been sent.';
      $('#forgot-status').style.color = 'var(--success)';
    }
  });

  // Quiz
  $('#quiz-mcq-btn').addEventListener('click', startMCQ);
  $('#quiz-sight-btn').addEventListener('click', startSight);
  $('#quiz-context-btn').addEventListener('click', startContextQuiz);

  // Podcast
  $('#podcast-generate-btn').addEventListener('click', () => generatePodcast(false));
  $('#podcast-regenerate-btn').addEventListener('click', () => generatePodcast(true));
  $('#podcast-copy-btn').addEventListener('click', copyPodcastScript);
  $('#podcast-play-btn').addEventListener('click', playPodcastScript);
  $('#podcast-stop-btn').addEventListener('click', stopPodcastScript);
  $('#quiz-retry-btn').addEventListener('click', () => {
    if (state.quizState?.mode === 'context') startContextQuiz();
    else startMCQ();
  });
  $('#quiz-back-btn').addEventListener('click', showQuizSetup);
  $('#sight-done-btn').addEventListener('click', showSightAssessment);
  $('#sight-next-btn').addEventListener('click', startSight);
  $('#sight-submit-btn').addEventListener('click', submitSightAssessment);

  // ===== NEW FEATURE BINDINGS =====

  // Dark mode toggle
  $('#dark-mode-toggle')?.addEventListener('click', cycleTheme);

  // Flashcard button
  $('#term-flashcard-btn')?.addEventListener('click', openFlashcards);
  $('#fc-close')?.addEventListener('click', closeFlashcards);
  $('#fc-flip')?.addEventListener('click', flipFlashcard);
  $('#flashcard-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFlashcards();
  });
  $$('.fc-rate').forEach(btn => {
    btn.addEventListener('click', () => rateFlashcard(btn.dataset.rating));
  });

  // Audio pronunciation
  $('#term-audio-btn')?.addEventListener('click', playTermAudio);

  // Anki export
  $('#export-anki-btn')?.addEventListener('click', exportAnki);

  // Doc export
  $('#export-docx-btn')?.addEventListener('click', exportDoc);

  // Notes tab auto-save
  let notesTimer = null;
  $('#notes-textarea')?.addEventListener('input', () => {
    state.currentNotes = $('#notes-textarea').value;
    if (notesTimer) clearTimeout(notesTimer);
    $('#notes-save-status').textContent = 'Saving...';
    notesTimer = setTimeout(saveNotes, 1000);
  });

  // Tag input
  $('#notes-tag-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = e.target.value.trim();
      if (tag && !state.currentTags.includes(tag)) {
        state.currentTags.push(tag);
        renderNoteTags();
        saveTags();
      }
      e.target.value = '';
    }
  });

  // Hearing date
  $('#notes-hearing-date')?.addEventListener('change', (e) => {
    state.currentHearingDate = e.target.value;
    saveHearingDate();
  });

  // Sidebar tag filter
  $('#sidebar-tag-select')?.addEventListener('change', (e) => {
    state.sidebarTagFilter = e.target.value;
    renderCaseList();
  });

  // Settings modal
  $('#settings-btn')?.addEventListener('click', openSettings);
  $('#settings-close')?.addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
  $('#settings-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#settings-modal').classList.add('hidden');
  });
  $('#settings-save')?.addEventListener('click', saveSettingsModal);
  $('#settings-change-pw-btn')?.addEventListener('click', changePassword);

  // ===== KEYBOARD SHORTCUTS =====
  document.addEventListener('keydown', (e) => {
    // Skip if user is typing in an input/textarea
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }

    // Tab switching 1-8
    if (e.key >= '1' && e.key <= '8' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tabs = ['terminology', 'context', 'legal-theory', 'industry', 'hazards', 'quiz', 'podcast', 'notes'];
      const idx = parseInt(e.key) - 1;
      if (idx < tabs.length && state.mode === 'analysis') {
        e.preventDefault();
        switchTab(tabs[idx]);
      }
      return;
    }

    // Escape — close modals
    if (e.key === 'Escape') {
      $$('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
      if (!$('#flashcard-overlay').classList.contains('hidden')) closeFlashcards();
      return;
    }

    // N = new case
    if (e.key === 'n' || e.key === 'N') { newCase(); return; }

    // D = toggle dark mode
    if (e.key === 'd' || e.key === 'D') { cycleTheme(); return; }

    // / = focus search
    if (e.key === '/') {
      e.preventDefault();
      const search = $('#term-search');
      if (search) search.focus();
      return;
    }

    // E = export PDF
    if ((e.key === 'e' || e.key === 'E') && state.mode === 'analysis') {
      exportAllTabsPDF();
      return;
    }
  });

  // ===== DRAG TO REORDER SIDEBAR =====
  setupSidebarDrag();
}

// ===== FILE HANDLING =====
function handleFiles(files) {
  if (!files.length) return;
  const total = state.uploadedFiles.length + files.length;
  if (total > 20) {
    alert('Maximum 20 documents. Remove some first.');
    return;
  }
  state.uploadedFiles.push(...files);
  renderFileList();
}

function renderFileList() {
  const list = $('#upload-file-list');
  const actions = $('#upload-actions');

  if (state.uploadedFiles.length === 0) {
    list.innerHTML = '';
    actions.style.display = 'none';
    return;
  }

  actions.style.display = 'flex';

  const icons = { 'application/pdf': '\uD83D\uDCC4', 'text/plain': '\uD83D\uDCC3' };
  list.innerHTML = state.uploadedFiles.map((f, i) => {
    const icon = icons[f.type] || '\uD83D\uDCC1';
    const size = f.size < 1024*1024
      ? (f.size / 1024).toFixed(0) + ' KB'
      : (f.size / (1024*1024)).toFixed(1) + ' MB';
    return `<div class="upload-file-item">
      <span class="file-icon">${icon}</span>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${size}</span>
      <button class="file-remove" data-idx="${i}" title="Remove">&times;</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.uploadedFiles.splice(parseInt(btn.dataset.idx), 1);
      renderFileList();
    });
  });

  // Auto-set case name from first file
  const nameInput = $('#upload-case-name');
  if (!nameInput.value) {
    nameInput.value = state.uploadedFiles[0].name.replace(/\.[^.]+$/, '');
  }
}

// ===== CASES =====
async function loadCases() {
  try {
    const res = await apiFetch('/api/cases');
    if (!res.ok) throw new Error('Failed to load cases');
    state.cases = await res.json();
    renderCaseList();
  } catch (e) {
    console.error('Failed to load cases:', e);
  }
}

function renderCaseList() {
  const list = $('#case-list');
  let filtered = state.cases;

  // Apply tag filter
  if (state.sidebarTagFilter) {
    filtered = filtered.filter(c => (c.tags || []).includes(state.sidebarTagFilter));
  }

  // Update tag filter dropdown
  const allTags = [...new Set(state.cases.flatMap(c => c.tags || []))];
  const tagSelect = $('#sidebar-tag-select');
  if (tagSelect) {
    const current = tagSelect.value;
    tagSelect.innerHTML = '<option value="">All tags</option>' +
      allTags.map(t => `<option value="${esc(t)}" ${t === current ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }
  const tagFilter = $('#sidebar-tag-filter');
  if (tagFilter) tagFilter.classList.toggle('hidden', allTags.length === 0);

  list.innerHTML = filtered.map(c => {
    const tags = (c.tags || []).map(t => `<span class="case-tag">${esc(t)}</span>`).join('');
    const hearingBadge = c.hearing_date ? (() => {
      const days = Math.ceil((new Date(c.hearing_date) - new Date()) / 86400000);
      if (days < 0) return '';
      return `<span class="case-hearing-badge">${days === 0 ? 'Today' : days + 'd'}</span>`;
    })() : '';
    return `
    <div class="case-item ${c.id === state.currentCaseId ? 'active' : ''}" data-id="${c.id}" draggable="true">
      <div class="case-item-name">${esc(c.name)} ${hearingBadge}</div>
      <div class="case-item-meta">${c.case_type || ''} &middot; ${new Date(c.created_at).toLocaleDateString()}</div>
      ${tags ? `<div class="case-item-tags">${tags}</div>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.case-item').forEach(el => {
    el.addEventListener('click', () => loadCase(el.dataset.id));
  });

  setupSidebarDrag();
}

function newCase() {
  state.currentCaseId = null;
  state.currentProfile = null;
  state.currentAnalysis = null;
  state.uploadedFiles = [];
  state.mode = 'upload';
  $('#case-title').textContent = 'New Case';
  $('#upload-case-name').value = '';
  $('#file-input').value = '';
  renderFileList();
  showUploadMode();
  renderCaseList();
}

async function loadCase(id) {
  try {
    const res = await apiFetch(`/api/cases/${id}`);
    const data = await res.json();
    state.currentCaseId = data.id;
    state.currentProfile = data.profile;
    state.currentAnalysis = data.analysis;
    state.currentNotes = data.notes || '';
    state.currentTags = data.tags || [];
    state.currentHearingDate = data.hearing_date || '';
    state.mode = 'analysis';
    $('#case-title').textContent = data.name;
    // Cache for offline
    cacheCase(id, data);
    renderCaseList();
    showAnalysisMode();
  } catch (e) {
    console.error('Failed to load case:', e);
    // Try offline cache
    const cached = getCachedCase(id);
    if (cached) {
      state.currentCaseId = cached.id;
      state.currentProfile = cached.profile;
      state.currentAnalysis = cached.analysis;
      state.currentNotes = cached.notes || '';
      state.currentTags = cached.tags || [];
      state.currentHearingDate = cached.hearing_date || '';
      state.mode = 'analysis';
      $('#case-title').textContent = (cached.name || 'Cached') + ' (offline)';
      renderCaseList();
      showAnalysisMode();
    }
  }
}

// ===== MODE SWITCHING =====
function showUploadMode() {
  $('#upload-hero').classList.remove('hidden');
  $('#tab-nav').style.display = 'none';
  $$('.tab-panel').forEach(p => p.classList.add('hidden'));
  $('#topbar-upload').style.display = 'none';
  $('#case-name-input').style.display = 'none';
  $('#analyze-btn').style.display = 'none';
  $('#export-pdf-btn').style.display = 'none';
  if ($('#export-anki-btn')) $('#export-anki-btn').style.display = 'none';
  if ($('#export-docx-btn')) $('#export-docx-btn').style.display = 'none';
}

function showAnalysisMode() {
  $('#upload-hero').classList.add('hidden');
  $('#tab-nav').style.display = 'flex';
  $('#topbar-upload').style.display = 'flex';
  $('#case-name-input').style.display = 'block';
  $('#analyze-btn').style.display = 'block';
  $('#analyze-btn').disabled = true;
  $('#export-pdf-btn').style.display = 'inline-block';
  if ($('#export-anki-btn')) $('#export-anki-btn').style.display = 'inline-block';
  if ($('#export-docx-btn')) $('#export-docx-btn').style.display = 'inline-block';
  switchTab(state.activeTab);
}

// ===== ANALYSIS =====
async function runAnalysis() {
  const files = state.uploadedFiles;
  if (files.length === 0) return;

  if (!state.user?.has_api_key) {
    $('#api-key-modal').classList.remove('hidden');
    return;
  }

  const caseName = ($('#upload-case-name').value || $('#case-name-input').value || '').trim()
    || files[0].name.replace(/\.[^.]+$/, '');

  setProgress(0, 'Uploading documents...');

  const formData = new FormData();
  files.forEach(f => formData.append('documents', f));
  formData.append('caseName', caseName);
  formData.append('docLabels', JSON.stringify(files.map(f => f.name)));

  // Disable buttons
  $('#upload-analyze-btn').disabled = true;
  $('#analyze-btn').disabled = true;

  let progressTimer = null;
  try {
    setProgress(10, 'Extracting text...');

    progressTimer = setInterval(() => {
      const current = parseFloat($('.progress-fill').style.width) || 10;
      if (current < 88) {
        const msgs = {
          20: 'Analyzing case profile...',
          40: 'Running deductive inference...',
          60: 'Generating terminology...',
          75: 'Building hazard scenarios...',
        };
        const next = current + 2;
        const nearestMsg = Object.entries(msgs).find(([k]) => Math.abs(next - parseInt(k)) < 3);
        setProgress(next, nearestMsg ? nearestMsg[1] : null);
      }
    }, 2000);

    const res = await apiFetch('/api/analyze', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      let errMsg = 'Analysis failed';
      try {
        const err = await res.json();
        errMsg = err.error || errMsg;
      } catch { /* response wasn't JSON */ }
      throw new Error(errMsg);
    }

    const data = await res.json();
    clearInterval(progressTimer);
    progressTimer = null;
    state.analysisRetryCount = 0;
    setProgress(100, 'Ready!');

    state.currentCaseId = data.caseId;
    state.currentProfile = data.profile;
    state.currentAnalysis = data.analysis;
    state.mode = 'analysis';
    $('#case-title').textContent = caseName;
    $('#case-name-input').value = caseName;

    await loadCases();
    showAnalysisMode();

    setTimeout(() => $('#progress-bar').classList.add('hidden'), 1200);
  } catch (err) {
    if (progressTimer) clearInterval(progressTimer);
    state.analysisRetryCount++;
    if (state.analysisRetryCount <= 3 && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed'))) {
      const delay = Math.pow(2, state.analysisRetryCount) * 1000;
      setProgress(0, `Network error — retrying in ${delay/1000}s (attempt ${state.analysisRetryCount}/3)...`);
      setTimeout(() => runAnalysis(), delay);
      return;
    }
    state.analysisRetryCount = 0;
    setProgress(0, 'Error: ' + err.message);
    $('.progress-fill').style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
    setTimeout(() => {
      $('#progress-bar').classList.add('hidden');
      $('.progress-fill').style.background = '';
    }, 5000);
  } finally {
    $('#upload-analyze-btn').disabled = false;
    $('#analyze-btn').disabled = false;
  }
}

function setProgress(pct, msg) {
  $('#progress-bar').classList.remove('hidden');
  $('.progress-fill').style.width = pct + '%';
  if (msg) $('.progress-text').textContent = msg;
}

// ===== TABS =====
function switchTab(tab) {
  state.activeTab = tab;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.add('hidden'));

  const panel = $(`#tab-${tab}`);
  if (panel && (state.currentAnalysis || tab === 'notes')) {
    panel.classList.remove('hidden');
    renderTab(tab);
  }
}

function renderTab(tab) {
  const a = state.currentAnalysis;
  if (!a) return;
  switch (tab) {
    case 'terminology': renderTerminology(a.terminology || []); break;
    case 'context': renderContext(a.context_nodes || []); break;
    case 'legal-theory': renderLegalTheory(a.legal_theory || {}); break;
    case 'industry': renderIndustry(a.industry_knowledge || {}); break;
    case 'hazards': renderHazards(); break;
    case 'quiz': showQuizSetup(); break;
    case 'podcast': showPodcastSetup(); break;
    case 'notes': renderNotes(); break;
  }
}

// ===== TAB 1: TERMINOLOGY =====
// Renderer cache — prevents event listener leaks on tab switch
const _renderers = {};
function getOrCreateRenderer(key, container) {
  if (_renderers[key]) _renderers[key].destroy();
  const mm = new MindMapRenderer(container);
  _renderers[key] = mm;
  return mm;
}

let termSortKey = 'difficulty';
let termSortDir = -1;
let zhMode = 'simplified'; // 'simplified' | 'traditional'
const expandedTerms = new Set();
let dismissedOpen = false;

function renderTerminology(terms) {
  const domains = [...new Set(terms.map(t => t.domain).filter(Boolean))];
  const domFilter = $('#term-domain-filter');
  domFilter.innerHTML = '<option value="">All domains</option>' +
    domains.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  renderTermRows(terms);
}

function getFilteredTerms(terms) {
  const search = ($('#term-search').value || '').toLowerCase();
  const domain = $('#term-domain-filter').value;
  let filtered = terms;
  if (search) {
    filtered = filtered.filter(t =>
      (t.en||'').toLowerCase().includes(search) ||
      (t.zh_simplified||'').includes(search) ||
      (t.zh_traditional||'').includes(search) ||
      (t.pinyin||'').toLowerCase().includes(search) ||
      (t.context_note||'').toLowerCase().includes(search)
    );
  }
  if (domain) filtered = filtered.filter(t => t.domain === domain);
  filtered.sort((a, b) => {
    const va = a[termSortKey] || '';
    const vb = b[termSortKey] || '';
    if (typeof va === 'number') return (va - vb) * termSortDir;
    return String(va).localeCompare(String(vb)) * termSortDir;
  });
  return filtered;
}

function buildTermRow(t, idx, isDismissed) {
  const diff = t.difficulty ?? 3;
  const zhText = zhMode === 'simplified' ? (t.zh_simplified || '') : (t.zh_traditional || '');
  const isExpanded = expandedTerms.has(idx);
  const expandCls = isExpanded ? 'term-row-expanded' : '';

  let row = `<tr class="term-row ${expandCls}" data-idx="${idx}">
    <td class="td-dismiss"><button class="term-dismiss-btn" data-idx="${idx}" title="Set to 0">&times;</button></td>
    <td class="td-en" data-idx="${idx}"><span class="term-expand-chevron">${isExpanded ? '\u25BE' : '\u25B8'}</span> <strong>${esc(t.en)}</strong></td>
    <td class="zh-cell">${esc(zhText)}</td>
    <td class="td-diff">
      <button class="diff-ctrl diff-minus" data-idx="${idx}">&minus;</button>
      <span class="diff-badge diff-${diff} diff-clickable" data-idx="${idx}">${diff}</span>
      <button class="diff-ctrl diff-plus" data-idx="${idx}">+</button>
    </td>
  </tr>`;

  if (isExpanded) {
    row += `<tr class="term-detail-row" data-idx="${idx}">
      <td colspan="4">
        <div class="term-detail-strip">
          ${t.pinyin ? `<span class="term-detail-pinyin">${esc(t.pinyin)}</span>` : ''}
          ${t.context_note ? `<span class="term-detail-context">${esc(t.context_note)}</span>` : ''}
        </div>
      </td>
    </tr>`;
  }
  return row;
}

function renderTermRows(terms) {
  const filtered = getFilteredTerms(terms);
  const active = filtered.filter(t => (t.difficulty ?? 3) > 0);
  const dismissed = filtered.filter(t => (t.difficulty ?? 3) === 0);

  // Active terms
  $('#term-tbody').innerHTML = active.map((t, i) => {
    const realIdx = terms.indexOf(t);
    return buildTermRow(t, realIdx, false);
  }).join('');

  // Dismissed section
  const dismissedSection = $('#term-dismissed-section');
  const dismissedCount = $('#term-dismissed-count');
  const dismissedTbody = $('#term-dismissed-tbody');
  if (dismissed.length > 0) {
    dismissedSection.classList.remove('hidden');
    dismissedCount.textContent = dismissed.length;
    if (dismissedOpen) {
      dismissedTbody.innerHTML = dismissed.map(t => {
        const realIdx = terms.indexOf(t);
        return buildTermRow(t, realIdx, true);
      }).join('');
      dismissedTbody.parentElement.classList.remove('hidden');
    } else {
      dismissedTbody.innerHTML = '';
      dismissedTbody.parentElement.classList.add('hidden');
    }
  } else {
    dismissedSection.classList.add('hidden');
  }

  // Bind events via delegation
  bindTermEvents();
}

function bindTermEvents() {
  // Use event delegation on the wrapper
  const wrapper = $('#term-table-wrapper');
  // Remove old listener and re-add (simple approach)
  wrapper.onclick = (e) => {
    const target = e.target;
    const terms = state.currentAnalysis?.terminology || [];

    // Dismiss button
    if (target.classList.contains('term-dismiss-btn')) {
      e.stopPropagation();
      const idx = parseInt(target.dataset.idx);
      if (terms[idx]) { terms[idx].difficulty = 0; renderTermRows(terms); }
      return;
    }

    // Diff minus
    if (target.classList.contains('diff-minus')) {
      e.stopPropagation();
      const idx = parseInt(target.dataset.idx);
      if (terms[idx]) {
        terms[idx].difficulty = Math.max(0, (terms[idx].difficulty ?? 3) - 1);
        renderTermRows(terms);
      }
      return;
    }

    // Diff plus
    if (target.classList.contains('diff-plus')) {
      e.stopPropagation();
      const idx = parseInt(target.dataset.idx);
      if (terms[idx]) {
        terms[idx].difficulty = Math.min(5, (terms[idx].difficulty ?? 3) + 1);
        renderTermRows(terms);
      }
      return;
    }

    // Diff badge click — inline number selector
    if (target.classList.contains('diff-clickable')) {
      e.stopPropagation();
      const idx = parseInt(target.dataset.idx);
      const rect = target.getBoundingClientRect();
      showDiffPicker(idx, rect);
      return;
    }

    // Row expand/collapse — click on English cell or chevron
    const enCell = target.closest('.td-en');
    if (enCell) {
      const idx = parseInt(enCell.dataset.idx);
      if (expandedTerms.has(idx)) expandedTerms.delete(idx);
      else expandedTerms.add(idx);
      renderTermRows(terms);
      return;
    }

    // Dismissed toggle
    if (target.closest('#term-dismissed-toggle')) {
      dismissedOpen = !dismissedOpen;
      renderTermRows(terms);
      return;
    }
  };
}

function showDiffPicker(idx, anchorRect) {
  // Remove existing picker
  const existing = document.querySelector('.diff-picker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.className = 'diff-picker';
  picker.innerHTML = [0,1,2,3,4,5].map(n =>
    `<button class="diff-pick-btn diff-${n}" data-val="${n}">${n}</button>`
  ).join('');
  document.body.appendChild(picker);

  // Position near the badge
  picker.style.position = 'fixed';
  picker.style.left = (anchorRect.left - 20) + 'px';
  picker.style.top = (anchorRect.bottom + 4) + 'px';
  picker.style.zIndex = '9999';

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.diff-pick-btn');
    if (btn) {
      const val = parseInt(btn.dataset.val);
      const terms = state.currentAnalysis?.terminology || [];
      if (terms[idx]) { terms[idx].difficulty = val; renderTermRows(terms); }
    }
    picker.remove();
  });

  // Close on outside click
  setTimeout(() => {
    const close = (e) => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 50);
}

function sortTermTable(key) {
  if (termSortKey === key) termSortDir *= -1;
  else { termSortKey = key; termSortDir = 1; }
  renderTermRows(state.currentAnalysis?.terminology || []);
}
function filterTermTable() { renderTermRows(state.currentAnalysis?.terminology || []); }

function exportTerms() {
  const terms = state.currentAnalysis?.terminology || [];
  const lines = ['English\tSimplified\tTraditional\tPinyin\tContext\tDifficulty'];
  terms.forEach(t => lines.push(`${t.en}\t${t.zh_simplified}\t${t.zh_traditional}\t${t.pinyin}\t${t.context_note}\t${t.difficulty}`));
  downloadText(lines.join('\n'), 'terminology.tsv');
}

// ===== INTERACTIVE MIND MAP ENGINE =====
class MindMapRenderer {
  constructor(container, opts = {}) {
    this.container = container;
    this.width = opts.width || container.clientWidth || 900;
    this.height = opts.height || Math.max(600, container.clientHeight || 600);
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.dragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.selectedNode = null;
    this.nodes = [];
    this.edges = [];
    this.expandedNodes = new Set();
    this.onNodeClick = opts.onNodeClick || null;
    // Focus mode state
    this.mode = opts.mode || null;  // 'context' | 'legal' | 'industry' | null
    this.focusedNodeId = null;
    this.focusedSet = new Set();
    this.hiddenNodes = new Set();
    this.drillLevel = 0;
    this.drillParentId = null;
    this._init();
  }

  destroy() {
    if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);
    if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
    if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
    if (this._animRAF) cancelAnimationFrame(this._animRAF);
    this.container.innerHTML = '';
  }

  _init() {
    this.container.innerHTML = '';
    this.container.classList.add('mindmap-container');

    // Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'mm-tooltip hidden';
    this.container.appendChild(this.tooltip);

    // SVG
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.style.cursor = 'grab';
    this.container.appendChild(this.svg);

    // Defs: gradients, filters, markers — dark-mode aware
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Gradient definitions: [light-top, light-bottom, dark-top, dark-bottom]
    const gradDefs = {
      'grad-date':      ['#F0F4FF','#E4EAFB', '#1c2340','#1a2038'],
      'grad-location':  ['#EEFAF2','#DEF2E5', '#162e20','#14281c'],
      'grad-person':    ['#FFF9F0','#F8EDDA', '#2e2618','#282014'],
      'grad-document':  ['#F5F7FA','#EAECF0', '#1e2028','#1a1c24'],
      'grad-amount':    ['#FDF3F1','#F5E4E1', '#2e1c18','#281816'],
      'grad-event':     ['#F6F2FD','#EBE2F6', '#221c30','#1e182a'],
      'grad-default':   ['#FAFBFC','#F0F2F5', '#1e2028','#1a1c24'],
      'grad-primary':   ['#EEF2FF','#DBEAFE', '#182040','#162038'],
      'grad-coa':       ['#FFFBEB','#FEF3C7', '#2a2410','#24200e'],
      'grad-term':      ['#FAF5FF','#F0E8FA', '#221830','#1e1428'],
      'grad-elements':  ['#EFF6FF','#DBEAFE', '#162040','#142038'],
      'grad-evidence':  ['#ECFDF5','#D1FAE5', '#122e1e','#10281a'],
      'grad-questions': ['#F5F3FF','#EDE9FE', '#1e1838','#1a1430'],
      'grad-answers':   ['#FDF2F8','#FCE7F3', '#2a1424','#24101e'],
      'grad-step':      ['#F0F9FF','#E0F2FE', '#142838','#122430'],
    };

    let gradientsSvg = '';
    for (const [id, [lt, lb, dt, db]] of Object.entries(gradDefs)) {
      const t = isDark ? dt : lt;
      const b = isDark ? db : lb;
      gradientsSvg += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${t}"/><stop offset="100%" stop-color="${b}"/></linearGradient>\n`;
    }

    defs.innerHTML = `
      <marker id="mm-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="${isDark ? '#5a6272' : 'var(--text-3)'}" opacity="0.5"/>
      </marker>
      <filter id="mm-shadow" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="${isDark ? '0.3' : '0.08'}"/>
        <feDropShadow dx="0" dy="3" stdDeviation="6" flood-opacity="${isDark ? '0.2' : '0.05'}"/>
        <feDropShadow dx="0" dy="6" stdDeviation="12" flood-opacity="${isDark ? '0.15' : '0.03'}"/>
      </filter>
      <filter id="mm-shadow-hover" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="${isDark ? '0.35' : '0.12'}"/>
        <feDropShadow dx="0" dy="6" stdDeviation="12" flood-opacity="${isDark ? '0.25' : '0.08'}"/>
        <feDropShadow dx="0" dy="12" stdDeviation="20" flood-opacity="${isDark ? '0.2' : '0.05'}"/>
      </filter>
      ${gradientsSvg}
    `;
    this.svg.appendChild(defs);

    // Groups for layering
    this.edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.appendChild(this.edgeGroup);
    this.svg.appendChild(this.nodeGroup);
    this.svg.appendChild(this.labelGroup);

    // Transform group wrapping all
    this.transformGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.removeChild(this.edgeGroup);
    this.svg.removeChild(this.nodeGroup);
    this.svg.removeChild(this.labelGroup);
    this.transformGroup.appendChild(this.edgeGroup);
    this.transformGroup.appendChild(this.nodeGroup);
    this.transformGroup.appendChild(this.labelGroup);
    this.svg.appendChild(this.transformGroup);

    // Detail panel (HTML overlay)
    this.detailPanel = document.createElement('div');
    this.detailPanel.className = 'mindmap-detail-panel hidden';
    this.container.appendChild(this.detailPanel);

    // Controls bar
    const controls = document.createElement('div');
    controls.className = 'mindmap-controls';
    controls.innerHTML = `
      <button class="mm-ctrl" data-action="zoomin" title="Zoom In">+</button>
      <button class="mm-ctrl" data-action="zoomout" title="Zoom Out">&minus;</button>
      <button class="mm-ctrl" data-action="fit" title="Fit View">&#9974;</button>
      <button class="mm-ctrl" data-action="reset" title="Reset">&#8634;</button>
    `;
    this.container.appendChild(controls);
    controls.querySelectorAll('.mm-ctrl').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleControl(btn.dataset.action);
      });
    });

    this._bindEvents();
  }

  _bindEvents() {
    // Pan
    this.svg.addEventListener('mousedown', (e) => {
      if (e.target === this.svg || e.target.tagName === 'line' || e.target.tagName === 'path') {
        this.dragging = true;
        this.dragStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        this.svg.style.cursor = 'grabbing';
      }
    });
    this._onMouseMove = (e) => {
      if (!this.dragging) return;
      this.panX = e.clientX - this.dragStart.x;
      this.panY = e.clientY - this.dragStart.y;
      this._applyTransform();
    };
    this._onMouseUp = () => {
      this.dragging = false;
      this.svg.style.cursor = 'grab';
    };
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);

    // Zoom
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.2, Math.min(4, this.scale * delta));
      // Zoom towards mouse
      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this._applyTransform();
    }, { passive: false });

    // Touch support
    let lastTouchDist = 0;
    this.svg.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.dragStart = { x: e.touches[0].clientX - this.panX, y: e.touches[0].clientY - this.panY };
      } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    this.svg.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.dragging) {
        this.panX = e.touches[0].clientX - this.dragStart.x;
        this.panY = e.touches[0].clientY - this.dragStart.y;
        this._applyTransform();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (lastTouchDist > 0) {
          this.scale = Math.max(0.2, Math.min(4, this.scale * (dist / lastTouchDist)));
          this._applyTransform();
        }
        lastTouchDist = dist;
      }
    }, { passive: true });
    this.svg.addEventListener('touchend', () => { this.dragging = false; lastTouchDist = 0; });

    // Background click — clear focus / drill back (with drag guard)
    let didDrag = false;
    this.svg.addEventListener('mousedown', () => { didDrag = false; });
    this.svg.addEventListener('mousemove', () => { didDrag = true; });
    this.svg.addEventListener('click', (e) => {
      if (didDrag) return;
      if (e.target === this.svg || !e.target.closest('.mm-node')) {
        this._onBackgroundClick();
      }
    });

    // Escape key — same as background click (guarded to active tab)
    this._escHandler = (e) => {
      if (e.key === 'Escape' && this.container.offsetParent) {
        this._onBackgroundClick();
      }
    };
    document.addEventListener('keydown', this._escHandler);
  }

  _applyTransform() {
    this.transformGroup.setAttribute('transform', `translate(${this.panX},${this.panY}) scale(${this.scale})`);
  }

  _handleControl(action) {
    if (action === 'zoomin') { this.scale = Math.min(4, this.scale * 1.3); }
    else if (action === 'zoomout') { this.scale = Math.max(0.2, this.scale / 1.3); }
    else if (action === 'fit') { this._fitToView(); return; }
    else if (action === 'reset') { this.scale = 1; this.panX = 0; this.panY = 0; }
    this._applyTransform();
  }

  _fitToView() {
    if (!this.nodes.length) return;
    const xs = this.nodes.map(n => n.x);
    const ys = this.nodes.map(n => n.y);
    const minX = Math.min(...xs) - 100;
    const maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 80;
    const maxY = Math.max(...ys) + 80;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const cw = this.container.clientWidth || 900;
    const ch = this.container.clientHeight || 600;
    this.scale = Math.min(cw / bw, ch / bh, 1.5);
    this.panX = (cw - bw * this.scale) / 2 - minX * this.scale;
    this.panY = (ch - bh * this.scale) / 2 - minY * this.scale;
    this._applyTransform();
  }

  setData(nodes, edges) {
    this.nodes = nodes;
    // Filter out edges with invalid node refs so DOM indexing stays aligned
    const nodeIds = new Set(nodes.map(n => n.id));
    this.edges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
    this.expandedNodes.clear();
    this._render();
    // Fit after layout settles
    requestAnimationFrame(() => this._fitToView());
  }

  _render() {
    this.edgeGroup.innerHTML = '';
    this.nodeGroup.innerHTML = '';
    this.labelGroup.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    const self = this;
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const defaultStroke = isDarkMode ? '#3a4050' : '#D1D5DB';

    // Build node lookup map for O(1) edge resolution
    const nodeMap = new Map(this.nodes.map(n => [n.id, n]));

    // ── EDGES ──
    for (let ei = 0; ei < this.edges.length; ei++) {
      const edge = this.edges[ei];
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const cx1 = from.x + dx * 0.35;
      const cy1 = from.y + dy * 0.1;
      const cx2 = from.x + dx * 0.65;
      const cy2 = to.y - dy * 0.1;
      const d = `M${from.x},${from.y} C${cx1},${cy1} ${cx2},${cy2} ${to.x},${to.y}`;

      // Invisible hit area for hover
      const hitArea = document.createElementNS(NS, 'path');
      hitArea.setAttribute('d', d);
      hitArea.setAttribute('fill', 'none');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '28');
      hitArea.style.cursor = edge.label ? 'pointer' : 'default';
      this.edgeGroup.appendChild(hitArea);

      // Visible edge
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', edge.color || 'var(--border)');
      path.setAttribute('stroke-width', edge.width || 1.5);
      path.setAttribute('stroke-opacity', '0.45');
      path.setAttribute('stroke-linecap', 'round');
      if (!edge.noArrow) path.setAttribute('marker-end', 'url(#mm-arrow)');
      path.classList.add('mm-edge');
      if (edge.dashed) path.setAttribute('stroke-dasharray', '5,5');
      this.edgeGroup.appendChild(path);

      // No permanent edge labels — all labels shown only via hover tooltip

      // Edge hover — tooltip only, no permanent text clutter
      const onEnter = (e) => {
        path.setAttribute('stroke-opacity', '0.8');
        path.setAttribute('stroke-width', (edge.width || 1.5) + 1.5);
        if (edge.label) {
          self.tooltip.textContent = edge.label;
          self.tooltip.style.whiteSpace = 'nowrap';
          self.tooltip.style.maxWidth = '300px';
          self.tooltip.classList.remove('hidden');
          const cr = self.container.getBoundingClientRect();
          self.tooltip.style.left = (e.clientX - cr.left + 14) + 'px';
          self.tooltip.style.top = (e.clientY - cr.top - 36) + 'px';
        }
      };
      const onLeave = () => {
        path.setAttribute('stroke-opacity', '0.45');
        path.setAttribute('stroke-width', edge.width || 1.5);
        self.tooltip.classList.add('hidden');
      };
      hitArea.addEventListener('mouseenter', onEnter);
      hitArea.addEventListener('mousemove', (e) => {
        if (!self.tooltip.classList.contains('hidden')) {
          const cr = self.container.getBoundingClientRect();
          self.tooltip.style.left = (e.clientX - cr.left + 14) + 'px';
          self.tooltip.style.top = (e.clientY - cr.top - 36) + 'px';
        }
      });
      hitArea.addEventListener('mouseleave', onLeave);
    }

    // ── NODES ──
    for (let ni = 0; ni < this.nodes.length; ni++) {
      const node = this.nodes[ni];
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${node.x},${node.y})`);
      g.classList.add('mm-node');
      g.style.cursor = 'pointer';
      g.style.opacity = '0';
      g.style.transition = `opacity 0.35s ease ${Math.min(ni * 15, 400)}ms`;

      const isExpanded = this.expandedNodes.has(node.id);
      const w = node.width || (node.tier === 0 ? 210 : node.tier === 1 ? 180 : 165);
      const h = node.height || (node.tier === 0 ? 58 : node.tier === 1 ? 48 : 42);
      const rx = node.tier === 0 ? 14 : node.tier === 1 ? 12 : 10;

      // Gradient fill ID
      const gradId = node.gradientId || 'grad-default';

      // Main rect with shadow filter + colored shell
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', -w / 2);
      rect.setAttribute('y', -h / 2);
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      rect.setAttribute('rx', rx);
      rect.setAttribute('fill', `url(#${gradId})`);
      const defaultStrokeW = node.accentColor ? 1.5 : 1;
      // defaultStroke computed once at top of _render()
      rect.setAttribute('stroke', isExpanded ? 'var(--primary)' : (node.stroke || defaultStroke));
      rect.setAttribute('stroke-width', isExpanded ? 2.5 : defaultStrokeW);
      rect.setAttribute('filter', 'url(#mm-shadow)');
      g.appendChild(rect);

      // Top highlight (glass reflection) — subtler in dark mode
      const highlight = document.createElementNS(NS, 'rect');
      highlight.setAttribute('x', -w / 2 + 1);
      highlight.setAttribute('y', -h / 2 + 1);
      highlight.setAttribute('width', w - 2);
      highlight.setAttribute('height', h * 0.4);
      highlight.setAttribute('rx', rx - 1);
      highlight.setAttribute('fill', 'white');
      highlight.setAttribute('opacity', isDarkMode ? '0.06' : '0.18');
      highlight.setAttribute('pointer-events', 'none');
      g.appendChild(highlight);

      // Accent bar for all nodes with accentColor
      if (node.accentColor) {
        const accent = document.createElementNS(NS, 'rect');
        accent.setAttribute('x', -w / 2);
        accent.setAttribute('y', -h / 2 + (node.tier === 2 ? 3 : 4));
        accent.setAttribute('width', node.tier === 2 ? 2.5 : 3);
        accent.setAttribute('height', h - (node.tier === 2 ? 6 : 8));
        accent.setAttribute('rx', '1.5');
        accent.setAttribute('fill', node.accentColor);
        g.appendChild(accent);
      }

      // Icon
      if (node.icon) {
        const iconTxt = document.createElementNS(NS, 'text');
        iconTxt.setAttribute('x', -w / 2 + (node.tier === 0 ? 16 : 13));
        iconTxt.setAttribute('y', 5);
        iconTxt.setAttribute('font-size', node.tier === 0 ? '16' : '13');
        iconTxt.setAttribute('text-anchor', 'middle');
        iconTxt.setAttribute('pointer-events', 'none');
        iconTxt.textContent = node.icon;
        g.appendChild(iconTxt);
      }

      // Label
      const label = document.createElementNS(NS, 'text');
      const labelX = node.icon ? -w / 2 + (node.tier === 0 ? 30 : 24) : 0;
      label.setAttribute('x', labelX);
      label.setAttribute('y', node.sublabel ? -3 : 4);
      label.setAttribute('text-anchor', node.icon ? 'start' : 'middle');
      label.setAttribute('fill', node.textColor || 'var(--text)');
      label.setAttribute('font-size', node.tier === 0 ? '12.5' : node.tier === 1 ? '11.5' : '10.5');
      label.setAttribute('font-weight', node.tier === 0 ? '700' : node.tier === 1 ? '600' : '500');
      label.setAttribute('font-family', "'Inter', var(--font)");
      label.setAttribute('letter-spacing', '-0.2');
      label.setAttribute('pointer-events', 'none');
      const maxChars = Math.floor((w - (node.icon ? 40 : 16)) / (node.tier === 0 ? 7 : 6.2));
      label.textContent = node.label.length > maxChars ? node.label.slice(0, maxChars - 1) + '\u2026' : node.label;
      g.appendChild(label);

      // Sublabel
      if (node.sublabel) {
        const sub = document.createElementNS(NS, 'text');
        sub.setAttribute('x', labelX);
        sub.setAttribute('y', 12);
        sub.setAttribute('text-anchor', node.icon ? 'start' : 'middle');
        sub.setAttribute('fill', 'var(--text-3)');
        sub.setAttribute('font-size', '9');
        sub.setAttribute('font-weight', '500');
        sub.setAttribute('font-family', "'Inter', var(--font)");
        sub.setAttribute('letter-spacing', '0.3');
        sub.setAttribute('text-transform', 'uppercase');
        sub.setAttribute('pointer-events', 'none');
        const subMax = Math.floor(w / 5.5);
        sub.textContent = node.sublabel.length > subMax ? node.sublabel.slice(0, subMax - 1) + '\u2026' : node.sublabel;
        g.appendChild(sub);
      }

      // Expand indicator — info icon dot, visible and clickable
      if (node.detail || node.detailHtml || node.children?.length) {
        const indX = w / 2 - 16;
        const indCircle = document.createElementNS(NS, 'circle');
        indCircle.setAttribute('cx', indX);
        indCircle.setAttribute('cy', 0);
        indCircle.setAttribute('r', 10);
        indCircle.setAttribute('fill', isExpanded ? 'var(--primary)' : 'rgba(128,128,128,0.12)');
        indCircle.setAttribute('stroke', isExpanded ? 'var(--primary)' : 'rgba(128,128,128,0.3)');
        indCircle.setAttribute('stroke-width', '1');
        indCircle.style.cursor = 'pointer';
        indCircle.style.transition = 'fill 0.2s, stroke 0.2s';
        g.appendChild(indCircle);
        const indIcon = document.createElementNS(NS, 'text');
        indIcon.setAttribute('x', indX);
        indIcon.setAttribute('y', 4.5);
        indIcon.setAttribute('text-anchor', 'middle');
        indIcon.setAttribute('font-size', '12');
        indIcon.setAttribute('font-weight', '700');
        indIcon.setAttribute('fill', isExpanded ? '#fff' : 'var(--text-3)');
        indIcon.setAttribute('pointer-events', 'none');
        indIcon.setAttribute('font-family', "'Inter', var(--font)");
        indIcon.textContent = isExpanded ? '\u2212' : 'i';
        g.appendChild(indIcon);
      }

      // Click
      g.addEventListener('click', (e) => { e.stopPropagation(); this._onNodeClick(node); });

      // Hover — show full text tooltip + visual feedback
      g.addEventListener('mouseenter', (e) => {
        rect.setAttribute('filter', 'url(#mm-shadow-hover)');
        rect.setAttribute('stroke', node.accentColor || 'var(--primary)');
        rect.setAttribute('stroke-width', '1.5');
        g.setAttribute('transform', `translate(${node.x},${node.y}) scale(1.03)`);
        // Show full-text tooltip if label was truncated
        const fullLabel = node.label + (node.sublabel ? '\n' + node.sublabel : '');
        const maxCharsCheck = Math.floor((w - (node.icon ? 40 : 16)) / (node.tier === 0 ? 7 : 6.2));
        if (node.label.length > maxCharsCheck || (node.sublabel && node.sublabel.length > Math.floor(w / 5.5))) {
          self.tooltip.textContent = fullLabel;
          self.tooltip.classList.remove('hidden');
          const cr = self.container.getBoundingClientRect();
          self.tooltip.style.left = (e.clientX - cr.left + 14) + 'px';
          self.tooltip.style.top = (e.clientY - cr.top - 36) + 'px';
          self.tooltip.style.whiteSpace = 'pre-line';
          self.tooltip.style.maxWidth = '280px';
        }
      });
      g.addEventListener('mousemove', (e) => {
        if (!self.tooltip.classList.contains('hidden')) {
          const cr = self.container.getBoundingClientRect();
          self.tooltip.style.left = (e.clientX - cr.left + 14) + 'px';
          self.tooltip.style.top = (e.clientY - cr.top - 36) + 'px';
        }
      });
      g.addEventListener('mouseleave', () => {
        if (!this.expandedNodes.has(node.id)) {
          rect.setAttribute('filter', 'url(#mm-shadow)');
          rect.setAttribute('stroke', node.stroke || defaultStroke);
          rect.setAttribute('stroke-width', node.accentColor ? '1.5' : '1');
        }
        g.setAttribute('transform', `translate(${node.x},${node.y})`);
        self.tooltip.classList.add('hidden');
      });

      this.nodeGroup.appendChild(g);

      // Staggered entrance
      requestAnimationFrame(() => { g.style.opacity = '1'; });
    }
  }

  // ── Click dispatch by mode ──
  _onNodeClick(node) {
    if (this.mode === 'context') this._contextFocus(node);
    else if (this.mode === 'legal') this._legalDrill(node);
    else if (this.mode === 'industry') this._industryDrill(node);
    else this._defaultNodeClick(node);
  }

  _defaultNodeClick(node) {
    if (this.expandedNodes.has(node.id)) {
      this.expandedNodes.delete(node.id);
      this.detailPanel.classList.add('hidden');
      this.selectedNode = null;
    } else {
      this.expandedNodes.clear();
      this.expandedNodes.add(node.id);
      this.selectedNode = node;
      this._showDetail(node);
    }
    this._updateNodeStates();
    if (this.onNodeClick) this.onNodeClick(node);
  }

  // ── Background click dispatch ──
  _onBackgroundClick() {
    if (this.mode === 'context') { this._clearFocus(); this._fitToView(); }
    else if (this.mode === 'legal') { this._legalDrillBack(); }
    else if (this.mode === 'industry') { this._industryReset(); }
    else { this._clearFocus(); }
  }

  // ── Focus/dim infrastructure (DOM-only, no SVG rebuild) ──
  _applyFocus(focusedId, connectedIds) {
    this.focusedNodeId = focusedId;
    this.focusedSet = connectedIds instanceof Set ? connectedIds : new Set(connectedIds);
    this.focusedSet.add(focusedId);

    const nodeEls = this.nodeGroup.querySelectorAll('.mm-node');
    nodeEls.forEach((g, i) => {
      if (i >= this.nodes.length) return;
      const node = this.nodes[i];
      const isFocused = this.focusedSet.has(node.id);
      const isHidden = this.hiddenNodes.has(node.id);
      g.style.opacity = isHidden ? '0' : (isFocused ? '1' : '0.12');
      g.style.pointerEvents = (isHidden || !isFocused) ? 'none' : 'auto';
    });

    const edgeEls = this.edgeGroup.children;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const edge = this.edges[ei];
      const isRelevant = this.focusedSet.has(edge.from) && this.focusedSet.has(edge.to);
      const hitEl = edgeEls[ei * 2];
      const visEl = edgeEls[ei * 2 + 1];
      if (hitEl) hitEl.style.pointerEvents = isRelevant ? 'auto' : 'none';
      if (visEl) visEl.style.opacity = isRelevant ? '0.8' : '0.06';
    }
  }

  _clearFocus() {
    this.focusedNodeId = null;
    this.focusedSet.clear();
    this._clearEdgePulse();

    const nodeEls = this.nodeGroup.querySelectorAll('.mm-node');
    nodeEls.forEach((g, i) => {
      if (i >= this.nodes.length) return;
      const isHidden = this.hiddenNodes.has(this.nodes[i].id);
      g.style.opacity = isHidden ? '0' : '1';
      g.style.pointerEvents = isHidden ? 'none' : 'auto';
    });

    const edgeEls = this.edgeGroup.children;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const edge = this.edges[ei];
      const edgeHidden = this.hiddenNodes.has(edge.from) || this.hiddenNodes.has(edge.to);
      const hitEl = edgeEls[ei * 2];
      const visEl = edgeEls[ei * 2 + 1];
      if (hitEl) hitEl.style.pointerEvents = edgeHidden ? 'none' : 'auto';
      if (visEl) visEl.style.opacity = edgeHidden ? '0' : '';
    }

    this.detailPanel.classList.add('hidden');
    this.expandedNodes.clear();
    this.selectedNode = null;
  }

  // ── Progressive disclosure (hide/show node subsets) ──
  _hideNodes(nodeIds) {
    nodeIds.forEach(id => this.hiddenNodes.add(id));
    this._applyVisibility();
  }

  _showNodes(nodeIds) {
    nodeIds.forEach(id => this.hiddenNodes.delete(id));
    this._applyVisibility();
  }

  _applyVisibility() {
    const nodeEls = this.nodeGroup.querySelectorAll('.mm-node');
    nodeEls.forEach((g, i) => {
      if (i >= this.nodes.length) return;
      const isHidden = this.hiddenNodes.has(this.nodes[i].id);
      g.style.opacity = isHidden ? '0' : '1';
      g.style.pointerEvents = isHidden ? 'none' : 'auto';
    });

    const edgeEls = this.edgeGroup.children;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const edge = this.edges[ei];
      const edgeHidden = this.hiddenNodes.has(edge.from) || this.hiddenNodes.has(edge.to);
      const hitEl = edgeEls[ei * 2];
      const visEl = edgeEls[ei * 2 + 1];
      if (hitEl) hitEl.style.pointerEvents = edgeHidden ? 'none' : 'auto';
      if (visEl) visEl.style.opacity = edgeHidden ? '0' : '';
    }
  }

  _fitToVisibleNodes(nodeIdSet) {
    const visible = this.nodes.filter(n => {
      if (nodeIdSet) return nodeIdSet.has ? nodeIdSet.has(n.id) : nodeIdSet.includes(n.id);
      return !this.hiddenNodes.has(n.id);
    });
    if (!visible.length) return this._fitToView();
    const xs = visible.map(n => n.x);
    const ys = visible.map(n => n.y);
    const pad = 120;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const bw = maxX - minX, bh = maxY - minY;
    const cw = this.container.clientWidth || 900;
    const ch = this.container.clientHeight || 600;
    const targetScale = Math.min(cw / bw, ch / bh, 1.5);
    const targetPanX = (cw - bw * targetScale) / 2 - minX * targetScale;
    const targetPanY = (ch - bh * targetScale) / 2 - minY * targetScale;
    this._animateTransform(targetScale, targetPanX, targetPanY);
  }

  // ── Smooth animated zoom transition (Mandelbrot-style) ──
  _animateTransform(targetScale, targetPanX, targetPanY, duration = 500) {
    if (this._animRAF) cancelAnimationFrame(this._animRAF);
    const startScale = this.scale;
    const startPanX = this.panX;
    const startPanY = this.panY;
    const startTime = performance.now();

    const easeOutExpo = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const e = easeOutExpo(t);

      this.scale = startScale + (targetScale - startScale) * e;
      this.panX = startPanX + (targetPanX - startPanX) * e;
      this.panY = startPanY + (targetPanY - startPanY) * e;
      this._applyTransform();

      if (t < 1) {
        this._animRAF = requestAnimationFrame(animate);
      } else {
        this._animRAF = null;
      }
    };

    this._animRAF = requestAnimationFrame(animate);
  }

  // ── Quantum ripple effect on focused node ──
  _emitRipple(node) {
    const NS = 'http://www.w3.org/2000/svg';
    const color = node.accentColor || node.stroke || 'var(--primary)';

    for (let i = 0; i < 3; i++) {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', node.x);
      circle.setAttribute('cy', node.y);
      circle.setAttribute('r', '20');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('opacity', '0.6');
      circle.style.pointerEvents = 'none';

      // Animate with CSS
      circle.style.transition = 'none';
      this.transformGroup.appendChild(circle);

      const delay = i * 120;
      setTimeout(() => {
        circle.style.transition = `r 0.8s cubic-bezier(0.16, 1, 0.3, 1),
                                    opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1),
                                    stroke-width 0.8s ease-out`;
        // SVG doesn't support CSS transitions on 'r' — use SMIL animation
        const animR = document.createElementNS(NS, 'animate');
        animR.setAttribute('attributeName', 'r');
        animR.setAttribute('from', '20');
        animR.setAttribute('to', '120');
        animR.setAttribute('dur', '0.7s');
        animR.setAttribute('begin', 'indefinite');
        animR.setAttribute('fill', 'freeze');
        circle.appendChild(animR);

        const animOp = document.createElementNS(NS, 'animate');
        animOp.setAttribute('attributeName', 'opacity');
        animOp.setAttribute('from', '0.5');
        animOp.setAttribute('to', '0');
        animOp.setAttribute('dur', '0.7s');
        animOp.setAttribute('begin', 'indefinite');
        animOp.setAttribute('fill', 'freeze');
        circle.appendChild(animOp);

        const animSW = document.createElementNS(NS, 'animate');
        animSW.setAttribute('attributeName', 'stroke-width');
        animSW.setAttribute('from', '2');
        animSW.setAttribute('to', '0.5');
        animSW.setAttribute('dur', '0.7s');
        animSW.setAttribute('begin', 'indefinite');
        animSW.setAttribute('fill', 'freeze');
        circle.appendChild(animSW);

        animR.beginElement();
        animOp.beginElement();
        animSW.beginElement();

        setTimeout(() => circle.remove(), 800);
      }, delay);
    }
  }

  // ── Energy pulse on active edges ──
  _pulseEdges(nodeId, connectedIds) {
    const activeSet = new Set(connectedIds);
    activeSet.add(nodeId);

    const edgeEls = this.edgeGroup.children;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const edge = this.edges[ei];
      const isActive = activeSet.has(edge.from) && activeSet.has(edge.to);
      const visEl = edgeEls[ei * 2 + 1];
      if (visEl && isActive) {
        // Animate dash offset for energy flow effect
        visEl.setAttribute('stroke-dasharray', '8,6');
        visEl.setAttribute('stroke-opacity', '0.9');
        visEl.style.animation = 'mm-edge-flow 1.2s linear infinite';
      }
    }
  }

  _clearEdgePulse() {
    const edgeEls = this.edgeGroup.children;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const edge = this.edges[ei];
      const visEl = edgeEls[ei * 2 + 1];
      if (visEl) {
        visEl.style.animation = '';
        if (edge.dashed) visEl.setAttribute('stroke-dasharray', '5,5');
        else visEl.removeAttribute('stroke-dasharray');
        visEl.setAttribute('stroke-opacity', '0.45');
      }
    }
  }

  // ── Context Map: click to isolate neighborhood ──
  _contextFocus(node) {
    const connectedIds = new Set();
    this.edges.forEach(edge => {
      if (edge.from === node.id) connectedIds.add(edge.to);
      if (edge.to === node.id) connectedIds.add(edge.from);
    });

    this._emitRipple(node);
    this._applyFocus(node.id, connectedIds);
    this._pulseEdges(node.id, connectedIds);
    this.expandedNodes.clear();
    this.expandedNodes.add(node.id);
    this.selectedNode = node;
    this._showDetail(node);
    this._updateNodeStates();

    const neighborhood = new Set(connectedIds);
    neighborhood.add(node.id);
    this._fitToVisibleNodes(neighborhood);
    if (this.onNodeClick) this.onNodeClick(node);
  }

  // ── Legal Theory: progressive drill-down ──
  _legalDrill(node) {
    if (node.tier === 0 && node.id !== 'root') {
      // Click COA → reveal its branches
      this._emitRipple(node);
      this.drillLevel = 1;
      this.drillParentId = node.id;
      const childBranches = this.nodes.filter(n => n.tier === 1 && n.id.startsWith(node.id + '-')).map(n => n.id);
      this._showNodes(childBranches);
      const visibleSet = new Set(['root', node.id, ...childBranches]);
      this._applyFocus(node.id, visibleSet);
      this._pulseEdges(node.id, new Set(childBranches));
      this.expandedNodes.clear();
      this.expandedNodes.add(node.id);
      this.selectedNode = node;
      this._showDetail(node);
      this._fitToVisibleNodes(visibleSet);
    } else if (node.tier === 1) {
      // Click branch → reveal its leaves
      this._emitRipple(node);
      this.drillLevel = 2;
      const coaId = node.id.split('-').slice(0, 2).join('-');
      this.drillParentId = node.id;
      const childLeaves = this.nodes.filter(n => n.tier === 2 && n.id.startsWith(node.id + '-')).map(n => n.id);
      this._showNodes(childLeaves);
      const visibleSet = new Set(['root', coaId, node.id, ...childLeaves]);
      this._applyFocus(node.id, visibleSet);
      this._pulseEdges(node.id, new Set(childLeaves));
      this.expandedNodes.clear();
      this.expandedNodes.add(node.id);
      this.selectedNode = node;
      this._showDetail(node);
      this._fitToVisibleNodes(visibleSet);
    } else if (node.tier === 2) {
      this._defaultNodeClick(node);
    } else if (node.id === 'root') {
      this._defaultNodeClick(node);
    }
    if (this.onNodeClick) this.onNodeClick(node);
  }

  _legalDrillBack() {
    this.detailPanel.classList.add('hidden');
    this.expandedNodes.clear();
    this.selectedNode = null;

    if (this.drillLevel === 2) {
      const leafIds = this.nodes.filter(n => n.tier === 2).map(n => n.id);
      this._hideNodes(leafIds);
      const coaId = this.drillParentId.split('-').slice(0, 2).join('-');
      const branchIds = this.nodes.filter(n => n.tier === 1 && n.id.startsWith(coaId + '-')).map(n => n.id);
      const visibleSet = new Set(['root', coaId, ...branchIds]);
      this._applyFocus(coaId, visibleSet);
      this.drillLevel = 1;
      this.drillParentId = coaId;
      this._fitToVisibleNodes(visibleSet);
    } else if (this.drillLevel === 1) {
      const nonRootIds = this.nodes.filter(n => n.tier === 1 || n.tier === 2).map(n => n.id);
      this._hideNodes(nonRootIds);
      this._clearFocus();
      this.drillLevel = 0;
      this.drillParentId = null;
      this._fitToVisibleNodes(null);
    } else {
      this._clearFocus();
      this._fitToView();
    }
  }

  // ── Industry Map: step-level drill ──
  _industryDrill(node) {
    if (node.tier === 0 && node.id.startsWith('step-')) {
      this._emitRipple(node);
      const termIds = this.nodes.filter(n => n.tier === 2 && n.id.startsWith(node.id + '-term-')).map(n => n.id);
      this._showNodes(termIds);
      const focusedSet = new Set([node.id, 'domain-root', ...termIds]);
      this._applyFocus(node.id, focusedSet);
      this._pulseEdges(node.id, new Set(termIds));
      this.expandedNodes.clear();
      this.expandedNodes.add(node.id);
      this.selectedNode = node;
      this._showDetail(node);
      this._fitToVisibleNodes(focusedSet);
    } else if (node.tier === 2) {
      this._defaultNodeClick(node);
    } else if (node.id === 'domain-root') {
      this._defaultNodeClick(node);
    }
    if (this.onNodeClick) this.onNodeClick(node);
  }

  _industryReset() {
    const termIds = this.nodes.filter(n => n.tier === 2).map(n => n.id);
    this._hideNodes(termIds);
    this._clearFocus();
    this._fitToVisibleNodes(null);
  }

  _updateNodeStates() {
    const darkFallback = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#3a4050' : '#D1D5DB';
    const nodeEls = this.nodeGroup.querySelectorAll('.mm-node');
    nodeEls.forEach((g, i) => {
      if (i >= this.nodes.length) return;
      const node = this.nodes[i];
      const isExpanded = this.expandedNodes.has(node.id);
      const rect = g.querySelector('rect');
      if (rect) {
        rect.setAttribute('stroke', isExpanded ? 'var(--primary)' : (node.stroke || darkFallback));
        rect.setAttribute('stroke-width', isExpanded ? 2.5 : (node.accentColor ? 1.5 : 1));
      }
      // Update info indicator
      const indCircle = g.querySelector('circle:last-of-type');
      const indText = g.querySelector('text:last-of-type');
      if (indCircle && indText && indText.textContent.match(/[i\u2212]/)) {
        indCircle.setAttribute('fill', isExpanded ? 'var(--primary)' : 'rgba(128,128,128,0.12)');
        indCircle.setAttribute('stroke', isExpanded ? 'var(--primary)' : 'rgba(128,128,128,0.3)');
        indText.setAttribute('fill', isExpanded ? '#fff' : 'var(--text-3)');
        indText.textContent = isExpanded ? '\u2212' : 'i';
      }
    });
  }

  _showDetail(node) {
    if (!node.detail && !node.detailHtml) {
      this.detailPanel.classList.add('hidden');
      return;
    }
    this.detailPanel.classList.remove('hidden');
    this.detailPanel.innerHTML = `
      <div class="mm-detail-header">
        ${node.icon ? `<span class="mm-detail-icon">${node.icon}</span>` : ''}
        <span class="mm-detail-title">${esc(node.label)}</span>
        <button class="mm-detail-close">&times;</button>
      </div>
      <div class="mm-detail-body">${node.detailHtml || esc(node.detail)}</div>
    `;
    this.detailPanel.querySelector('.mm-detail-close').addEventListener('click', () => {
      this.detailPanel.classList.add('hidden');
      this.expandedNodes.clear();
      this.selectedNode = null;
      this._updateNodeStates();
      if (this.focusedNodeId) this._onBackgroundClick();
    });
  }
}

// ===== LAYOUT: force-push to resolve overlaps =====
function resolveOverlaps(nodes, padX = 20, padY = 14, iterations = 60) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const aw = (a.width || 160) / 2 + padX;
        const ah = (a.height || 40) / 2 + padY;
        const bw = (b.width || 160) / 2 + padX;
        const bh = (b.height || 40) / 2 + padY;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = (aw + bw) - Math.abs(dx);
        const overlapY = (ah + bh) - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          // Push apart along axis of least overlap
          if (overlapX < overlapY) {
            const push = overlapX / 2 + 2;
            const sign = dx >= 0 ? 1 : -1;
            a.x -= sign * push;
            b.x += sign * push;
          } else {
            const push = overlapY / 2 + 2;
            const sign = dy >= 0 ? 1 : -1;
            a.y -= sign * push;
            b.y += sign * push;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// ===== TAB 2: CONTEXT (Interactive Mind Map) =====
function renderContext(nodes) {
  const c = $('#context-map');
  if (!nodes.length) { c.innerHTML = '<p class="tab-empty">No context nodes generated.</p>'; return; }

  const typeColors = {
    date: { gradientId: 'grad-date', stroke: '#6B8ACA', accent: '#5B7BBD', icon: '\uD83D\uDCC5' },
    location: { gradientId: 'grad-location', stroke: '#5BA07A', accent: '#4A9068', icon: '\uD83D\uDCCD' },
    person: { gradientId: 'grad-person', stroke: '#C4944A', accent: '#B5853D', icon: '\uD83D\uDC64' },
    document: { gradientId: 'grad-document', stroke: '#8893A3', accent: '#788394', icon: '\uD83D\uDCC4' },
    amount: { gradientId: 'grad-amount', stroke: '#C46B5E', accent: '#B55C50', icon: '\uD83D\uDCB0' },
    event: { gradientId: 'grad-event', stroke: '#8B6BBF', accent: '#7C5CB0', icon: '\u26A1' },
  };

  const mmNodes = [];
  const mmEdges = [];

  // Group by type, lay out in concentric rings
  const typeGroups = {};
  nodes.forEach(n => {
    const t = n.type || 'event';
    if (!typeGroups[t]) typeGroups[t] = [];
    typeGroups[t].push(n);
  });
  const types = Object.keys(typeGroups);

  // Scale radius based on node count
  const totalNodes = nodes.length;
  const baseRadius = Math.max(220, totalNodes * 18);
  const cx = 500, cy = 500;

  // Place each type in its own angular sector
  const sectorSize = (2 * Math.PI) / Math.max(types.length, 1);

  types.forEach((type, ti) => {
    const group = typeGroups[type];
    const sectorStart = ti * sectorSize - Math.PI / 2;
    const colors = typeColors[type] || typeColors.event;

    group.forEach((n, ni) => {
      // Distribute within sector: stagger radius for multi-item groups
      const ring = Math.floor(ni / 3); // 3 per ring
      const posInRing = ni % 3;
      const ringCount = Math.min(3, group.length - ring * 3);
      const angleSpread = sectorSize * 0.7;
      const angle = sectorStart + sectorSize * 0.15 + (ringCount > 1
        ? (posInRing / (ringCount - 1)) * angleSpread
        : angleSpread / 2);
      const r = baseRadius + ring * 90;

      mmNodes.push({
        id: n.id,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        label: n.label,
        sublabel: n.type,
        icon: colors.icon,
        gradientId: colors.gradientId,
        stroke: colors.stroke,
        accentColor: colors.accent,
        tier: 1,
        width: 190,
        height: 48,
        detail: n.detail,
        detailHtml: `
          <div class="mm-detail-section">
            <div class="mm-detail-label">Detail</div>
            <div>${esc(n.detail)}</div>
          </div>
          <div class="mm-detail-section">
            <div class="mm-detail-label">Significance</div>
            <div>${esc(n.significance)}</div>
          </div>
          ${n.connections?.length ? `<div class="mm-detail-section">
            <div class="mm-detail-label">Connected To</div>
            <div>${n.connections.map(conn => {
              const cid = typeof conn === 'string' ? conn : conn.target_id;
              const clabel = typeof conn === 'object' ? conn.label : '';
              const t = nodes.find(nn => nn.id === cid);
              return `<span class="mm-detail-tag">${t ? esc(t.label) : cid}${clabel ? ` <em>(${esc(clabel)})</em>` : ''}</span>`;
            }).join(' ')}</div>
          </div>` : ''}
        `
      });
    });
  });

  // Resolve any remaining overlaps
  resolveOverlaps(mmNodes, 24, 16);

  // Build edges (supports both old string[] and new {target_id, label}[] formats)
  nodes.forEach(n => {
    (n.connections || []).forEach(conn => {
      const targetId = typeof conn === 'string' ? conn : conn.target_id;
      const label = typeof conn === 'object' ? conn.label : null;
      if (nodes.find(nn => nn.id === targetId)) {
        mmEdges.push({
          from: n.id,
          to: targetId,
          color: (typeColors[n.type] || typeColors.event).stroke,
          width: 1.5,
          label: label || null,
          noArrow: true
        });
      }
    });
  });

  const mm = getOrCreateRenderer('context', c);
  mm.mode = 'context';
  mm.setData(mmNodes, mmEdges);
}

// ===== TAB 3: LEGAL THEORY (Radial Starfish Layout) =====
function renderLegalTheory(theory) {
  const c = $('#legal-theory-map');
  const coas = theory.causes_of_action || [];
  if (!coas.length) { c.innerHTML = '<p class="tab-empty">No legal theories identified.</p>'; return; }

  const mmNodes = [];
  const mmEdges = [];
  const rootId = 'root';

  const branchDefs = [
    { key: 'elements', label: 'Elements', icon: '\uD83E\uDDE9', color: '#3b82f6', gradientId: 'grad-elements' },
    { key: 'evidence', label: 'Evidence', icon: '\uD83D\uDD0D', color: '#22c55e', gradientId: 'grad-evidence' },
    { key: 'questions', label: 'Questions', icon: '\u2753', color: '#8b5cf6', gradientId: 'grad-questions' },
    { key: 'answers', label: 'Answers', icon: '\uD83D\uDCAC', color: '#ec4899', gradientId: 'grad-answers' },
  ];

  // Radial layout — root at center, COAs spread around, branches extend outward
  const cx = 800, cy = 700;
  const COA_RADIUS = Math.max(250, coas.length * 80);
  const BRANCH_RADIUS = 180;
  const LEAF_SPACING = 52;
  const LEAF_W = 190;
  const LEAF_NODE_H = 40;

  // Root at center
  mmNodes.push({
    id: rootId, x: cx, y: cy,
    label: 'Legal Theory',
    icon: '\u2696\uFE0F',
    gradientId: 'grad-primary', stroke: '#6B8ACA', accentColor: 'var(--primary)',
    tier: 0, width: 220, height: 58, textColor: 'var(--primary-dark)'
  });

  // Spread COAs radially around root
  const coaAngleStep = (2 * Math.PI) / Math.max(coas.length, 1);

  coas.forEach((ca, ci) => {
    const coaId = `coa-${ci}`;
    const coaAngle = ci * coaAngleStep - Math.PI / 2; // start from top
    const coaX = cx + Math.cos(coaAngle) * COA_RADIUS;
    const coaY_pos = cy + Math.sin(coaAngle) * COA_RADIUS;

    mmNodes.push({
      id: coaId, x: coaX, y: coaY_pos,
      label: ca.name, icon: '\uD83D\uDCCB',
      gradientId: 'grad-coa', stroke: '#C4944A', accentColor: '#B5853D',
      tier: 0, width: Math.min(280, Math.max(200, ca.name.length * 7 + 50)), height: 54,
      detailHtml: `
        <div class="mm-detail-section"><div class="mm-detail-label">Plaintiff Strategy</div><div>${esc(ca.plaintiff_angle || '')}</div></div>
        <div class="mm-detail-section"><div class="mm-detail-label">Defense Strategy</div><div>${esc(ca.defendant_angle || '')}</div></div>
      `
    });
    mmEdges.push({ from: rootId, to: coaId, color: '#6B8ACA', width: 2.5 });

    // Get active branches for this COA
    const branches = branchDefs.map(b => {
      const keyMap = { evidence: 'evidence_needed', questions: 'likely_questions', answers: 'likely_answers' };
      const items = ca[keyMap[b.key] || b.key] || [];
      return { ...b, items };
    }).filter(b => b.items.length > 0);

    // Spread branches as tentacles radiating outward from COA
    const branchSpread = Math.min(Math.PI * 0.6, branches.length * 0.35);
    const branchBaseAngle = coaAngle; // extend outward from root

    branches.forEach((branch, bi) => {
      const branchId = `${coaId}-${branch.key}`;
      // Fan branches around the COA's outward direction
      const branchAngle = branchBaseAngle - branchSpread / 2 + (branches.length > 1
        ? (bi / (branches.length - 1)) * branchSpread
        : 0);
      const bx = coaX + Math.cos(branchAngle) * BRANCH_RADIUS;
      const by = coaY_pos + Math.sin(branchAngle) * BRANCH_RADIUS;

      mmNodes.push({
        id: branchId, x: bx, y: by,
        label: `${branch.label} (${branch.items.length})`,
        icon: branch.icon,
        gradientId: branch.gradientId, stroke: branch.color, accentColor: branch.color,
        tier: 1, width: 175, height: 46,
        detailHtml: `<div class="mm-detail-section">
          <div class="mm-detail-label">${esc(branch.label)}</div>
          <ul class="mm-detail-list">${branch.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
        </div>`
      });
      mmEdges.push({ from: coaId, to: branchId, color: branch.color, width: 1.8 });

      // Leaf nodes — extend further outward along the tentacle direction
      branch.items.forEach((item, ii) => {
        const leafId = `${branchId}-${ii}`;
        const leafDist = 80 + ii * LEAF_SPACING;
        const lx = bx + Math.cos(branchAngle) * leafDist;
        const ly = by + Math.sin(branchAngle) * leafDist;

        mmNodes.push({
          id: leafId, x: lx, y: ly,
          label: item,
          gradientId: branch.gradientId, stroke: branch.color, accentColor: branch.color,
          tier: 2, width: LEAF_W, height: LEAF_NODE_H,
          detail: item
        });
        mmEdges.push({ from: ii === 0 ? branchId : `${branchId}-${ii - 1}`, to: leafId, color: branch.color, width: 1, dashed: true });
      });
    });
  });

  // Resolve overlaps
  resolveOverlaps(mmNodes, 20, 14);

  const mm = getOrCreateRenderer('legal', c);
  mm.mode = 'legal';
  mm.drillLevel = 0;
  mm.drillParentId = null;
  mm.setData(mmNodes, mmEdges);

  // Progressive disclosure: initially hide branches (tier 1) and leaves (tier 2)
  const hiddenIds = mmNodes.filter(n => n.tier === 1 || n.tier === 2).map(n => n.id);
  setTimeout(() => {
    mm._hideNodes(hiddenIds);
    mm._fitToVisibleNodes(null);
  }, 250);
}

// ===== TAB 4: INDUSTRY (Interactive Flowchart) =====
function renderIndustry(knowledge) {
  const ov = $('#industry-overview');
  const fl = $('#industry-flow');
  if (!knowledge.domain) { ov.innerHTML=''; fl.innerHTML='<p class="tab-empty">No industry knowledge generated.</p>'; return; }
  const pd = state.currentProfile?.p_distance || 3;
  ov.innerHTML = `<h3>${esc(knowledge.domain)} <span class="pdist-badge pdist-${pd}">P-Distance: ${pd}/5</span></h3>
    ${knowledge.overview ? `<p>${esc(knowledge.overview)}</p>` : ''}`;

  const steps = knowledge.process_steps || [];
  if (!steps.length) { fl.innerHTML = '<p class="tab-empty">No process steps identified.</p>'; return; }

  const mmNodes = [];
  const mmEdges = [];

  const STEP_X = 280;        // x position of step column
  const TERM_START_X = 560;   // where terms start
  const TERM_COL_W = 200;     // wider term columns
  const TERM_ROW_H = 54;      // more vertical breathing room
  const TERM_W = 185;         // wider term nodes
  const TERM_H = 44;          // taller term nodes
  const stepColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#ef4444', '#84cc16'];
  // Lighter gradient stops per step color for term node backgrounds
  const stepGradientIds = stepColors.map((c, i) => `grad-step-${i}`);

  // Calculate y for each step based on how many terms the previous step had
  let curY = 60;
  const ROOT_Y = curY;

  mmNodes.push({
    id: 'domain-root', x: STEP_X, y: ROOT_Y,
    label: knowledge.domain, icon: '\uD83C\uDFED',
    gradientId: 'grad-primary', stroke: '#6B8ACA', accentColor: 'var(--primary)',
    tier: 0, width: 260, height: 56, textColor: 'var(--primary-dark)'
  });

  curY += 110;

  steps.forEach((s, si) => {
    const stepId = `step-${si}`;
    const color = stepColors[si % stepColors.length];
    const terms = s.key_terms || [];
    const termRows = Math.ceil(terms.length / 2);
    const stepBlockH = Math.max(70, termRows * TERM_ROW_H);

    mmNodes.push({
      id: stepId, x: STEP_X, y: curY,
      label: s.step, sublabel: `Step ${si + 1}`,
      icon: '\u25B6',
      gradientId: 'grad-step', stroke: color, accentColor: color,
      tier: 0, width: 250, height: 56,
      detailHtml: `<div class="mm-detail-section"><div class="mm-detail-label">Description</div><div>${esc(s.description)}</div></div>`
    });

    // Connect
    if (si === 0) {
      mmEdges.push({ from: 'domain-root', to: stepId, color: 'var(--primary)', width: 2.5 });
    } else {
      mmEdges.push({ from: `step-${si - 1}`, to: stepId, color: stepColors[(si - 1) % stepColors.length], width: 2 });
    }

    // Terms in 2-column grid to the right — use step color for shells
    terms.forEach((t, ti) => {
      const col = ti % 2;
      const row = Math.floor(ti / 2);
      const termId = `${stepId}-term-${ti}`;

      mmNodes.push({
        id: termId,
        x: TERM_START_X + col * TERM_COL_W,
        y: curY - (termRows - 1) * TERM_ROW_H / 2 + row * TERM_ROW_H,
        label: t.en,
        sublabel: t.zh_simplified || t.zh_traditional || '',
        gradientId: 'grad-term', stroke: color, accentColor: color,
        tier: 2, width: TERM_W, height: TERM_H,
        detailHtml: `
          <div class="mm-detail-section">
            <div class="mm-detail-label">Terminology</div>
            <div><strong>${esc(t.en)}</strong></div>
            <div style="font-size:16px;margin:4px 0">${esc(t.zh_simplified || '')} / ${esc(t.zh_traditional || '')}</div>
            <div style="font-style:italic;color:var(--text-3)">${esc(t.pinyin || '')}</div>
          </div>
          ${t.context_note ? `<div class="mm-detail-section"><div class="mm-detail-label">Context</div><div>${esc(t.context_note)}</div></div>` : ''}
        `
      });
      mmEdges.push({ from: stepId, to: termId, color, width: 1.2, dashed: true });
    });

    curY += stepBlockH + 60;
  });

  // Resolve overlaps in term area only (don't mess with step column)
  const termNodes = mmNodes.filter(n => n.id.includes('-term-'));
  resolveOverlaps(termNodes, 18, 12);

  const mm = getOrCreateRenderer('industry', fl);
  mm.mode = 'industry';
  mm.setData(mmNodes, mmEdges);

  // Progressive disclosure: initially hide all terms (tier 2)
  const hiddenTerms = mmNodes.filter(n => n.tier === 2).map(n => n.id);
  setTimeout(() => {
    mm._hideNodes(hiddenTerms);
    mm._fitToVisibleNodes(null);
  }, 250);
}

// ===== TAB 5: HAZARDS =====
function highlightTermsInText(text, terms) {
  if (!terms || !terms.length || !text) return esc(text);
  let result = esc(text);
  terms.forEach(term => {
    const escaped = esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    result = result.replace(re, '<mark class="hazard-term-highlight">$1</mark>');
  });
  return result;
}

function renderHazards() {
  const hazards = state.currentAnalysis?.hazard_zones || [];
  const sortBy = $('#hazard-sort')?.value || 'severity';
  const sorted = [...hazards].sort((a, b) =>
    sortBy === 'severity' ? (b.severity||3) - (a.severity||3) : (a.scenario||'').localeCompare(b.scenario||'')
  );
  const c = $('#hazard-cards');
  if (!sorted.length) { c.innerHTML = '<p class="tab-empty">No hazard zones generated.</p>'; return; }

  c.innerHTML = sorted.map(h => {
    const sev = h.severity || 3;
    const terms = h.critical_terms || [];
    return `
    <div class="hazard-card hazard-sev-${sev}">
      <div class="hazard-header">
        <div class="hazard-scenario">${highlightTermsInText(h.scenario, terms)}</div>
        <span class="hazard-severity sev-${sev}">SEV ${sev}</span>
      </div>
      <div class="hazard-why">${highlightTermsInText(h.why_hard, terms)}</div>
      ${h.example_exchange ? `<div class="hazard-exchange">
        <div class="line"><span class="speaker">Attorney:</span> ${highlightTermsInText(h.example_exchange.attorney_asks || '', terms)}</div>
        <div class="line"><span class="speaker">Witness:</span> ${highlightTermsInText(h.example_exchange.witness_answers || '', terms)}</div>
      </div>` : ''}
    </div>`;
  }).join('');
}

// ===== TAB 6: QUIZ =====
// Scoring design: ~60% accuracy, ~25% speed, ~15% streak
// Over 30 perfect questions at max speed:
//   Accuracy: 30*100 = 3000 (61%)
//   Speed:    30*40  = 1200 (24%)
//   Streak:   1.5*(1+2+...+30) = 697 (14%)
//   Total:    ~4897

function streakBonus(streak) {
  // Flat linear growth: each consecutive correct adds streak * 1.5 pts
  if (streak <= 0) return 0;
  return Math.round(streak * 1.5);
}

function speedPoints(ms) {
  // Linear interpolation: 1.7s = 40 pts (max), 6s = 0 pts
  // Faster than 1.7s still caps at 40
  if (ms <= 1700) return 40;
  if (ms >= 6000) return 0;
  return Math.round(40 * (1 - (ms - 1700) / (6000 - 1700)));
}

function speedTier(ms) {
  if (ms <= 1700) return { label: 'LIGHTNING', color: '#8b5cf6' };
  if (ms <= 2500) return { label: 'BLAZING', color: '#f59e0b' };
  if (ms <= 3500) return { label: 'SWIFT', color: '#22c55e' };
  if (ms <= 5000) return { label: 'STEADY', color: '#3b82f6' };
  return { label: 'SLOW', color: '#94a3b8' };
}

function showQuizSetup() {
  $('#quiz-setup').classList.remove('hidden');
  $('#quiz-active').classList.add('hidden');
  $('#quiz-results').classList.add('hidden');
  $('#sight-active').classList.add('hidden');
  loadQuizHistory();
}

async function startMCQ() {
  if (!state.currentCaseId) return;
  $('#quiz-setup').classList.add('hidden');
  $('#quiz-results').classList.add('hidden');
  $('#sight-active').classList.add('hidden');
  $('#quiz-active').classList.remove('hidden');

  try {
    const res = await apiFetch(`/api/quiz/mcq/${state.currentCaseId}`, { method: 'POST' });
    const data = await res.json();
    if (!data.questions || data.questions.length === 0) {
      alert('No quiz questions available.');
      showQuizSetup();
      return;
    }
    QUIZ_TIME_MS = getAdaptiveTimer();
    state.quizState = {
      questions: data.questions,
      current: 0,
      correctCount: 0,
      streak: 0,
      maxStreak: 0,
      totalPoints: 0,
      totalSpeedPts: 0,
      totalStreakPts: 0,
      totalAccPts: 0,
      answers: [],
      timer: null,
      countdownRAF: null,
      questionStartTime: 0,
    };
    showQuestion();
  } catch (e) {
    console.error('Quiz error:', e);
    showQuizSetup();
  }
}

let QUIZ_TIME_MS = 6000;
const CONTEXT_QUIZ_TIME_MS = 60000; // 60 seconds for context quiz

function showQuestion() {
  const qs = state.quizState;
  if (!qs || qs.current >= qs.questions.length) { finishQuiz(); return; }

  const q = qs.questions[qs.current];
  const total = qs.questions.length;

  // HUD
  $('#quiz-progress').textContent = `${qs.current + 1}/${total}`;
  $('#quiz-streak').textContent = qs.streak;
  $('#quiz-points').textContent = qs.totalPoints;
  $('#quiz-accuracy').textContent = qs.current > 0
    ? Math.round((qs.correctCount / qs.current) * 100) + '%' : '-';

  // Streak banner
  const banner = $('#streak-banner');
  if (qs.streak >= 10) {
    banner.className = 'streak-banner visible legendary';
    banner.textContent = `LEGENDARY ${qs.streak}x STREAK! +${streakBonus(qs.streak)} bonus`;
  } else if (qs.streak >= 6) {
    banner.className = 'streak-banner visible blaze';
    banner.textContent = `ON FIRE! ${qs.streak}x streak +${streakBonus(qs.streak)} bonus`;
  } else if (qs.streak >= 3) {
    banner.className = 'streak-banner visible fire';
    banner.textContent = `${qs.streak}x streak! +${streakBonus(qs.streak)} bonus`;
  } else {
    banner.className = 'streak-banner';
  }

  // Direction + question
  $('#quiz-direction').textContent = q.direction;
  $('#quiz-question').textContent = q.question;

  // Options
  const optContainer = $('#quiz-options');
  optContainer.innerHTML = q.options.map((o, i) => `
    <button class="quiz-option" data-idx="${i}">${esc(o)}</button>
  `).join('');
  optContainer.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => answerQuestion(parseInt(btn.dataset.idx)));
  });

  // Start countdown bar (NFS-style)
  qs.questionStartTime = performance.now();
  startCountdownBar();
}

function startCountdownBar() {
  const qs = state.quizState;
  const bar = $('#quiz-countdown-bar');
  const startTime = performance.now();
  const timeLimit = qs.mode === 'context' ? CONTEXT_QUIZ_TIME_MS : QUIZ_TIME_MS;

  // Cancel previous
  if (qs.countdownRAF) cancelAnimationFrame(qs.countdownRAF);
  if (qs.timer) clearTimeout(qs.timer);

  function animate(now) {
    const elapsed = now - startTime;
    const remaining = Math.max(0, 1 - elapsed / timeLimit);
    bar.style.width = (remaining * 100) + '%';

    // Color transitions
    if (remaining > 0.6) bar.className = 'quiz-countdown-bar speed-green';
    else if (remaining > 0.4) bar.className = 'quiz-countdown-bar speed-yellow';
    else if (remaining > 0.2) bar.className = 'quiz-countdown-bar speed-orange';
    else bar.className = 'quiz-countdown-bar speed-red';

    if (remaining > 0) {
      qs.countdownRAF = requestAnimationFrame(animate);
    }
  }

  qs.countdownRAF = requestAnimationFrame(animate);

  // Timeout
  qs.timer = setTimeout(() => {
    cancelAnimationFrame(qs.countdownRAF);
    answerQuestion(-1);
  }, timeLimit);
}

function answerQuestion(idx) {
  const qs = state.quizState;
  if (!qs) return;
  clearTimeout(qs.timer);
  if (qs.countdownRAF) cancelAnimationFrame(qs.countdownRAF);

  const q = qs.questions[qs.current];
  const chosen = idx >= 0 ? q.options[idx] : null;
  const correct = chosen === q.correct;
  const responseTime = performance.now() - qs.questionStartTime;

  // Scoring: accuracy (60%) + speed (25%) + streak (15%)
  let accPts = 0, spdPts = 0, strkPts = 0;

  if (correct) {
    qs.correctCount++;
    qs.streak++;
    if (qs.streak > qs.maxStreak) qs.maxStreak = qs.streak;

    accPts = 100;                        // flat 100 per correct
    spdPts = speedPoints(responseTime);  // 0-40 linear by time
    strkPts = streakBonus(qs.streak);    // streak * 1.5, flat linear
  } else {
    qs.streak = 0;
    // Wrong = 0 across all categories
  }

  const questionTotal = accPts + spdPts + strkPts;
  qs.totalPoints += questionTotal;
  qs.totalAccPts += accPts;
  qs.totalSpeedPts += spdPts;
  qs.totalStreakPts += strkPts;

  qs.answers.push({ question: q, chosen, correct, responseTime, accPts, spdPts, strkPts, total: questionTotal });

  // Visual feedback
  const opts = $$('#quiz-options .quiz-option');
  opts.forEach(btn => {
    const val = btn.textContent;
    if (val === q.correct) {
      btn.classList.add('correct');
      if (correct && spdPts > 0) {
        const tier = speedTier(responseTime);
        const bonus = document.createElement('span');
        bonus.className = 'speed-bonus';
        bonus.style.color = tier.color;
        bonus.textContent = `+${questionTotal}`;
        btn.appendChild(bonus);
      }
    }
    if (val === chosen && !correct) btn.classList.add('incorrect');
    btn.style.pointerEvents = 'none';
  });

  // Update HUD immediately
  $('#quiz-points').textContent = qs.totalPoints;
  $('#quiz-streak').textContent = qs.streak;

  setTimeout(() => { qs.current++; showQuestion(); }, correct ? 800 : 1200);
}

function finishQuiz() {
  const qs = state.quizState;
  $('#quiz-active').classList.add('hidden');
  $('#quiz-results').classList.remove('hidden');

  const total = qs.questions.length;
  const accPct = Math.round((qs.correctCount / total) * 100);
  const avgSpeed = qs.answers.filter(a => a.correct).length > 0
    ? Math.round(qs.answers.filter(a => a.correct).reduce((s, a) => s + a.responseTime, 0) / qs.answers.filter(a => a.correct).length)
    : 0;

  // Results grid
  $('#quiz-results-grid').innerHTML = `
    <div class="result-card accuracy">
      <div class="result-value">${accPct}%</div>
      <div class="result-label">Accuracy</div>
    </div>
    <div class="result-card speed">
      <div class="result-value">${avgSpeed ? (avgSpeed/1000).toFixed(1)+'s' : '-'}</div>
      <div class="result-label">Avg Speed</div>
    </div>
    <div class="result-card streak">
      <div class="result-value">${qs.maxStreak}x</div>
      <div class="result-label">Best Streak</div>
    </div>
    <div class="result-card total">
      <div class="result-value">${qs.totalPoints}</div>
      <div class="result-label">Total Points</div>
    </div>
  `;

  // Breakdown
  const wrong = qs.answers.filter(a => !a.correct);
  let breakdownHtml = wrong.length
    ? `<h4>${wrong.length} Missed &mdash; Review</h4>`
    : `<h4>Perfect Score!</h4>`;

  if (wrong.length) {
    breakdownHtml += wrong.map(a => `
      <div class="breakdown-item">
        <span class="q-term">${esc(a.question.question)}</span>
        <span class="q-correct">&rarr; ${esc(a.question.correct)}</span>
        ${a.chosen
          ? `<span class="q-wrong">you: ${esc(a.chosen)}</span>`
          : `<span class="q-timeout">timed out</span>`}
        <span class="q-points">0 pts</span>
      </div>
    `).join('');
  }

  // Points breakdown summary with percentages
  const grandTotal = qs.totalAccPts + qs.totalSpeedPts + qs.totalStreakPts || 1;
  const accPctOfTotal = Math.round((qs.totalAccPts / grandTotal) * 100);
  const spdPctOfTotal = Math.round((qs.totalSpeedPts / grandTotal) * 100);
  const strkPctOfTotal = Math.round((qs.totalStreakPts / grandTotal) * 100);

  breakdownHtml += `<div class="breakdown-item" style="background:var(--surface-2);font-weight:600;">
    <span>Score Composition</span>
    <span style="color:var(--primary)">Accuracy: ${qs.totalAccPts} (${accPctOfTotal}%)</span>
    <span style="color:var(--success)">Speed: ${qs.totalSpeedPts} (${spdPctOfTotal}%)</span>
    <span style="color:var(--amber)">Streak: ${qs.totalStreakPts} (${strkPctOfTotal}%)</span>
  </div>`;

  $('#quiz-breakdown').innerHTML = breakdownHtml;

  // Save adaptive performance
  saveQuizPerformance(accPct);

  // Save
  apiFetch('/api/quiz/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseId: state.currentCaseId,
      mode: qs.mode || 'mcq',
      score: qs.totalPoints,
      total: total,
      details: {
        accuracy: accPct,
        avgSpeed,
        maxStreak: qs.maxStreak,
        accPts: qs.totalAccPts,
        speedPts: qs.totalSpeedPts,
        streakPts: qs.totalStreakPts,
      }
    })
  }).catch(console.error);
}

// ===== CONTEXT QUIZ =====
function startContextQuiz() {
  const nodes = state.currentAnalysis?.context_nodes || [];
  if (nodes.length < 4) { alert('Not enough context nodes for a quiz.'); return; }

  const questions = generateContextQuestions(nodes);
  if (questions.length === 0) { alert('Could not generate context questions.'); return; }

  $('#quiz-setup').classList.add('hidden');
  $('#quiz-results').classList.add('hidden');
  $('#sight-active').classList.add('hidden');
  $('#quiz-active').classList.remove('hidden');

  state.quizState = {
    questions, current: 0, correctCount: 0, streak: 0, maxStreak: 0,
    totalPoints: 0, totalSpeedPts: 0, totalStreakPts: 0, totalAccPts: 0,
    answers: [], timer: null, countdownRAF: null, questionStartTime: 0,
    mode: 'context'
  };
  showQuestion();
}

function generateContextQuestions(nodes, count = 20) {
  const questions = [];
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // 1. "Which element appeared in this case?" — recognition recall
  const typeGroups = {};
  nodes.forEach(n => { const t = n.type || 'event'; if (!typeGroups[t]) typeGroups[t] = []; typeGroups[t].push(n); });
  Object.entries(typeGroups).forEach(([type, group]) => {
    group.forEach(n => {
      const fakeLabels = ['Unrelated Corp v. State', 'January 15, 2019', 'Dr. Zhang Wei', 'Form I-485', '$2.5 million settlement', 'Arbitration hearing'];
      const others = shuffle(fakeLabels.filter(f => f !== n.label)).slice(0, 3);
      questions.push({
        question: `Which ${type} appeared in this case?`,
        direction: 'Recall',
        options: shuffle([n.label, ...others]),
        correct: n.label,
        difficulty: 2
      });
    });
  });

  // 2. "What do you recall about [element]?" — detail retrieval
  nodes.filter(n => n.detail).forEach(n => {
    const otherDetails = shuffle(nodes.filter(nn => nn.id !== n.id && nn.detail).map(nn => nn.detail)).slice(0, 3);
    if (otherDetails.length >= 3) {
      questions.push({
        question: `What do you recall about "${n.label}"?`,
        direction: 'Recall',
        options: shuffle([n.detail, ...otherDetails]),
        correct: n.detail,
        difficulty: 3
      });
    }
  });

  // 3. "Why does [element] matter for case preparation?" — significance recall
  nodes.filter(n => n.significance).forEach(n => {
    const otherSigs = shuffle(nodes.filter(nn => nn.id !== n.id && nn.significance).map(nn => nn.significance)).slice(0, 3);
    if (otherSigs.length >= 3) {
      questions.push({
        question: `Why does "${n.label}" matter for case preparation?`,
        direction: 'Recall',
        options: shuffle([n.significance, ...otherSigs]),
        correct: n.significance,
        difficulty: 3
      });
    }
  });

  // 4. "Which element is a [type]?" — reverse type recall
  nodes.forEach(n => {
    const sameType = nodes.filter(nn => nn.type === n.type && nn.id !== n.id);
    const diffType = nodes.filter(nn => nn.type !== n.type);
    if (diffType.length >= 3) {
      const others = shuffle(diffType).slice(0, 3).map(nn => nn.label);
      questions.push({
        question: `Which of these is a ${n.type} in this case?`,
        direction: 'Recall',
        options: shuffle([n.label, ...others]),
        correct: n.label,
        difficulty: 2
      });
    }
  });

  // 5. "What type of element is [label]?" — classification recall
  nodes.forEach(n => {
    const types = ['date', 'location', 'person', 'document', 'amount', 'event'];
    const others = shuffle(types.filter(t => t !== n.type)).slice(0, 3);
    questions.push({
      question: `"${n.label}" — what category does this belong to?`,
      direction: 'Recall',
      options: shuffle([n.type, ...others]),
      correct: n.type,
      difficulty: 1
    });
  });

  return shuffle(questions).slice(0, count);
}

// ===== SIGHT TRANSLATION =====
async function startSight() {
  if (!state.currentCaseId) return;
  $('#quiz-setup').classList.add('hidden');
  $('#quiz-active').classList.add('hidden');
  $('#quiz-results').classList.add('hidden');
  $('#sight-active').classList.remove('hidden');
  $('#sight-result').classList.add('hidden');
  $('#sight-assessment').classList.add('hidden');

  try {
    const res = await apiFetch(`/api/quiz/sight/${state.currentCaseId}`, { method: 'POST' });
    const data = await res.json();
    state.sightData = data;
    $('#sight-passage').textContent = data.passage || 'No passage available.';
  } catch (e) {
    console.error('Sight error:', e);
    $('#sight-passage').textContent = 'Error generating passage.';
  }
}

function showSightAssessment() {
  const keyTerms = state.sightData?.key_terms || [];
  if (!keyTerms.length) { alert('No key terms available for assessment.'); return; }

  $('#sight-assessment').classList.remove('hidden');
  $('#sight-done-btn').disabled = true;

  // Build checklist
  $('#sight-checklist').innerHTML = keyTerms.map((t, i) => `
    <label class="sight-check-item" data-idx="${i}">
      <input type="checkbox" value="${i}">
      <span class="sight-term-en">${esc(t.en)}</span>
      <span class="sight-term-arrow">&rarr;</span>
      <span class="sight-term-zh">${esc(t.zh_simplified || t.zh_traditional || '')}</span>
    </label>
  `).join('');

  // Build confidence rating (1-5)
  $('#sight-rating').innerHTML = [1,2,3,4,5].map(n =>
    `<button class="sight-star" data-rating="${n}">${n}</button>`
  ).join('');
  state.sightRating = 3;
  $$('.sight-star').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sightRating = parseInt(btn.dataset.rating);
      $$('.sight-star').forEach(b => b.classList.toggle('active', parseInt(b.dataset.rating) <= state.sightRating));
    });
  });
  // Default highlight
  $$('.sight-star').forEach(b => b.classList.toggle('active', parseInt(b.dataset.rating) <= 3));

  // Toggle check items
  $$('.sight-check-item').forEach(item => {
    item.addEventListener('click', () => item.classList.toggle('checked'));
  });
}

function submitSightAssessment() {
  const keyTerms = state.sightData?.key_terms || [];
  const checked = $$('.sight-check-item input:checked').length;
  const total = keyTerms.length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

  $('#sight-assessment').classList.add('hidden');
  $('#sight-result').classList.remove('hidden');
  $('#sight-score-display').innerHTML = `
    <div class="results-grid" style="max-width:400px;margin:0 auto;">
      <div class="result-card accuracy"><div class="result-value">${pct}%</div><div class="result-label">Terms Correct</div></div>
      <div class="result-card streak"><div class="result-value">${checked}/${total}</div><div class="result-label">Terms Rendered</div></div>
      <div class="result-card speed"><div class="result-value">${state.sightRating}/5</div><div class="result-label">Confidence</div></div>
    </div>
  `;

  // Save score
  apiFetch('/api/quiz/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseId: state.currentCaseId,
      mode: 'sight',
      score: pct,
      total: total,
      details: { termsCorrect: checked, termsTotal: total, confidence: state.sightRating }
    })
  }).catch(console.error);
}

// ===== EXPORT ALL TABS AS PDF =====
function exportAllTabsPDF() {
  const a = state.currentAnalysis;
  const p = state.currentProfile;
  if (!a) return;

  const caseName = $('#case-title').textContent || 'Case Prep';

  // Build terminology rows
  const terms = a.terminology || [];
  const termRows = terms.map(t =>
    `<tr>
      <td>${esc(t.en)}</td>
      <td>${esc(t.zh_simplified)}</td>
      <td>${esc(t.zh_traditional)}</td>
      <td>${esc(t.pinyin)}</td>
      <td>${esc(t.context_note)}</td>
      <td>${t.difficulty || ''}</td>
    </tr>`
  ).join('');

  // Build context nodes
  const nodes = a.context_nodes || [];
  const contextRows = nodes.map(n =>
    `<tr>
      <td><strong>${esc(n.label)}</strong></td>
      <td>${esc(n.type)}</td>
      <td>${esc(n.detail)}</td>
      <td>${esc(n.significance)}</td>
    </tr>`
  ).join('');

  // Build legal theory
  const coas = a.legal_theory?.causes_of_action || [];
  const legalHtml = coas.map(ca => `
    <div class="pdf-coa">
      <h3>${esc(ca.name)}</h3>
      <table>
        <tr><th>Elements</th><td>${(ca.elements || []).map(e => `<div>- ${esc(e)}</div>`).join('')}</td></tr>
        <tr><th>Evidence</th><td>${(ca.evidence_needed || []).map(e => `<div>- ${esc(e)}</div>`).join('')}</td></tr>
        <tr><th>Likely Questions</th><td>${(ca.likely_questions || []).map(e => `<div>- ${esc(e)}</div>`).join('')}</td></tr>
        <tr><th>Likely Answers</th><td>${(ca.likely_answers || []).map(e => `<div>- ${esc(e)}</div>`).join('')}</td></tr>
      </table>
      <p><strong>Plaintiff:</strong> ${esc(ca.plaintiff_angle || '')}</p>
      <p><strong>Defense:</strong> ${esc(ca.defendant_angle || '')}</p>
    </div>
  `).join('');

  // Build industry knowledge
  const ind = a.industry_knowledge || {};
  const stepsHtml = (ind.process_steps || []).map((s, i) => `
    <div class="pdf-step">
      <h4>Step ${i + 1}: ${esc(s.step)}</h4>
      <p>${esc(s.description)}</p>
      <table>
        <thead><tr><th>English</th><th>Simplified</th><th>Traditional</th><th>Pinyin</th></tr></thead>
        <tbody>${(s.key_terms || []).map(t => `
          <tr><td>${esc(t.en)}</td><td>${esc(t.zh_simplified)}</td><td>${esc(t.zh_traditional)}</td><td>${esc(t.pinyin)}</td></tr>
        `).join('')}</tbody>
      </table>
    </div>
  `).join('');

  // Build hazard zones
  const hazards = a.hazard_zones || [];
  const hazardHtml = [...hazards].sort((a, b) => (b.severity || 3) - (a.severity || 3)).map(h => `
    <div class="pdf-hazard">
      <h4>
        <span class="sev-badge">${h.severity || 3}</span>
        ${esc(h.scenario)}
      </h4>
      <p><strong>Why hard:</strong> ${esc(h.why_hard)}</p>
      ${h.example_exchange ? `
        <div class="exchange">
          <p><strong>Attorney:</strong> ${esc(h.example_exchange.attorney_asks || '')}</p>
          <p><strong>Witness:</strong> ${esc(h.example_exchange.witness_answers || '')}</p>
        </div>
      ` : ''}
      <div class="terms">${(h.critical_terms || []).map(t => `<span class="chip">${esc(t)}</span>`).join(' ')}</div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(caseName)} — Case Prep Materials</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'Noto Sans SC', 'PingFang SC', sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 20px; border-bottom: 3px solid #4f46e5; padding-bottom: 6px; margin-top: 0; }
  h2 { font-size: 16px; color: #4f46e5; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 28px; page-break-after: avoid; }
  h3 { font-size: 13px; margin: 10px 0 6px; }
  h4 { font-size: 12px; margin: 8px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 10.5px; }
  th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  .meta { color: #6b7280; font-size: 10px; margin-bottom: 16px; }
  .pdf-coa { margin-bottom: 14px; page-break-inside: avoid; }
  .pdf-coa table th { width: 120px; }
  .pdf-step { margin-bottom: 10px; page-break-inside: avoid; }
  .pdf-hazard { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; page-break-inside: avoid; }
  .pdf-hazard h4 { margin-top: 0; }
  .sev-badge { display: inline-block; background: #ef4444; color: #fff; border-radius: 4px; padding: 1px 6px; font-size: 10px; margin-right: 6px; }
  .exchange { background: #f8fafc; border-left: 3px solid #4f46e5; padding: 4px 8px; margin: 6px 0; font-size: 10.5px; }
  .chip { display: inline-block; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 4px; padding: 1px 6px; margin: 2px; font-size: 10px; }
  .terms { margin-top: 4px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
    h2 { page-break-after: avoid; }
  }
</style>
</head>
<body>
  <h1>${esc(caseName)} — Case Preparation Materials</h1>
  <div class="meta">
    ${p ? `Case Type: ${esc(p.case_type || '')} — ${esc(p.case_subtype || '')} | P-Distance: ${p.p_distance || 'N/A'}/5` : ''}
    | Generated: ${new Date().toLocaleDateString()}
  </div>

  <h2>1. Terminology (${terms.length} terms)</h2>
  <table>
    <thead><tr><th>English</th><th>Simplified</th><th>Traditional</th><th>Pinyin</th><th>Context</th><th>Diff</th></tr></thead>
    <tbody>${termRows}</tbody>
  </table>

  <h2>2. Context Nodes (${nodes.length})</h2>
  <table>
    <thead><tr><th>Label</th><th>Type</th><th>Detail</th><th>Significance</th></tr></thead>
    <tbody>${contextRows}</tbody>
  </table>

  <h2>3. Legal Theory</h2>
  ${legalHtml || '<p>No legal theories identified.</p>'}

  <h2>4. Industry Knowledge${ind.domain ? ': ' + esc(ind.domain) : ''}</h2>
  ${ind.overview ? `<p>${esc(ind.overview)}</p>` : ''}
  ${stepsHtml || '<p>No industry knowledge generated.</p>'}

  <h2>5. Hazard Zones (${hazards.length})</h2>
  ${hazardHtml || '<p>No hazard zones generated.</p>'}

  <script>window.onload = () => window.print();</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// ===== TAB 7: PODCAST DEEP DIVE =====
function showPodcastSetup() {
  const setup = $('#podcast-setup');
  const loading = $('#podcast-loading');
  const viewer = $('#podcast-viewer');

  loading.classList.add('hidden');

  // Check for cached script
  if (state.currentAnalysis?.podcastScript) {
    setup.classList.add('hidden');
    viewer.classList.remove('hidden');
    renderPodcastScript(state.currentAnalysis.podcastScript);
    return;
  }

  // Try fetching cached from server
  if (state.currentCaseId) {
    apiFetch(`/api/podcast/script/${state.currentCaseId}`)
      .then(res => res.json())
      .then(data => {
        if (data.script) {
          state.currentAnalysis.podcastScript = data;
          setup.classList.add('hidden');
          viewer.classList.remove('hidden');
          renderPodcastScript(data);
        } else {
          setup.classList.remove('hidden');
          viewer.classList.add('hidden');
        }
      })
      .catch(() => {
        setup.classList.remove('hidden');
        viewer.classList.add('hidden');
      });
  } else {
    setup.classList.remove('hidden');
    viewer.classList.add('hidden');
  }
}

async function generatePodcast(regenerate = false) {
  if (!state.currentCaseId) return;

  const setup = $('#podcast-setup');
  const loading = $('#podcast-loading');
  const viewer = $('#podcast-viewer');

  setup.classList.add('hidden');
  viewer.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const res = await apiFetch(`/api/podcast/generate/${state.currentCaseId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Generation failed');
    if (!data.script) throw new Error('No script returned');

    // Cache in state
    state.currentAnalysis.podcastScript = data;

    loading.classList.add('hidden');
    viewer.classList.remove('hidden');
    renderPodcastScript(data);
  } catch (err) {
    console.error('Podcast generation error:', err);
    loading.classList.add('hidden');
    setup.classList.remove('hidden');
    alert('Podcast generation failed: ' + err.message);
  }
}

function renderPodcastScript(data) {
  // Update meta badges
  $('#podcast-word-count').textContent = `${data.wordCount?.toLocaleString() || '?'} words`;
  $('#podcast-runtime').textContent = `~${data.estimatedMinutes || '?'} min at 120 WPM`;

  // Convert markdown script to styled HTML
  let html = data.script || '';

  // Escape HTML first, then apply formatting
  html = esc(html);

  // Segment headers: ## [SEGMENT NAME — 0:00-5:00]
  html = html.replace(/## \[(.+?)\]/g, '<div class="podcast-segment-header">$1</div>');

  // Host labels: **A:** and **B:**
  html = html.replace(/\*\*A:\*\*/g, '<span class="podcast-host podcast-host-a">A</span>');
  html = html.replace(/\*\*B:\*\*/g, '<span class="podcast-host podcast-host-b">B</span>');

  // Bold text: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic text: *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Chinese terms with pinyin: 中文 (pīnyīn) — highlight them
  html = html.replace(/([\u4e00-\u9fff\u3400-\u4dbf]{2,})\s*\(([^)]+)\)/g,
    '<span class="podcast-zh">$1</span> <span class="podcast-pinyin">($2)</span>');

  // Paragraphs — double newlines
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  // Horizontal rules
  html = html.replace(/<p>---<\/p>/g, '<hr class="podcast-divider">');

  $('#podcast-script-body').innerHTML = html;
}

// Copy plain-text script to clipboard (for Natural Reader)
function copyPodcastScript() {
  const data = state.currentAnalysis?.podcastScript;
  if (!data?.script) return;

  // Strip markdown formatting for clean plain text
  let plain = data.script;
  plain = plain.replace(/\*\*([^*]+)\*\*/g, '$1');  // bold
  plain = plain.replace(/\*([^*]+)\*/g, '$1');       // italic
  plain = plain.replace(/^## /gm, '');               // headers
  plain = plain.replace(/^---$/gm, '\n');             // dividers

  navigator.clipboard.writeText(plain).then(() => {
    const btn = $('#podcast-copy-btn');
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Copied!';
    btn.style.color = 'var(--success)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  }).catch(() => {
    // Fallback: select all text in the script body
    const range = document.createRange();
    range.selectNodeContents($('#podcast-script-body'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    alert('Text selected — press Ctrl+C to copy.');
  });
}

// Browser Web Speech API — fallback TTS with two voices
let podcastSpeechQueue = [];
let podcastSpeechIdx = 0;
let podcastSpeaking = false;

function playPodcastScript() {
  const data = state.currentAnalysis?.podcastScript;
  if (!data?.script || !window.speechSynthesis) return;

  // Stop any existing playback
  speechSynthesis.cancel();

  // Parse script into speaker turns
  const lines = data.script.split('\n').filter(l => l.trim());
  podcastSpeechQueue = [];

  for (const line of lines) {
    const clean = line.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^## \[.*\]/, '').trim();
    if (!clean || clean === '---') continue;

    if (clean.startsWith('A:')) {
      podcastSpeechQueue.push({ speaker: 'A', text: clean.slice(2).trim() });
    } else if (clean.startsWith('B:')) {
      podcastSpeechQueue.push({ speaker: 'B', text: clean.slice(2).trim() });
    } else if (clean.length > 10) {
      // Narration or segment header
      podcastSpeechQueue.push({ speaker: 'A', text: clean });
    }
  }

  if (podcastSpeechQueue.length === 0) return;

  // Get available voices — pick two distinct ones
  const voices = speechSynthesis.getVoices();
  const enVoices = voices.filter(v => v.lang.startsWith('en'));
  const voiceA = enVoices.find(v => /male|david|james|daniel/i.test(v.name)) || enVoices[0] || voices[0];
  const voiceB = enVoices.find(v => v !== voiceA && /female|zira|samantha|karen/i.test(v.name)) || enVoices[1] || voices[1] || voiceA;

  podcastSpeechIdx = 0;
  podcastSpeaking = true;
  $('#podcast-play-btn').classList.add('hidden');
  $('#podcast-stop-btn').classList.remove('hidden');

  function speakNext() {
    if (podcastSpeechIdx >= podcastSpeechQueue.length || !podcastSpeaking) {
      stopPodcastScript();
      return;
    }

    const item = podcastSpeechQueue[podcastSpeechIdx];
    const utter = new SpeechSynthesisUtterance(item.text);
    utter.voice = item.speaker === 'A' ? voiceA : voiceB;
    utter.rate = 0.95;
    utter.pitch = item.speaker === 'A' ? 1.0 : 1.1;
    utter.onend = () => { podcastSpeechIdx++; speakNext(); };
    utter.onerror = () => { podcastSpeechIdx++; speakNext(); };
    speechSynthesis.speak(utter);
  }

  // Voices may load async — wait for them
  if (voices.length === 0) {
    speechSynthesis.addEventListener('voiceschanged', () => speakNext(), { once: true });
  } else {
    speakNext();
  }
}

function stopPodcastScript() {
  podcastSpeaking = false;
  speechSynthesis.cancel();
  podcastSpeechQueue = [];
  podcastSpeechIdx = 0;
  $('#podcast-play-btn').classList.remove('hidden');
  $('#podcast-stop-btn').classList.add('hidden');
}

// ===== TAB 8: NOTES =====
function renderNotes() {
  const textarea = $('#notes-textarea');
  if (textarea) textarea.value = state.currentNotes || '';
  renderNoteTags();
  const dateInput = $('#notes-hearing-date');
  if (dateInput) dateInput.value = state.currentHearingDate || '';
  $('#notes-save-status').textContent = '';
}

function renderNoteTags() {
  const container = $('#notes-tags');
  if (!container) return;
  container.innerHTML = (state.currentTags || []).map((t, i) => `
    <span class="notes-tag">${esc(t)}<button class="tag-remove" data-idx="${i}">&times;</button></span>
  `).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentTags.splice(parseInt(btn.dataset.idx), 1);
      renderNoteTags();
      saveTags();
    });
  });
}

async function saveNotes() {
  if (!state.currentCaseId) return;
  try {
    await apiFetch(`/api/cases/${state.currentCaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: state.currentNotes })
    });
    $('#notes-save-status').textContent = 'Saved';
    setTimeout(() => { if ($('#notes-save-status')) $('#notes-save-status').textContent = ''; }, 2000);
  } catch {
    $('#notes-save-status').textContent = 'Save failed';
  }
}

async function saveTags() {
  if (!state.currentCaseId) return;
  try {
    await apiFetch(`/api/cases/${state.currentCaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: state.currentTags })
    });
    loadCases(); // Refresh sidebar tags
  } catch {}
}

async function saveHearingDate() {
  if (!state.currentCaseId) return;
  try {
    await apiFetch(`/api/cases/${state.currentCaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hearing_date: state.currentHearingDate })
    });
    loadCases();
  } catch {}
}

// ===== FLASHCARD MODE =====
function openFlashcards() {
  const terms = state.currentAnalysis?.terminology || [];
  if (!terms.length) { alert('No terminology available.'); return; }

  // SRS-like: shuffle, track ratings
  const cards = terms.filter(t => (t.difficulty ?? 3) > 0).map(t => ({
    en: t.en, zh: t.zh_simplified || t.zh_traditional || '', pinyin: t.pinyin || '',
    context: t.context_note || '', interval: 1, rating: null
  }));
  shuffle(cards);

  state.flashcardState = { cards, current: 0, known: 0, learning: 0, flipped: false };
  $('#flashcard-overlay').classList.remove('hidden');
  showFlashcard();
}

function closeFlashcards() {
  $('#flashcard-overlay').classList.add('hidden');
  state.flashcardState = null;
}

function showFlashcard() {
  const fs = state.flashcardState;
  if (!fs || fs.current >= fs.cards.length) {
    // Done
    $('#fc-front').innerHTML = `<div style="text-align:center"><h3>Session Complete!</h3><p>${fs.known} known, ${fs.learning} need review</p></div>`;
    $('#fc-back').classList.add('hidden');
    $('#fc-flip').style.display = 'none';
    $('#fc-rate-btns').classList.add('hidden');
    return;
  }

  const card = fs.cards[fs.current];
  fs.flipped = false;
  $('#fc-progress').textContent = `${fs.current + 1}/${fs.cards.length}`;
  $('#fc-known-count').textContent = `${fs.known} known`;
  $('#fc-learning-count').textContent = `${fs.learning} learning`;
  $('#fc-front').textContent = card.en;
  $('#fc-front').classList.remove('hidden');
  $('#fc-back').classList.add('hidden');
  $('#fc-flip').style.display = '';
  $('#fc-rate-btns').classList.add('hidden');
}

function flipFlashcard() {
  const fs = state.flashcardState;
  if (!fs || fs.flipped) return;
  fs.flipped = true;
  const card = fs.cards[fs.current];
  $('#fc-back').innerHTML = `
    <div class="fc-zh">${esc(card.zh)}</div>
    <div class="fc-pinyin">${esc(card.pinyin)}</div>
    ${card.context ? `<div class="fc-context">${esc(card.context)}</div>` : ''}
  `;
  $('#fc-front').classList.add('hidden');
  $('#fc-back').classList.remove('hidden');
  $('#fc-flip').style.display = 'none';
  $('#fc-rate-btns').classList.remove('hidden');
}

function rateFlashcard(rating) {
  const fs = state.flashcardState;
  if (!fs) return;

  if (rating === 'again') {
    // Put card back 3-5 cards later
    const card = fs.cards[fs.current];
    const insertAt = Math.min(fs.current + 3 + Math.floor(Math.random() * 3), fs.cards.length);
    fs.cards.splice(fs.current, 1);
    fs.cards.splice(insertAt, 0, card);
    fs.learning++;
  } else if (rating === 'hard') {
    // Put back later
    const card = fs.cards[fs.current];
    const insertAt = Math.min(fs.current + 5 + Math.floor(Math.random() * 5), fs.cards.length);
    fs.cards.splice(fs.current, 1);
    fs.cards.splice(insertAt, 0, card);
    fs.learning++;
  } else {
    // good or easy — move on
    fs.known++;
    fs.current++;
  }

  showFlashcard();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== AUDIO PRONUNCIATION =====
function playTermAudio() {
  if (!window.speechSynthesis) { alert('Speech synthesis not supported in this browser.'); return; }
  // Find expanded term
  const terms = state.currentAnalysis?.terminology || [];
  const expanded = [...expandedTerms];
  if (!expanded.length) { alert('Click a term row to expand it, then click Audio.'); return; }
  const term = terms[expanded[0]];
  if (!term) return;
  const text = term.zh_simplified || term.zh_traditional || '';
  if (!text) return;

  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const zhVoice = voices.find(v => v.lang.startsWith('zh')) || voices[0];
  if (zhVoice) utter.voice = zhVoice;
  utter.rate = 0.8;
  speechSynthesis.speak(utter);
}

// ===== EXPORT: ANKI =====
function exportAnki() {
  const terms = state.currentAnalysis?.terminology || [];
  if (!terms.length) return;
  const lines = terms.map(t => {
    const front = t.en || '';
    const back = `${t.zh_simplified || ''} / ${t.zh_traditional || ''}<br>${t.pinyin || ''}<br><i>${t.context_note || ''}</i>`;
    return `${front}\t${back}`;
  });
  downloadText(lines.join('\n'), 'anki-import.txt');
}

// ===== EXPORT: DOC (HTML) =====
function exportDoc() {
  // Reuse the PDF export HTML but without auto-print, download as .html
  const a = state.currentAnalysis;
  const p = state.currentProfile;
  if (!a) return;
  const caseName = $('#case-title').textContent || 'Case Prep';
  const terms = a.terminology || [];
  const termRows = terms.map(t =>
    `<tr><td>${esc(t.en)}</td><td>${esc(t.zh_simplified)}</td><td>${esc(t.zh_traditional)}</td><td>${esc(t.pinyin)}</td><td>${esc(t.context_note)}</td><td>${t.difficulty || ''}</td></tr>`
  ).join('');
  const nodes = a.context_nodes || [];
  const contextRows = nodes.map(n =>
    `<tr><td><strong>${esc(n.label)}</strong></td><td>${esc(n.type)}</td><td>${esc(n.detail)}</td><td>${esc(n.significance)}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(caseName)}</title>
<style>body{font-family:'Segoe UI',sans-serif;font-size:12px;color:#1a1a1a;line-height:1.5;max-width:900px;margin:0 auto;padding:20px}
h1{font-size:20px;border-bottom:3px solid #4f46e5;padding-bottom:6px}h2{font-size:16px;color:#4f46e5;margin-top:28px}
table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:11px}th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left}th{background:#f1f5f9;font-weight:600}</style></head>
<body><h1>${esc(caseName)} — Case Preparation Materials</h1>
<h2>Terminology (${terms.length})</h2><table><thead><tr><th>English</th><th>Simplified</th><th>Traditional</th><th>Pinyin</th><th>Context</th><th>Diff</th></tr></thead><tbody>${termRows}</tbody></table>
<h2>Context Nodes (${nodes.length})</h2><table><thead><tr><th>Label</th><th>Type</th><th>Detail</th><th>Significance</th></tr></thead><tbody>${contextRows}</tbody></table>
${state.currentNotes ? `<h2>Notes</h2><pre style="white-space:pre-wrap">${esc(state.currentNotes)}</pre>` : ''}
</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${caseName.replace(/[^a-zA-Z0-9]/g, '_')}.html`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ===== QUIZ HISTORY DASHBOARD =====
async function loadQuizHistory() {
  if (!state.currentCaseId) return;
  try {
    const res = await apiFetch(`/api/quiz/scores/${state.currentCaseId}`);
    const scores = await res.json();
    renderQuizHistory(scores);
  } catch {}
}

function renderQuizHistory(scores) {
  const chart = $('#quiz-history-chart');
  const list = $('#quiz-history-list');
  if (!chart || !list) return;

  if (!scores || !scores.length) {
    chart.innerHTML = '<p style="color:var(--text-3);font-size:13px">No quiz history yet.</p>';
    list.innerHTML = '';
    return;
  }

  // Bar chart — last 20 scores
  const recent = scores.slice(0, 20).reverse();
  const maxScore = Math.max(...recent.map(s => s.score || 0), 1);
  chart.innerHTML = recent.map(s => {
    const pct = Math.round(((s.score || 0) / maxScore) * 100);
    const details = s.details ? JSON.parse(s.details) : {};
    return `<div class="quiz-history-bar" style="height:${Math.max(pct, 5)}%" title="${s.mode}: ${s.score} pts, ${details.accuracy || 0}% acc">
      <span class="bar-label">${details.accuracy || Math.round(s.score)}%</span>
    </div>`;
  }).join('');

  // List
  list.innerHTML = scores.slice(0, 10).map(s => {
    const details = s.details ? JSON.parse(s.details) : {};
    const date = new Date(s.created_at).toLocaleDateString();
    return `<div class="breakdown-item">
      <span class="q-term">${esc(s.mode)}</span>
      <span>${date}</span>
      <span class="q-correct">${s.score} pts</span>
      <span>${details.accuracy || 0}% acc</span>
    </div>`;
  }).join('');
}

// ===== ADAPTIVE QUIZ DIFFICULTY =====
function getAdaptiveTimer() {
  if (!state.currentCaseId) return 6000;
  const key = `cpe_quiz_perf_${state.currentCaseId}`;
  try {
    const perf = JSON.parse(localStorage.getItem(key) || '{}');
    if (perf.accuracy > 80) return 4000;
    if (perf.accuracy < 40) return 8000;
  } catch {}
  return 6000;
}

function saveQuizPerformance(accuracy) {
  if (!state.currentCaseId) return;
  const key = `cpe_quiz_perf_${state.currentCaseId}`;
  localStorage.setItem(key, JSON.stringify({ accuracy, timestamp: Date.now() }));
}

// ===== SETTINGS MODAL =====
function openSettings() {
  $('#settings-modal').classList.remove('hidden');
  $('#pref-theme').value = state.preferences.theme || 'system';
  $('#pref-language').value = state.preferences.language || 'zh';
  // Hide password section for guests
  const pwSection = $('#settings-password-section');
  if (pwSection) pwSection.style.display = state.isGuest ? 'none' : '';
  $('#settings-pw-status').textContent = '';
  $('#settings-current-pw').value = '';
  $('#settings-new-pw').value = '';
}

function saveSettingsModal() {
  state.preferences.theme = $('#pref-theme').value;
  state.preferences.language = $('#pref-language').value;
  applyTheme(state.preferences.theme);
  savePreferences();
  $('#settings-modal').classList.add('hidden');
}

async function changePassword() {
  const current = $('#settings-current-pw').value;
  const newPw = $('#settings-new-pw').value;
  const status = $('#settings-pw-status');

  if (!current || !newPw) { status.textContent = 'Both fields required'; return; }
  if (newPw.length < 8) { status.textContent = 'New password must be 8+ characters'; return; }

  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    status.textContent = 'Password changed successfully';
    status.style.color = 'var(--success)';
    $('#settings-current-pw').value = '';
    $('#settings-new-pw').value = '';
  } catch (err) {
    status.textContent = err.message;
    status.style.color = 'var(--danger)';
  }
}

// ===== SIDEBAR DRAG TO REORDER =====
function setupSidebarDrag() {
  const list = $('#case-list');
  if (!list) return;
  let draggedId = null;

  list.querySelectorAll('.case-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      draggedId = el.dataset.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      $$('.case-item.drag-over').forEach(x => x.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (!draggedId || draggedId === el.dataset.id) return;

      // Reorder in state
      const fromIdx = state.cases.findIndex(c => c.id === draggedId);
      const toIdx = state.cases.findIndex(c => c.id === el.dataset.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const [item] = state.cases.splice(fromIdx, 1);
      state.cases.splice(toIdx, 0, item);
      renderCaseList();

      // Save to server
      const order = state.cases.map((c, i) => ({ id: c.id, sort_order: i }));
      apiFetch('/api/cases/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      }).catch(() => {});
    });
  });
}

// ===== UTILITIES =====
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
