/** Inline HTML/CSS/JS for the dashboard — zero external dependencies */
export function getDashboardHtml(wsPort: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<title>OpenVole Dashboard</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --surface-hover: #181825;
    --border: #1e1e2e;
    --text: #c9d1d9;
    --text-dim: #6e7681;
    --accent: #58a6ff;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --orange: #db6d28;
    --mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    display: flex;
    flex-direction: column;
  }
  header {
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .logo-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo-group img {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }
  header h1 {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  header h1 span { color: var(--accent); }
  .header-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .stats {
    display: flex;
    gap: 16px;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--text-dim);
  }
  .stat-val { color: var(--accent); font-weight: 600; }
  .stat-val.stat-green { color: var(--green); }
  .stat-val.stat-blue { color: var(--accent); }
  .stat-val.stat-yellow { color: var(--yellow); }
  .stat-val.stat-red { color: var(--red); }
  .stat-sep { color: var(--border); margin: 0 2px; }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--red);
  }
  .status-dot.connected { background: var(--green); }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    background: var(--border);
    overflow: hidden;
  }
  .panel.span-2 {
    grid-column: span 2;
  }
  .panel {
    background: var(--surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-header {
    padding: 12px 16px 8px;
    flex-shrink: 0;
  }
  .panel-header h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 500;
  }
  .panel-header h2 .count {
    color: var(--accent);
    font-family: var(--mono);
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 12px;
  }
  .panel-body::-webkit-scrollbar { width: 6px; }
  .panel-body::-webkit-scrollbar-track { background: var(--bg); }
  .panel-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  .panel-body::-webkit-scrollbar-thumb:hover { background: #555; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--text-dim);
    padding: 4px 8px 4px 0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    background: var(--surface);
    z-index: 1;
  }
  td {
    padding: 4px 8px 4px 0;
    font-family: var(--mono);
    font-size: 11px;
    border-top: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-family: var(--mono);
  }
  .tag-green { background: #1b3a2a; color: var(--green); }
  .tag-red { background: #3a1b1b; color: var(--red); }
  .tag-yellow { background: #3a2e1b; color: var(--yellow); }
  .tag-blue { background: #1b2a3a; color: var(--accent); }
  .tag-orange { background: #3a2a1b; color: var(--orange); }
  .events-bar {
    background: var(--surface);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 200px;
    flex-shrink: 0;
  }
  .events-header {
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .events-header h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 500;
  }
  .events-header button {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--mono);
  }
  .events-header button:hover { border-color: var(--text-dim); }
  .events-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 8px;
  }
  .events-body::-webkit-scrollbar { width: 6px; }
  .events-body::-webkit-scrollbar-track { background: var(--bg); }
  .events-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  .events-body::-webkit-scrollbar-thumb:hover { background: #555; }
  .event-line {
    font-family: var(--mono);
    font-size: 11px;
    padding: 2px 0;
    color: var(--text-dim);
    border-bottom: 1px solid #111118;
    display: flex;
    gap: 8px;
  }
  .event-line .time { color: #444; flex-shrink: 0; }
  .event-line .name { color: var(--accent); flex-shrink: 0; }
  .event-line .data { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-line.rate-limited .name { color: var(--orange); }
  .event-line.task-failed .name { color: var(--red); }
  .empty { color: var(--text-dim); font-style: italic; font-size: 12px; padding: 8px 0; }
  @media (max-width: 1000px) {
    .grid { grid-template-columns: 1fr 1fr; }
    .panel.span-2 { grid-column: span 2; }
  }
  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
    .panel.span-2 { grid-column: span 1; }
    .panel { min-height: 150px; }
  }
</style>
</head>
<body>
<header>
  <div class="logo-group">
    <img src="/assets/vole.png" alt="OpenVole" onerror="this.style.display='none'">
    <h1><span>Open</span>Vole</h1>
  </div>
  <div class="header-right">
    <div class="stats">
      <span><span class="stat-val" id="stat-paws">0</span> paws</span>
      <span><span class="stat-val" id="stat-tools">0</span> tools</span>
      <span><span class="stat-val" id="stat-skills">0</span> skills</span>
      <span class="stat-sep">|</span>
      <span><span class="stat-val stat-green" id="stat-completed">0</span> completed</span>
      <span><span class="stat-val stat-blue" id="stat-running">0</span> running</span>
      <span><span class="stat-val stat-yellow" id="stat-queued">0</span> queued</span>
      <span><span class="stat-val stat-red" id="stat-failed">0</span> failed</span>
    </div>
    <div class="status">
      <div class="status-dot" id="ws-dot"></div>
      <span id="ws-status">Connecting...</span>
    </div>
  </div>
</header>

<div class="main">
  <div class="grid">
    <div class="panel">
      <div class="panel-header"><h2>Paws <span class="count" id="paws-count">0</span></h2></div>
      <div class="panel-body">
        <table id="paws-table">
          <thead><tr><th>Name</th><th>Type</th><th>Tools</th><th>Health</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><h2>Tools <span class="count" id="tools-count">0</span></h2></div>
      <div class="panel-body">
        <table id="tools-table">
          <thead><tr><th>Name</th><th>Paw</th><th>Type</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><h2>Skills <span class="count" id="skills-count">0</span></h2></div>
      <div class="panel-body">
        <table id="skills-table">
          <thead><tr><th>Name</th><th>Status</th><th>Missing</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="panel span-2">
      <div class="panel-header"><h2>Tasks <span class="count" id="tasks-count">0</span></h2></div>
      <div class="panel-body">
        <table id="tasks-table">
          <thead><tr><th>ID</th><th>Source</th><th>Input</th><th>Status</th><th>Time</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><h2>Schedules <span class="count" id="schedules-count">0</span></h2></div>
      <div class="panel-body">
        <table id="schedules-table">
          <thead><tr><th>ID</th><th>Input</th><th>Cron</th><th>Next Run</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="events-bar">
    <div class="events-header">
      <h2>Live Events</h2>
      <button onclick="document.getElementById('event-log').innerHTML=''">Clear</button>
    </div>
    <div class="events-body" id="event-log"></div>
  </div>
</div>

<script>
const ws = new WebSocket('ws://' + location.hostname + ':' + ${wsPort} + '/ws');
const dot = document.getElementById('ws-dot');
const statusText = document.getElementById('ws-status');
const eventLog = document.getElementById('event-log');
const MAX_EVENTS = 500;

ws.onopen = () => {
  dot.classList.add('connected');
  statusText.textContent = 'Connected';
};
ws.onclose = () => {
  dot.classList.remove('connected');
  statusText.textContent = 'Disconnected';
  setTimeout(() => location.reload(), 3000);
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'state') {
    const d = msg.data;
    renderPaws(d.paws || []);
    renderTools(d.tools || []);
    renderSkills(d.skills || []);
    renderTasks(d.tasks || []);
    renderSchedules(d.schedules || []);
    document.getElementById('stat-paws').textContent = (d.paws || []).length;
    document.getElementById('stat-tools').textContent = (d.tools || []).length;
    document.getElementById('stat-skills').textContent = (d.skills || []).length;
    // Task breakdown by status
    const tasks = d.tasks || [];
    document.getElementById('stat-completed').textContent = tasks.filter(t => t.status === 'completed').length;
    document.getElementById('stat-running').textContent = tasks.filter(t => t.status === 'running').length;
    document.getElementById('stat-queued').textContent = tasks.filter(t => t.status === 'queued').length;
    document.getElementById('stat-failed').textContent = tasks.filter(t => t.status === 'failed' || t.status === 'cancelled').length;
  } else if (msg.type === 'event') {
    addEvent(msg.event, msg.data);
  }
};

function renderPaws(paws) {
  document.getElementById('paws-count').textContent = paws.length;
  const tbody = document.querySelector('#paws-table tbody');
  tbody.innerHTML = paws.length === 0
    ? '<tr><td colspan="4" class="empty">No paws loaded</td></tr>'
    : paws.map(p => '<tr>'
      + '<td title="' + esc(p.name) + '">' + esc(p.name) + '</td>'
      + '<td><span class="tag tag-blue">' + (p.inProcess ? 'in-process' : 'subprocess') + '</span></td>'
      + '<td>' + (p.toolCount ?? 0) + '</td>'
      + '<td>' + (p.healthy ? '<span class="tag tag-green">ok</span>' : '<span class="tag tag-red">down</span>') + '</td>'
      + '</tr>').join('');
}

function renderTools(tools) {
  document.getElementById('tools-count').textContent = tools.length;
  const tbody = document.querySelector('#tools-table tbody');
  tbody.innerHTML = tools.length === 0
    ? '<tr><td colspan="3" class="empty">No tools registered</td></tr>'
    : tools.map(t => '<tr>'
      + '<td title="' + esc(t.name) + '">' + esc(t.name) + '</td>'
      + '<td title="' + esc(t.pawName) + '">' + esc(t.pawName) + '</td>'
      + '<td><span class="tag tag-blue">' + (t.inProcess ? 'in-process' : 'subprocess') + '</span></td>'
      + '</tr>').join('');
}

function renderSkills(skills) {
  document.getElementById('skills-count').textContent = skills.length;
  const tbody = document.querySelector('#skills-table tbody');
  tbody.innerHTML = skills.length === 0
    ? '<tr><td colspan="3" class="empty">No skills loaded</td></tr>'
    : skills.map(s => '<tr>'
      + '<td title="' + esc(s.name) + '">' + esc(s.name) + '</td>'
      + '<td>' + (s.active ? '<span class="tag tag-green">active</span>' : '<span class="tag tag-red">inactive</span>') + '</td>'
      + '<td>' + (s.missingTools?.length ? esc(s.missingTools.join(', ')) : '\\u2014') + '</td>'
      + '</tr>').join('');
}

function renderTasks(tasks) {
  // Sort: running first, then queued, then completed/failed (most recent first)
  const sorted = [...tasks].sort((a, b) => {
    const order = { running: 0, queued: 1, completed: 2, failed: 3, cancelled: 4 };
    const oa = order[a.status] ?? 5;
    const ob = order[b.status] ?? 5;
    if (oa !== ob) return oa - ob;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  document.getElementById('tasks-count').textContent = tasks.length;
  const tbody = document.querySelector('#tasks-table tbody');
  tbody.innerHTML = sorted.length === 0
    ? '<tr><td colspan="5" class="empty">No tasks</td></tr>'
    : sorted.map(t => {
      const elapsed = formatElapsed(t);
      const sourceTag = sourceClass(t.source);
      return '<tr>'
        + '<td>' + esc(t.id?.substring(0, 8) ?? '') + '</td>'
        + '<td><span class="tag ' + sourceTag + '">' + esc(t.source) + '</span></td>'
        + '<td title="' + esc(t.input || '') + '">' + esc((t.input ?? '').substring(0, 50)) + '</td>'
        + '<td><span class="tag ' + statusClass(t.status) + '">' + esc(t.status) + '</span></td>'
        + '<td>' + elapsed + '</td>'
        + '</tr>';
    }).join('');
}

function sourceClass(s) {
  if (s === 'user') return 'tag-blue';
  if (s === 'paw') return 'tag-green';
  if (s === 'heartbeat') return 'tag-yellow';
  if (s === 'schedule') return 'tag-orange';
  return 'tag-blue';
}

function formatElapsed(t) {
  if (t.status === 'running' && t.startedAt) {
    const ms = Date.now() - t.startedAt;
    return formatMs(ms) + '...';
  }
  if (t.completedAt && t.startedAt) {
    return formatMs(t.completedAt - t.startedAt);
  }
  if (t.status === 'queued') return 'waiting';
  return '\\u2014';
}

function formatMs(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

function renderSchedules(schedules) {
  document.getElementById('schedules-count').textContent = schedules.length;
  const tbody = document.querySelector('#schedules-table tbody');
  tbody.innerHTML = schedules.length === 0
    ? '<tr><td colspan="4" class="empty">No active schedules</td></tr>'
    : schedules.map(s => {
      const nextRun = s.nextRun ? new Date(s.nextRun).toLocaleString() : '\\u2014';
      return '<tr>'
        + '<td>' + esc(s.id) + '</td>'
        + '<td title="' + esc(s.input) + '">' + esc((s.input || '').substring(0, 40)) + '</td>'
        + '<td><span class="tag tag-yellow">' + esc(s.cron) + '</span></td>'
        + '<td>' + nextRun + '</td>'
        + '</tr>';
    }).join('');
}

function statusClass(s) {
  if (s === 'completed') return 'tag-green';
  if (s === 'running') return 'tag-blue';
  if (s === 'failed' || s === 'cancelled') return 'tag-red';
  return 'tag-yellow';
}

function addEvent(name, data) {
  const el = document.createElement('div');
  el.className = 'event-line';
  if (name === 'rate:limited') el.className += ' rate-limited';
  if (name === 'task:failed') el.className += ' task-failed';
  const time = new Date().toLocaleTimeString();
  const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data || '');
  el.innerHTML = '<span class="time">' + time + '</span>'
    + '<span class="name">' + esc(name) + '</span>'
    + '<span class="data">' + esc(dataStr) + '</span>';
  eventLog.prepend(el);
  while (eventLog.children.length > MAX_EVENTS) eventLog.lastChild.remove();
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
</script>
</body>
</html>`;
}
