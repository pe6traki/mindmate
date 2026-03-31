'use strict';

// ════════════════════════════════════════════════════════════════
//  Anx — frontend logic
//  Privacy model: no server storage, all data in downloaded file
// ════════════════════════════════════════════════════════════════

// ── Configuration ─────────────────────────────────────────────────
// Replace with your own Cloudflare Worker URL before deploying.
const API_URL = 'YOUR_WORKER_URL_HERE';

// ── State ────────────────────────────────────────────────────────
const state = {
  uuid:           null,   // anonymous persistent ID
  messages:       [],     // current session [{role, content}]
  context:        null,   // loaded from file {version, sessions:[]}
  currentSummary: null,   // generated JSON summary at session end
  active:         false,
  ended:          false,
  loading:        false,
};

// ── DOM references ───────────────────────────────────────────────
const $  = id => document.getElementById(id);
let dom  = {};

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  dom = {
    welcome:           $('welcome'),
    chat:              $('chat'),
    messages:          $('messages'),
    typing:            $('typing'),
    inputBar:          $('input-bar'),
    userInput:         $('user-input'),
    btnSend:           $('btn-send'),
    btnNewSession:     $('btn-new-session'),
    fileWelcome:       $('file-input-welcome'),
    fileHeader:        $('file-input-header'),
    btnLoadHeader:     $('btn-load-header'),
    btnDownloadHeader: $('btn-download-header'),
    btnEndSession:        $('btn-end-session'),
    btnNewSessionChat:    $('btn-new-session-chat'),
    btnBrand:             $('btn-brand'),
    sessionFooter:        $('session-footer'),
    contextBadge:      $('context-badge'),
    contextCount:      $('context-count'),
    toast:             $('toast'),
  };

  // UUID — anonymous, persisted in localStorage only
  state.uuid = localStorage.getItem('anx_uuid') || newUUID();
  localStorage.setItem('anx_uuid', state.uuid);

  // Wire events
  dom.btnNewSession.addEventListener('click', startSession);
  dom.btnSend.addEventListener('click', handleSend);
  dom.userInput.addEventListener('keydown', onKeydown);
  dom.userInput.addEventListener('input', autoResize);
  dom.fileWelcome.addEventListener('change', loadFile);
  dom.fileHeader.addEventListener('change', loadFile);
  dom.btnLoadHeader.addEventListener('click', () => dom.fileHeader.click());
  dom.btnDownloadHeader.addEventListener('click', downloadFile);
  dom.btnEndSession.addEventListener('click', endSession);
  dom.btnNewSessionChat.addEventListener('click', startSession);
  dom.btnBrand.addEventListener('click', backToWelcome);

  // Keyboard shortcut: label for file input (Enter/Space)
  document.querySelector('label[for="file-input-welcome"]')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dom.fileWelcome.click();
      }
    });
});

// ── UUID ─────────────────────────────────────────────────────────
function newUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Session lifecycle ─────────────────────────────────────────────
function startSession() {
  state.active         = true;
  state.ended          = false;
  state.messages       = [];
  state.currentSummary = null;

  dom.welcome.classList.add('hidden');
  dom.chat.classList.remove('hidden');
  dom.inputBar.classList.remove('hidden');
  dom.btnDownloadHeader.classList.add('hidden');
  dom.sessionFooter.classList.add('hidden');
  dom.messages.innerHTML = '';

  // Static greeting — avoids an unnecessary API call for session open
  // Claude will pick up naturally from the user's first message.
  appendBubble('assistant',
    'Здравей. Тук съм.\nКакво те вълнува или безпокои в момента?');

  focusInput();
}

// ── Sending messages ──────────────────────────────────────────────
function handleSend() {
  const text = dom.userInput.value.trim();
  if (!text || state.loading) return;
  sendMessage(text);
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

// ── API call ──────────────────────────────────────────────────────
async function callAI(messages, isSummary = false) {
  state.loading = true;
  dom.btnSend.disabled = true;
  showTyping();

  try {
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        messages:  messages,
        context:   isSummary ? null : state.context,
        isSummary: isSummary,
      }),
    });

    // Read as text first so we can diagnose non-JSON PHP errors
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      // Log the actual PHP output so it's visible in DevTools console
      console.error('[anx] Non-JSON response from server:\n', raw.substring(0, 600));
      throw new Error('Сървърна грешка — виж конзолата за детайли');
    }

    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    hideTyping();
    return data.response;

  } catch (err) {
    hideTyping();
    if (!isSummary) {
      appendBubble('system', `Грешка: ${err.message}`);
    }
    console.error('[anx]', err.message);
    return null;
  } finally {
    state.loading = false;
    dom.btnSend.disabled = false;
    if (!isSummary) focusInput();
  }
}

async function sendMessage(text) {
  dom.userInput.value = '';
  autoResize();

  appendBubble('user', text);
  state.messages.push({ role: 'user', content: text });

  if (state.messages.length >= 6) {
    dom.sessionFooter.classList.remove('hidden');
  }

  const reply = await callAI(state.messages, false);
  if (reply) {
    appendBubble('assistant', reply);
    state.messages.push({ role: 'assistant', content: reply });
  }
}

// ── End session & summarize ───────────────────────────────────────
async function endSession() {
  if (state.loading || state.ended) return;

  dom.btnEndSession.disabled = true;
  showTyping();
  state.loading = true;

  const today = new Date().toISOString().split('T')[0];

  // Append summary request as final user message (hidden from UI)
  const summaryMessages = [
    ...state.messages,
    {
      role:    'user',
      content: `[SUMMARY_REQUEST] Генерирай структуриран JSON резюмe на тази сесия. `
             + `Отговори САМО с валиден JSON обект, без никакъв допълнителен текст, `
             + `без markdown код блокове, без обяснения. Точният формат:\n`
             + `{\n`
             + `  "title": "кратко заглавие на страха/тревогата (на български)",\n`
             + `  "date": "${today}",\n`
             + `  "initialIntensity": <число 0-10>,\n`
             + `  "finalIntensity": <число 0-10>,\n`
             + `  "surfaceFear": "какво изрази потребителят в началото",\n`
             + `  "coreBelief": "основното убеждение което се появи",\n`
             + `  "keyMoments": "важни прозрения или промени по време на разговора",\n`
             + `  "realityCheck": "прегледани доказателства и получена перспектива",\n`
             + `  "actionable": true или false,\n`
             + `  "actionStep": "конкретна стъпка ако е приложимо, иначе null",\n`
             + `  "technique": "използвана техника ако е приложимо, иначе null",\n`
             + `  "patternNotes": "връзки с повтарящи се теми ако има, иначе null"\n`
             + `}`,
    },
  ];

  const rawResponse = await callAI(summaryMessages, true);

  state.loading = false;
  dom.btnEndSession.disabled = false;
  state.ended  = true;
  state.active = false;

  let summary = null;
  if (rawResponse) {
    try {
      // Claude might wrap JSON in code blocks — strip them
      const cleaned = rawResponse
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) summary = JSON.parse(match[0]);
    } catch (e) {
      console.warn('[anx] Could not parse summary JSON:', e.message);
    }
  }

  state.currentSummary = summary;
  dom.btnDownloadHeader.classList.remove('hidden');
  showSummaryModal(summary);
}

// ── Summary modal ─────────────────────────────────────────────────
function showSummaryModal(summary) {
  // Remove existing modal
  document.getElementById('anx-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'anx-modal';
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Резюме на сесията');

  // Intensity comparison
  let intensityHTML = '';
  if (summary?.initialIntensity != null && summary?.finalIntensity != null) {
    const init  = Math.round(summary.initialIntensity);
    const final = Math.round(summary.finalIntensity);
    const diff  = init - final;
    const arrow = diff > 0 ? '↓' : diff < 0 ? '↑' : '→';
    const cls   = diff > 0 ? 'lower' : diff < 0 ? 'higher' : '';
    intensityHTML = `
      <div class="intensity-row">
        <div class="intensity-item">
          <div class="intensity-label">Начало</div>
          <div class="intensity-value">${init}<span style="font-size:16px;font-weight:400">/10</span></div>
        </div>
        <div class="intensity-arrow">${arrow}</div>
        <div class="intensity-item">
          <div class="intensity-label">Край</div>
          <div class="intensity-value ${cls}">${final}<span style="font-size:16px;font-weight:400">/10</span></div>
        </div>
      </div>`;
  }

  // Summary fields
  const fields = [
    { key: 'coreBelief',   label: 'Основно убеждение'   },
    { key: 'keyMoments',   label: 'Ключови моменти'      },
    { key: 'actionStep',   label: 'Следваща стъпка'      },
    { key: 'technique',    label: 'Използвана техника'   },
    { key: 'patternNotes', label: 'Повтарящи се теми'    },
  ];

  const itemsHTML = summary
    ? fields
        .filter(f => summary[f.key] && summary[f.key] !== 'null')
        .map(f => `
          <div class="summary-item">
            <div class="summary-item-label">${f.label}</div>
            <div class="summary-item-value">${esc(summary[f.key])}</div>
          </div>`)
        .join('')
    : '<p style="color:var(--text-muted);font-size:14px;padding:8px 0">Сесията е приключена. Изтегли файла за да я запазиш.</p>';

  const title = summary?.title ? esc(summary.title) : 'Сесията приключи';

  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" id="modal-close" aria-label="Затвори">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      ${intensityHTML}
      <div class="summary-items">${itemsHTML}</div>
      <div class="modal-actions">
        <button class="btn-primary" id="modal-download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Изтегли файл
        </button>
        <button class="btn-secondary" id="modal-new">Нова сесия</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  $('modal-close').addEventListener('click',    () => overlay.remove());
  $('modal-download').addEventListener('click', () => { downloadFile(); overlay.remove(); });
  $('modal-new').addEventListener('click',      () => { overlay.remove(); backToWelcome(); });

  // Close on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  // Focus trap — close on Escape
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escClose); }
  });
}

// ── File: download ────────────────────────────────────────────────
function downloadFile() {
  // Start from loaded context or fresh object
  const data = state.context
    ? JSON.parse(JSON.stringify(state.context))   // deep copy
    : { version: '1', sessions: [] };

  if (!Array.isArray(data.sessions)) data.sessions = [];

  // Append this session's summary if available
  if (state.currentSummary) {
    data.sessions.push({
      id: newUUID(),
      ...state.currentSummary,
    });
  }

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);

  const a       = document.createElement('a');
  a.href        = url;
  const dateStr = new Date().toISOString().split('T')[0];
  const slug    = (state.currentSummary?.title ?? 'sesiya')
                    .toLowerCase()
                    .replace(/[^а-яa-z0-9]/gi, '-')
                    .replace(/-+/g, '-')
                    .slice(0, 40);
  a.download = `bastun-mindmate-${dateStr}-${slug}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Файлът е изтеглен');
}

// ── File: load ────────────────────────────────────────────────────
function loadFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be re-selected

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || !Array.isArray(data.sessions)) throw new Error('bad format');

      state.context = data;
      const n = data.sessions.length;

      // Update welcome screen badge
      dom.contextBadge.classList.remove('hidden');
      dom.contextCount.textContent = n;

      showToast(`${n} ${n === 1 ? 'сесия заредена' : 'сесии заредени'}`);
    } catch {
      showToast('Невалиден файл — очаква се anx JSON');
    }
  };
  reader.readAsText(file);
}

// ── UI helpers ────────────────────────────────────────────────────
function appendBubble(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatText(text);

  wrap.appendChild(bubble);
  dom.messages.appendChild(wrap);
  scrollDown();
}

function formatText(raw) {
  if (!raw) return '';
  return esc(raw)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g,       '<em>$1</em>')
    .replace(/\n/g,            '<br>');
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showTyping() {
  dom.typing.classList.remove('hidden');
  scrollDown();
}

function hideTyping() {
  dom.typing.classList.add('hidden');
}

function scrollDown() {
  requestAnimationFrame(() => {
    dom.chat.scrollTop = dom.chat.scrollHeight;
  });
}

function autoResize() {
  const el = dom.userInput;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function focusInput() {
  // Only auto-focus on non-touch devices (avoids keyboard popping up on mobile)
  if (window.matchMedia('(hover: hover)').matches) {
    dom.userInput.focus();
  }
}

let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 3000);
}

function backToWelcome() {
  state.active         = false;
  state.ended          = false;
  state.messages       = [];
  state.currentSummary = null;

  dom.messages.innerHTML = '';
  dom.chat.classList.add('hidden');
  dom.inputBar.classList.add('hidden');
  dom.welcome.classList.remove('hidden');
  dom.sessionFooter.classList.add('hidden');
  dom.btnDownloadHeader.classList.add('hidden');
  dom.btnEndSession.disabled = false;
}
