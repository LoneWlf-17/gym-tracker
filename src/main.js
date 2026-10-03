import './styles.css';
import { deleteEntry, exportDatabase, exportJSON, getEntry, initDb, listEntries, persistDb, saveEntry } from './db.js';

const app = document.querySelector('#app');
const state = { page: 'home', editingId: null };

const today = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showStatus(message, isError = false) {
  const old = document.querySelector('.status');
  old?.remove();
  const el = document.createElement('div');
  el.className = `status${isError ? ' error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function pageTop(title, backLabel = 'Home') {
  return `
    <div class="page-top">
      <button class="back" data-action="home">← ${backLabel}</button>
      <h2>${escapeHtml(title)}</h2>
    </div>`;
}

function rowHtml(row = { name: '', reps: '', weights: '' }) {
  return `
    <tr>
      <td><input data-field="name" value="${escapeHtml(row.name)}" placeholder="e.g. Bench Press" /></td>
      <td><input data-field="reps" value="${escapeHtml(row.reps)}" placeholder="10, 8, 8" /></td>
      <td><input data-field="weights" value="${escapeHtml(row.weights)}" placeholder="50, 50, 45" /></td>
      <td><button class="btn danger remove-row" type="button">Remove</button></td>
    </tr>`;
}

function entryEditor(entry = null) {
  const rows = entry?.rows?.length ? entry.rows : [{ name: '', reps: '', weights: '' }];
  state.editingId = entry?.id ?? null;
  state.page = 'editor';

  app.innerHTML = `
    <main class="shell">
      <div class="header">
        <div class="brand">
          <h1>Gym Progress Tracker</h1>
          <p>${entry ? 'Edit workout entry' : 'Record a workout'}</p>
        </div>
      </div>
      ${pageTop(entry ? `Edit ${formatDate(entry.date)}` : 'Today’s Entry')}
      <section class="card toolbar">
        <div class="field">
          <label for="workout-date">Date</label>
          <input id="workout-date" type="date" value="${escapeHtml(entry?.date ?? today())}" />
        </div>
        <div class="field">
          <label for="workout-split">Workout split</label>
          <select id="workout-split">
            ${['push', 'pull', 'leg'].map((split) => `<option value="${split}" ${entry?.split === split ? 'selected' : ''}>${split}</option>`).join('')}
          </select>
        </div>
      </section>

      <section class="card table-card">
        <p class="section-title">Exercises</p>
        <div class="table-wrap">
          <table class="workout-table">
            <thead>
              <tr><th>Name</th><th>Reps for each set</th><th>Weights for each set</th><th></th></tr>
            </thead>
            <tbody id="exercise-body">${rows.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        <div class="actions" style="justify-content:flex-start; padding-top:10px;">
          <button class="btn" type="button" data-action="add-row">+ Add exercise</button>
        </div>
      </section>

      <div class="actions">
        ${entry ? '<button class="btn danger" type="button" data-action="delete-entry">Delete entry</button>' : ''}
        ${entry ? '<button class="btn" type="button" data-action="new-entry">New entry</button>' : ''}
        <button class="btn primary" type="button" data-action="save-entry">Save</button>
      </div>
    </main>`;
}

function formatDate(dateText) {
  const [y, m, d] = dateText.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d));
}

function homePage() {
  state.page = 'home';
  state.editingId = null;
  app.innerHTML = `
    <main class="shell">
      <div class="header">
        <div class="brand">
          <h1>Gym Progress Tracker</h1>
          <p>Simple, local and offline-friendly.</p>
        </div>
      </div>
      <section class="home-grid">
        <button class="home-card" data-action="previous">
          <div class="icon">📚</div>
          <h2>Previous entries</h2>
          <p>View and edit workouts you have already saved.</p>
        </button>
        <button class="home-card" data-action="today">
          <div class="icon">📝</div>
          <h2>Today’s entry</h2>
          <p>Record today’s exercises, reps and weights.</p>
        </button>
        <button class="home-card" data-action="export">
          <div class="icon">💾</div>
          <h2>Export data</h2>
          <p>Save a SQLite database backup or JSON copy.</p>
        </button>
      </section>
    </main>`;
}

function previousPage() {
  state.page = 'previous';
  state.editingId = null;
  const entries = listEntries();
  app.innerHTML = `
    <main class="shell">
      <div class="header">
        <div class="brand"><h1>Gym Progress Tracker</h1><p>Your saved workout history.</p></div>
      </div>
      ${pageTop('Previous Entries')}
      ${entries.length ? `<section class="entries">${entries.map((entry) => `
        <button class="entry-row" data-entry-id="${entry.id}">
          <div>
            <div class="entry-date">${escapeHtml(formatDate(entry.date))}</div>
            <div class="entry-meta">${entry.exercise_count} exercise${Number(entry.exercise_count) === 1 ? '' : 's'}</div>
          </div>
          <span class="split-pill">${escapeHtml(entry.split)}</span>
        </button>`).join('')}</section>` : '<section class="card empty">No saved entries yet.</section>'}
    </main>`;
}

function exportPage() {
  state.page = 'export';
  state.editingId = null;
  const count = listEntries().length;
  app.innerHTML = `
    <main class="shell">
      <div class="header">
        <div class="brand"><h1>Gym Progress Tracker</h1><p>Create backups of your local workout data.</p></div>
      </div>
      ${pageTop('Export Data')}
      <section class="export-grid">
        <article class="card export-item">
          <h3>SQLite database</h3>
          <p>${count} saved entr${count === 1 ? 'y' : 'ies'}. This exports the actual SQLite database.</p>
          <button class="btn primary" data-action="export-sqlite">Download .sqlite3</button>
        </article>
        <article class="card export-item">
          <h3>JSON backup</h3>
          <p>A readable backup containing your dates, splits, exercises, reps and weights.</p>
          <button class="btn" data-action="export-json">Download .json</button>
        </article>
      </section>
    </main>`;
}

function collectRows() {
  return [...document.querySelectorAll('#exercise-body tr')].map((tr) => ({
    name: tr.querySelector('[data-field="name"]').value,
    reps: tr.querySelector('[data-field="reps"]').value,
    weights: tr.querySelector('[data-field="weights"]').value,
  }));
}

async function saveCurrentEntry() {
  const date = document.querySelector('#workout-date').value;
  const split = document.querySelector('#workout-split').value;
  const rows = collectRows();
  const id = await saveEntry({ id: state.editingId, date, split, rows });
  state.editingId = id;
  showStatus('Entry saved');
  entryEditor(getEntry(id));
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(text, filename) {
  downloadBytes(new TextEncoder().encode(text), filename, 'application/json');
}

function routeHome() {
  homePage();
}

app.addEventListener('click', async (event) => {
  const actionTarget = event.target.closest('[data-action]');
  const entryTarget = event.target.closest('[data-entry-id]');

  try {
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === 'home') return routeHome();
      if (action === 'previous') return previousPage();
      if (action === 'today') return entryEditor();
      if (action === 'export') return exportPage();
      if (action === 'new-entry') return entryEditor();
      if (action === 'add-row') {
        document.querySelector('#exercise-body').insertAdjacentHTML('beforeend', rowHtml());
        return;
      }
      if (action === 'save-entry') {
        await saveCurrentEntry();
        return;
      }
      if (action === 'delete-entry') {
        if (!state.editingId) return;
        if (!confirm('Delete this workout entry?')) return;
        await deleteEntry(state.editingId);
        showStatus('Entry deleted');
        previousPage();
        return;
      }
      if (action === 'export-sqlite') {
        await persistDb();
        downloadBytes(exportDatabase(), `gym-tracker-${today()}.sqlite3`, 'application/x-sqlite3');
        showStatus('SQLite backup created');
        return;
      }
      if (action === 'export-json') {
        const payload = JSON.stringify(exportJSON(), null, 2);
        downloadText(payload, `gym-tracker-${today()}.json`);
        showStatus('JSON backup created');
      }
    }

    if (entryTarget) {
      entryEditor(getEntry(Number(entryTarget.dataset.entryId)));
    }

    if (event.target.closest('.remove-row')) {
      const tr = event.target.closest('tr');
      const tbody = document.querySelector('#exercise-body');
      if (tbody.children.length > 1) tr.remove();
      else showStatus('Keep at least one row');
    }
  } catch (error) {
    console.error(error);
    showStatus(error.message || 'Something went wrong', true);
  }
});

await initDb();
homePage();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker registration failed:', error));
}
