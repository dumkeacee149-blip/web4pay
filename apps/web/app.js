const $ = (id) => document.getElementById(id);

const DEMO_REPORT_STORAGE_KEY = 'web4pay_demo_reports_v1';
const MAX_DEMO_REPORTS = 10;
const AGENT_STORAGE_KEY = 'web4pay_default_agent_id';
const AGENT_ONLY_MODE = true;
const UI_ROLE_STORAGE_KEY = 'web4pay_ui_role';


const state = {
  apiBase: localStorage.getItem('web4pay_api_base') || 'http://127.0.0.1:3000',
  token: localStorage.getItem('web4pay_token') || 'dev-token-1',
  agentId: '',
  agentWallet: '',
  quoteId: '',
  escrowId: '',
  lastReleaseStatus: '',
  lastDemoReport: null,
  demoReports: [],
  logLines: [],
  yieldBalance: '',
  yieldSymbol: 'YIELD',
  yieldRateText: 'Yield rate (demo annualized): loading...',
  yieldTotalMinted: '',
  baseLaunched: false,
  yieldRedeemable: false,
  styleMode: (localStorage.getItem('web4pay_style_mode') === 'intense' ? 'intense' : 'subtle'),
};

const stepElements = {
  agent: $('step-agent'),
  quote: $('step-quote'),
  escrow: $('step-escrow'),
  release: $('step-release'),
};

function shouldShowAdminPanels() {
  const params = new URLSearchParams(window.location.search);
  const adminQuery = params.get('admin');

  if (adminQuery === '1') {
    localStorage.setItem(UI_ROLE_STORAGE_KEY, 'admin');
  } else if (adminQuery === '0') {
    localStorage.removeItem(UI_ROLE_STORAGE_KEY);
  }

  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocalHost) return true;

  const role = localStorage.getItem(UI_ROLE_STORAGE_KEY) || '';
  return role === 'admin';
}

function applyAdminPanelVisibility() {
  const visible = shouldShowAdminPanels();
  const nodes = document.querySelectorAll('.demo-admin-only');
  nodes.forEach((el) => {
    el.classList.toggle('hidden-by-role', !visible);
  });
}

function setBusy(isBusy) {
  const buttons = document.querySelectorAll('.pixel-btn');
  buttons.forEach((btn) => {
    btn.disabled = isBusy;
  });

  if (isBusy) {
    document.body.classList.add('running');
    setToast('Action in progress...', 'loading');
  } else {
    document.body.classList.remove('running');
  }
}


const ROBOT_STATE_CLASS_PREFIX = 'robot-state-';
const ROBOT_STATE_CLASSES = ['idle', 'agent', 'quote', 'escrow', 'release', 'success', 'error'];

function setRobotState(state = 'idle') {
  const normalized = ROBOT_STATE_CLASSES.includes(state) ? state : 'idle';
  const ids = ['retroRobotWrap', 'cornerRobotWrap', 'cornerRobot'];

  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    for (const stateName of ROBOT_STATE_CLASSES) {
      el.classList.remove(`${ROBOT_STATE_CLASS_PREFIX}${stateName}`);
    }
    el.classList.add(`${ROBOT_STATE_CLASS_PREFIX}${normalized}`);
  });
}

function setStep(name) {
  Object.values(stepElements).forEach((el) => el.classList.remove('active'));
  if (name && stepElements[name]) {
    stepElements[name].classList.add('active');
    const map = {
      agent: 'agent',
      quote: 'quote',
      escrow: 'escrow',
      release: 'release',
    };
    setRobotState(map[name] || 'idle');
  }
}


function triggerRobotWink(message = 'Got it') {
  const wrap = $('retroRobotWrap');
  const cornerWrap = $('cornerRobot');
  const bubble = $('robotSpeech');
  if (!wrap && !cornerWrap) return;

  if (bubble) {
    bubble.textContent = message;
    bubble.hidden = false;
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    bubble.classList.add('show');
  }
  if (wrap) {
    wrap.classList.remove('robot-wink');
    // reflow to allow re-trigger
    void wrap.offsetWidth;
    wrap.classList.add('robot-wink');
  }
  if (cornerWrap) {
    cornerWrap.classList.remove('robot-wink');
    void cornerWrap.offsetWidth;
    cornerWrap.classList.add('robot-wink');
  }

  window.setTimeout(() => {
    if (wrap) wrap.classList.remove('robot-wink');
    if (cornerWrap) cornerWrap.classList.remove('robot-wink');
    if (bubble) bubble.classList.remove('show');
    if (bubble) bubble.hidden = true;
  }, 800);
}

function setStatusProgress(percent, tagText = 'Waiting to Start', kind = 'default') {
  const fill = $('statusFill');
  const tag = $('statusTag');
  const sum = $('statusSummary');

  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  tag.className = `status-chip ${kind}`;
  tag.textContent = tagText;

  if (sum) {
    sum.textContent = `${Math.round(percent)}% · ${tagText}`;
  }
}

function setToast(message, kind = '') {
  const t = $('resultToast');
  t.className = 'toast' + (kind ? ` ${kind}` : '');
  t.innerHTML = `${message} ${kind === 'loading' ? '<span class="dot"></span>' : ''}`;
}


function downloadDemoReport() {
  if (!state.lastDemoReport) {
    setToast('Run one-click demo before exporting report', 'warn');
    return;
  }

  const payload = {
    ...state.lastDemoReport,
    token: state.lastDemoReport?.tokenMask || '***',
    exportedAt: new Date().toISOString(),
  };

  downloadPayload(payload, `web4pay-demo-report-${Date.now()}.json`);
}

function getAgentNameBase() {
  return $('agentName').value.trim() || 'agent';
}

function isDuplicateAgentError(errorText) {
  return /agents_tenant_id_name_key|duplicate key value/.test(errorText);
}

async function createAgentRobust({ name, retries = 3 }) {
  let lastError;
  for (let idx = 0; idx < retries; idx++) {
    const payloadName = idx === 0 ? name : `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const idempotencyKey = randomId('agent');
    try {
      return await request('/v1/agents', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ name: payloadName }),
        retries: 2,
      });
    } catch (err) {
      lastError = err;
      if (!isDuplicateAgentError(err.message || '')) {
        throw err;
      }
      if (idx < retries - 1) {
        log(`Duplicate agent name, retrying: ${payloadName}`);
        continue;
      }
    }
  }
  throw lastError;
}


function getStoredDefaultAgentId() {
  try {
    return localStorage.getItem(AGENT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredDefaultAgentId(agentId) {
  try {
    localStorage.setItem(AGENT_STORAGE_KEY, agentId);
  } catch {
    // ignore
  }
}

function applyAgentOnlyView() {
  ['agentName', 'orderId', 'payee', 'amount'].forEach((id) => {
    const el = $(id);
    if (el) el.setAttribute('readonly', 'readonly');
  });

  ['createAgent', 'createQuote', 'createEscrow', 'markDeposited', 'releaseEscrow'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.disabled = true;
      el.title = 'Agent-Only mode: only one-click flow is allowed';
    }
  });

  const run = $('runDemo');
  const runM = $('runDemoMobile');
  if (run) run.disabled = false;
  if (runM) runM.disabled = false;

  const modeBadge = $('modeBadge');
  if (modeBadge) {
    modeBadge.textContent = AGENT_ONLY_MODE ? 'Agent-Only' : 'Manual';
  }
}
function showResultModal(message, success = true) {
  const modal = $('resultModal');
  const resultText = $('resultText');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  modal.style.display = 'flex';
  resultText.textContent = message;
  resultText.style.color = success ? '#98ffbe' : '#ff95a8';
}

function hideResultModal() {
  const modal = $('resultModal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  modal.style.display = '';
}

function downloadPayload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  const safe = text.replace(/"/g, '""');
  if (/[",]/.test(safe)) {
    return `"${safe}"`;
  }
  return safe;
}

function reportToCsvRows(report) {
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const chainName = report.chain?.name || '';
  const chainId = report.chain?.chainId || '';
  const stepCount = steps.length;
  const okSteps = steps.filter((s) => s && s.ok === true).length;
  const failSteps = steps.filter((s) => s && s.ok === false).length;
  const rows = [
    ['kind', 'value'],
    ['escrowId', report.escrowId || ''],
    ['agentId', report.agentId || ''],
    ['quoteId', report.quoteId || ''],
    ['apiBase', report.apiBase || ''],
    ['chainName', chainName],
    ['chainId', chainId],
    ['startedAt', report.startedAt || ''],
    ['finishedAt', report.finishedAt || report.completedAt || ''],
    ['success', report.success ? 'true' : 'false'],
    ['totalSteps', String(stepCount)],
    ['successfulSteps', String(okSteps)],
    ['failedSteps', String(failSteps)],
    ['logDigestCount', String((report.logDigest || []).length)],
  ];

  rows.push(['stepsJson', JSON.stringify(steps)]);
  rows.push([]);
  rows.push(['stepIndex', 'stepName', 'ok', 'statusOrValue', 'raw']);
  steps.forEach((step, idx) => {
    const statusOrValue = step.status || step.error || step.orderId || step.escrowId || step.quoteId || '';
    rows.push([
      String(idx + 1),
      step.step || '',
      step.ok === true ? 'true' : step.ok === false ? 'false' : '',
      statusOrValue,
      JSON.stringify(step),
    ]);
  });

  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

function downloadDemoReportCsv() {
  if (!state.lastDemoReport) {
    setToast('Run one-click demo before exporting CSV report', 'warn');
    return;
  }

  const csv = reportToCsvRows(state.lastDemoReport);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `web4pay-demo-report-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadDemoReportPayloadAsCsv(report, suffix) {
  const csv = reportToCsvRows(report);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `web4pay-demo-report-${suffix}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function getStoredDemoReports() {
  try {
    const raw = localStorage.getItem(DEMO_REPORT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistDemoReports() {
  try {
    localStorage.setItem(DEMO_REPORT_STORAGE_KEY, JSON.stringify(state.demoReports.slice(0, MAX_DEMO_REPORTS)));
  } catch {
    // ignore
  }
}

function log(line) {
  const out = $('log');
  const now = new Date().toLocaleTimeString();
  const row = `[${now}] ${line}`;
  state.logLines.unshift(row);
  state.logLines = state.logLines.slice(0, 120);
  out.textContent = `${row}\n${out.textContent}`;
  if (out.textContent.length > 30000) {
    out.textContent = out.textContent.slice(0, 25000);
  }
}

function renderDemoReportHistory() {
  const list = $('reportList');
  list.textContent = '';

  if (!state.demoReports.length) {
    const tip = document.createElement('div');
    tip.className = 'line';
    tip.textContent = 'No reports yet';
    list.appendChild(tip);
    return;
  }

  state.demoReports.forEach((item, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'line';

    const text = document.createElement('div');
    text.className = 'meta';
    text.innerHTML = `${item.success ? '✅' : '❌'} ${item.finishedAt || item.startedAt} <small>(${item.escrowId || 'N/A'})</small>`;

    const btnRow = document.createElement('div');
    btnRow.className = 'row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pixel-btn';
    btn.style.minHeight = '32px';
    btn.textContent = 'Download JSON';
    btn.addEventListener('click', () => downloadPayload(item, `web4pay-demo-report-${idx}-${Date.now()}.json`));

    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'pixel-btn warn';
    csvBtn.style.minHeight = '32px';
    csvBtn.textContent = 'Download CSV';
    csvBtn.addEventListener('click', () => downloadDemoReportPayloadAsCsv(item, `report-${idx}`));

    btnRow.appendChild(btn);
    btnRow.appendChild(csvBtn);

    wrapper.appendChild(text);
    wrapper.appendChild(btnRow);
    list.appendChild(wrapper);
  });
}


function applyStyleMode() {
  const mode = state.styleMode === 'intense' ? 'intense' : 'subtle';
  document.body.classList.remove('pixel-style-subtle', 'pixel-style-intense');
  document.body.classList.add(`pixel-style-${mode}`);
  const btn = $('styleModeToggle');
  if (btn) {
    btn.textContent = mode === 'intense' ? '🎨 Style: Intense' : '🎨 Style: Subtle';
  }
  localStorage.setItem('web4pay_style_mode', mode);
}

function updateUi() {
  const modeBadge = $('modeBadge');
  if (modeBadge) modeBadge.textContent = AGENT_ONLY_MODE ? 'Agent-Only' : 'Manual';
  $('apiBase').value = state.apiBase;
  $('token').value = state.token;
  $('apiBaseLabel').textContent = state.apiBase;
  $('agentId').value = state.agentId || '';
  const walletEl = $('agentWallet');
  if (walletEl) walletEl.value = state.agentWallet || '';
  const yieldEl = $('yieldBalance');
  if (yieldEl) {
    const bal = state.yieldBalance !== '' ? state.yieldBalance : 'Not queried';
    yieldEl.value = bal;
  }
  const rateHint = $('yieldRateHint');
  if (rateHint) {
    rateHint.textContent = state.yieldRateText;
  }
  $('quoteId').value = state.quoteId || '';
  $('escrowId').value = state.escrowId || '';
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
  };
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function request(path, options = {}) {
  const staticIdempotencyKey = options.idempotencyKey || randomId('req');
  const headers = {
    ...(options.headers || {}),
    ...authHeaders(),
    'X-Actor': 'agent',
    'Idempotency-Key': staticIdempotencyKey,
  };

  const retries = Number(options.retries || 0);
  let attempt = 0;

  while (true) {
    attempt += 1;
    const resp = await fetch(`${state.apiBase}${path}`, {
      ...options,
      headers,
    });

    const text = await resp.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep text
    }

    if (resp.ok) {
      const m = String(options.method || request.method || 'GET').toUpperCase();
      if (m !== 'GET') {
        triggerRobotWink(`${m} ${path}`);
      }
      return body;
    }

    const isRetryable = resp.status >= 500 && attempt <= retries;
    if (isRetryable) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      continue;
    }

    const msg = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    throw new Error(msg || `HTTP ${resp.status}`);
  }
}

function mapEscrowStatusToProgress(status) {
  switch (status) {
    case 'TX_PENDING_DEPOSIT': return { p: 45, kind: 'warn', tag: 'In Escrow (deposit submitted)' };
    case 'DEPOSITED': return { p: 55, kind: 'success', tag: 'Escrow deposit confirmed' };
    case 'TX_PENDING_RELEASE': return { p: 75, kind: 'warn', tag: 'Pending release transaction' };
    case 'RELEASED': return { p: 100, kind: 'success', tag: 'Release completed' };
    case 'TX_PENDING_REFUND': return { p: 75, kind: 'warn', tag: 'Refund in progress' };
    case 'REFUNDED': return { p: 100, kind: 'warn', tag: 'Refunded' };
    case 'FAILED': return { p: 100, kind: 'error', tag: 'Flow failed' };
    default: return { p: 30, kind: '', tag: 'Escrow created' };
  }
}

async function refreshEscrow() {
  if (!state.escrowId) return;
  try {
    const data = await request(`/v1/escrows/${state.escrowId}`, { method: 'GET', headers: {}, retries: 2 });
    $('escrowInfo').textContent = JSON.stringify(data, null, 2);

    if (data && data.status) {
      const mapped = mapEscrowStatusToProgress(data.status);
      setStatusProgress(mapped.p, mapped.tag, mapped.kind);
      setToast(`Current status: ${data.status}`, data.status === 'RELEASED' ? 'success' : '');
      state.lastReleaseStatus = data.status;
      if (data.status === 'RELEASED') {
        setStep('release');
        setRobotState('success');
        setToast('Status confirmed: RELEASED', 'success');
      }
    }

    return data;
  } catch (err) {
    setRobotState('error');
    $('escrowInfo').textContent = `Query failed: ${err.message}`;
    return null;
  }
}

async function ensureAgentForDemo() {
  const saved = getStoredDefaultAgentId();
  if (saved) {
    state.agentId = saved;
    await refreshAgentWallet();
    await refreshYieldBalance().catch(() => {});
    await refreshYieldRateConfig().catch(() => {});
    return state.agentId;
  }

  const agent = await createAgentRobust({
    name: `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    retries: 3,
  });
  state.agentId = agent.agentId;
  setStoredDefaultAgentId(state.agentId);
  setWalletFromResponse(agent);
  return state.agentId;
}

function bindClick(id, handler) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('click', handler);
}

function resetDemo() {
  state.agentId = '';
  state.agentWallet = '';
  state.quoteId = '';
  state.escrowId = '';
  state.lastReleaseStatus = '';
  state.yieldBalance = '';
  $('agentId').value = '';
  $('quoteId').value = '';
  $('escrowId').value = '';
  $('escrowInfo').textContent = 'Escrow not created yet';
  setRobotState('idle');
  setToast('Flow reset', 'success');
  setStatusProgress(0, 'Flow reset', '');
  setStep(null);
  log('Demo state reset');
}

bindClick('saveConfig', () => {
  state.token = $('token').value.trim() || state.token;
  state.apiBase = $('apiBase').value.trim() || state.apiBase;
  state.token = $('token').value.trim() || state.token;
  localStorage.setItem('web4pay_api_base', state.apiBase);
  localStorage.setItem('web4pay_token', state.token);
  updateUi();
  $('chainState').textContent = 'Config saved';
  log('Config updated');
  setToast('Config saved', 'success');
});

bindClick('checkChain', async () => {
  setToast('Checking chain...', 'loading');
  setBusy(true);
  try {
    const data = await request('/v1/chain', { method: 'GET', headers: {} });
    $('chainInfo').textContent = JSON.stringify(data, null, 2);
    $('chainState').textContent = `Connected (${data.name}/${data.chainId})`;
    setToast('Chain check passed', 'success');
    setStatusProgress(15, 'Chain connected', 'success');
    log('Chain check passed');
  } catch (err) {
    $('chainInfo').textContent = `Failed: ${err.message}`;
    $('chainState').textContent = 'Chain failed';
    setToast('Chain check failed', 'error');
    setStatusProgress(0, 'Chain failed', 'error');
    log(`Chain failed: ${err.message}`);
  } finally {
    setBusy(false);
  }
});

bindClick('createAgent', async () => {
  if (AGENT_ONLY_MODE) {
    setToast('Agent-Only mode: manual create is disabled', 'warn');
    return;
  }
  const baseName = getAgentNameBase();
  const name = `${baseName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  setStep('agent');
  setToast('Creating Agent...', 'loading');
  setStatusProgress(25, 'Create Agent', 'warn');
  try {
    const data = await createAgentRobust({ name, retries: 3 });
    state.agentId = data.agentId;
    setWalletFromResponse(data);
    updateUi();
    log(`Agent created: ${state.agentId}`);
    await refreshYieldRateConfig().catch(() => {});
    setToast('Agent created', 'success');
    setStatusProgress(30, 'Agent created', 'success');
  } catch (err) {
    setToast('Create Agent failed', 'error');
    setStatusProgress(15, 'Create Agent failed', 'error');
    log(`Create Agent Failed: ${err.message}`);
  }
});

bindClick('createQuote', async () => {
  if (AGENT_ONLY_MODE) {
    setToast('Agent-Only mode: manual create is disabled', 'warn');
    return;
  }
  if (!state.agentId) {
    alert('Create Agent first');
    return;
  }

  const order = $('orderId').value.trim() || `order-${Date.now()}`;
  const payload = {
    payerAgentId: state.agentId,
    payeeAddress: $('payee').value.trim(),
    amount: String($('amount').value || '1'),
    currency: 'USDC',
    expiresInSec: 600,
    deadlineInSec: 3600,
    orderId: `${order}-${Date.now()}`,
  };
  setStep('quote');
  setStatusProgress(38, 'Create Quote', 'warn');
  setToast('Creating Quote...', 'loading');

  try {
    const data = await request('/v1/quotes', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('quote') },
      body: JSON.stringify(payload),
      retries: 2,
    });
    state.quoteId = data.quoteId;
    updateUi();
    log(`Quote created: ${state.quoteId}`);
    setToast('Quote created', 'success');
    setStatusProgress(42, 'Quote created', 'success');
  } catch (err) {
    setToast('Create Quote failed', 'error');
    setStatusProgress(30, 'Create Quote failed', 'error');
    log(`Create Quote Failed: ${err.message}`);
  }
});

bindClick('createEscrow', async () => {
  if (AGENT_ONLY_MODE) {
    setToast('Agent-Only mode: manual flow is disabled', 'warn');
    return;
  }
  if (!state.quoteId) {
    alert('Create Quote first');
    return;
  }
  setStep('escrow');
  setToast('Creating Escrow...', 'loading');
  setStatusProgress(52, 'Creating Escrow', 'warn');
  try {
    const data = await request('/v1/escrows', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('escrow') },
      body: JSON.stringify({ quoteId: state.quoteId }),
      retries: 2,
    });
    state.escrowId = data.escrowId;
    updateUi();
    log(`Escrow created: ${state.escrowId}`);
    await refreshEscrow();
    setToast('Escrow created', 'success');
  } catch (err) {
    setToast('Failed to create Escrow', 'error');
    setStatusProgress(42, 'Failed to create Escrow', 'error');
    log(`Failed to create Escrow: ${err.message}`);
  }
});

bindClick('markDeposited', async () => {
  if (AGENT_ONLY_MODE) {
    setToast('Agent-Only mode: manual deposit is disabled', 'warn');
    return;
  }
  if (!state.escrowId) return alert('Please create an Escrow first');
  setStatusProgress(65, 'Marking deposit', 'warn');
  setToast('Marking deposited...', 'loading');
  try {
    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
      retries: 2,
    });
    log(`Deposit marked manually: ${state.escrowId}`);
    await refreshEscrow();
    setToast('Deposit mark completed', 'success');
  } catch (err) {
    setToast('Failed to mark deposited', 'error');
    log(`Failed to mark deposited: ${err.message}`);
  }
});

bindClick('releaseEscrow', async () => {
  if (AGENT_ONLY_MODE) {
    setToast('Agent-Only mode: manual release is disabled', 'warn');
    return;
  }
  if (!state.escrowId) return alert('Please create an Escrow first');
  setStep('release');
  setToast('Starting release...', 'loading');
  setStatusProgress(80, 'Starting release', 'warn');
  try {
    const data = await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: `0x${Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0')}` }),
      retries: 2,
    });
    log(`Release started: status=${data.status}`);
    await refreshEscrow();
    setToast('Release started', 'success');
  } catch (err) {
    setToast('Release failed', 'error');
    log(`Release failed: ${err.message}`);
  }
});


function setWalletFromResponse(payload) {
  state.agentWallet = payload?.walletAddress || '';
}

async function refreshAgentWallet() {
  if (!state.agentId) return;
  try {
    const data = await request(`/v1/agents/${state.agentId}`, { method: 'GET', headers: {} });
    setWalletFromResponse(data);
    updateUi();
    log(`Agent wallet refreshed: ${state.agentWallet}`);
    refreshYieldBalance().catch(() => {});
    return data;
  } catch (err) {
    log(`Failed to refresh wallet: ${err.message}`);
    throw err;
  }
}

function normalizeHexAddr(addr) {
  return addr && typeof addr === 'string' ? addr.toLowerCase() : '';
}

function setWalletBadge(addr) {
  if (!addr) {
    setToast('Wallet not linked; cannot receive yield yet', 'warn');
    return;
  }
  setToast(`Yield wallet: ${addr.slice(0, 8)}...${addr.slice(-6)}`, 'success');
}


function normalizeYieldRecord(payload) {
  return {
    symbol: payload?.tokenSymbol || 'YIELD',
    balance: payload?.balance ?? payload?.amount ?? '0',
    totalMinted: payload?.totalMinted ?? '0',
    note: payload?.note || '',
  };
}

async function refreshYieldRateConfig() {
  try {
    const config = await request('/v1/yield/config', { method: 'GET', headers: {} });
    const bps = Number(config?.rateBps);
    state.baseLaunched = Boolean(config?.baseLaunched);
    state.yieldRedeemable = Boolean(config?.yieldRedeemable);
    if (Number.isFinite(bps) && bps >= 0) {
      state.yieldRateText = `Yield rate (demo annualized): ${(bps / 100).toFixed(2)}% (bps ${bps}) · Redeem ${state.yieldRedeemable ? 'enabled' : 'disabled'}`;
      log(`Yield config refreshed: ${state.yieldRateText}`);
    } else {
      state.yieldRateText = `Yield rate (demo annualized): 5.00% (500 bps, default) · Redeem ${state.yieldRedeemable ? 'enabled' : 'disabled'}`;
    }
    updateUi();
  } catch (err) {
    state.yieldRateText = 'Yield rate (demo annualized): failed to load';
    updateUi();
    throw err;
  }
}

async function refreshYieldBalance() {
  if (!state.agentId) {
    setToast('Create Agent before querying yield balance', 'warn');
    return;
  }
  try {
    const data = await request(`/v1/agents/${state.agentId}/yield`, { method: 'GET', headers: {} });
    const y = normalizeYieldRecord(data);
    state.yieldSymbol = y.symbol;
    state.yieldBalance = `${y.balance}`;
    state.yieldTotalMinted = `${y.totalMinted}`;
    updateUi();
    log(`Yield balance refreshed: ${state.yieldSymbol} ${state.yieldBalance}`);
    setToast(`Current yield: ${state.yieldSymbol} ${state.yieldBalance}`, 'success');
  } catch (err) {
    state.yieldBalance = 'Query failed';
    state.yieldTotalMinted = '';
    updateUi();
    throw err;
  }
}


async function connectWalletForAgent() {
  if (!state.agentId) {
    setToast('Create Agent before linking wallet', 'warn');
    return;
  }

  const provider = window.ethereum;
  if (!provider || typeof provider.request !== 'function') {
    const manual = prompt('Wallet extension not found. Enter wallet address to bind (0x...)');
    if (!manual) return;

    const walletAddress = manual.trim();
    setToast('Updating wallet address manually...', 'loading');
    try {
      await request(`/v1/agents/${state.agentId}/wallet`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': randomId('wallet-put') },
        body: JSON.stringify({ walletAddress }),
        retries: 1,
      });
      await refreshAgentWallet();
      setWalletBadge(normalizeHexAddr(walletAddress));
      setToast('Wallet linked manually', 'success');
    } catch (err) {
      setToast(`Failed to link wallet: ${err.message}`, 'error');
    }
    return;
  }

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const account = Array.isArray(accounts) && accounts[0] ? accounts[0] : '';
    if (!account) {
      setToast('No account received', 'warn');
      return;
    }
    await request(`/v1/agents/${state.agentId}/wallet`, {
      method: 'PUT',
      headers: { 'Idempotency-Key': randomId('wallet-put') },
      body: JSON.stringify({ walletAddress: account }),
      retries: 1,
    });
    state.agentWallet = account;
    updateUi();
    setWalletBadge(normalizeHexAddr(account));
    setToast('Wallet connected and linked', 'success');
  } catch (err) {
    setToast(`Wallet connection failed: ${err.message}`, 'error');
    log(`Connect wallet failed: ${err.message}`);
  }
}

bindClick('clearLog', () => {
  $('log').textContent = '';
  state.logLines = [];
  log('Logs cleared');
});

bindClick('downloadLog', () => {
  const blob = new Blob([$('log').textContent || ''], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `web4pay-log-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});

bindClick('refreshWallet', async () => {
  if (!state.agentId) {
    setToast('Create Agent before refreshing wallet', 'warn');
    return;
  }
  await refreshAgentWallet();
  setToast('Wallet info refreshed', 'success');
});

bindClick('refreshYield', async () => {
  await refreshYieldBalance();
  setToast('Yield balance refreshed', 'success');
});

async function withdrawYield() {
  if (!state.agentId) {
    setToast('Create Agent before withdrawing yield', 'warn');
    return;
  }

  await refreshYieldRateConfig().catch(() => {});
  if (!state.yieldRedeemable) {
    setToast('Yield withdraw is disabled until Base launch', 'warn');
    return;
  }

  const amountText = prompt('Withdraw YIELD amount (leave empty for full balance):', '');
  if (amountText === null) return;

  const payload = {};
  if (amountText.trim()) payload.amount = amountText.trim();

  setToast('Withdrawing yield...', 'loading');
  try {
    const data = await request(`/v1/agents/${state.agentId}/yield/withdraw`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('yield-withdraw') },
      body: JSON.stringify(payload),
      retries: 1,
    });

    await refreshYieldBalance();
    setToast(`Yield withdrawn: ${data.withdrawnAmount}`, 'success');
    log(`Yield withdrawn: ${data.withdrawnAmount}, remaining: ${data.remainingBalance}`);
  } catch (err) {
    setToast(`Yield withdraw failed: ${err.message}`, 'error');
    log(`Yield withdraw failed: ${err.message}`);
  }
}

bindClick('withdrawYield', withdrawYield);
bindClick('connectWallet', connectWalletForAgent);
bindClick('styleModeToggle', () => {
  state.styleMode = state.styleMode === 'intense' ? 'subtle' : 'intense';
  applyStyleMode();
  setToast(`Switched to ${state.styleMode === 'intense' ? 'Intense' : 'Subtle'} style`, 'success');
});

bindClick('refreshState', async () => {
  if (!state.escrowId) {
    setToast('Create Escrow before refreshing', 'warn');
    return;
  }
  await refreshEscrow();
  setToast('Status refreshed', 'success');
});

bindClick('resetDemo', resetDemo);
bindClick('downloadDemoReport', downloadDemoReport);
bindClick('downloadDemoReportCsv', downloadDemoReportCsv);
bindClick('modalClose', hideResultModal);
bindClick('runDemo', runDemo);
bindClick('runDemoMobile', runDemo);

async function runDemo() {
  setBusy(true);
  setStep('agent');
  setStatusProgress(5, 'Starting demo', 'loading');
  setRobotState('agent');
  setToast('Starting auto demo...', 'loading');
  triggerRobotWink('Starting one-click demo 🚀');
  const report = {
    startedAt: new Date().toISOString(),
    apiBase: state.apiBase,
    token: state.token,
    tokenMask: state.token ? `***${state.token.slice(-4)}` : '',
    steps: [],
    logDigestStart: state.logLines.length,
  };
  try {
    const chain = await request('/v1/chain', { method: 'GET', headers: {}, retries: 2 });
    report.chain = chain;
    report.steps.push({ step: 'chain', ok: true, payload: chain });
    $('chainState').textContent = `Connected (${chain.name}/${chain.chainId})`;
    log(`Chain checked: ${chain.name} ${chain.chainId}`);
    document.body.style.setProperty('--last-beat', Date.now().toString());
  setStatusProgress(10, 'Chain check passed', 'success');

    const agentId = await ensureAgentForDemo();
    state.agentId = agentId;
    const agent = { agentId, name: getAgentNameBase(), walletAddress: state.agentWallet };
    report.agentId = state.agentId;
    if (!state.agentWallet) {
      setWalletBadge('');
    }
    report.steps.push({ step: 'agent', ok: true, agentId: state.agentId, name: agent.name });
    $('agentId').value = state.agentId;
    setStep('quote');
    setRobotState('quote');
    setStatusProgress(25, 'Agent ready', 'success');

    if (!state.agentWallet) {
      await refreshAgentWallet().catch(() => {});
    }

    const quote = await request('/v1/quotes', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('quote') },
      body: JSON.stringify({
        payerAgentId: state.agentId,
        payeeAddress: $('payee').value.trim(),
        amount: $('amount').value || '1',
        currency: 'USDC',
        expiresInSec: 600,
        deadlineInSec: 3600,
        orderId: `auto-demo-${Date.now()}`,
      }),
      retries: 2,
    });
    state.quoteId = quote.quoteId;
    report.quoteId = state.quoteId;
    report.steps.push({ step: 'quote', ok: true, quoteId: state.quoteId, orderId: quote.orderId || undefined, amount: quote.amount, currency: quote.currency });
    $('quoteId').value = state.quoteId;
    setStep('escrow');
    setRobotState('escrow');
    setStatusProgress(42, 'Quote ready', 'success');

    const escrow = await request('/v1/escrows', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('escrow') },
      body: JSON.stringify({ quoteId: state.quoteId }),
      retries: 2,
    });
    state.escrowId = escrow.escrowId;
    report.escrowId = state.escrowId;
    report.steps.push({ step: 'escrow', ok: true, escrowId: state.escrowId, status: escrow.status || 'CREATED' });
    $('escrowId').value = state.escrowId;
    setStatusProgress(55, 'Escrow created', 'success');

    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
      retries: 2,
    });
    report.steps.push({ step: 'markDeposited', ok: true });
    setStatusProgress(68, 'Deposited', 'success');

    setStep('release');
    setRobotState('release');
    setStatusProgress(80, 'Preparing release', 'warn');

    const released = await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: `0x${Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0')}` }),
      retries: 2,
    });

    report.steps.push({ step: 'release', ok: true, response: released });
    await refreshEscrow();

    if (released && released.status === 'TX_PENDING_RELEASE') {
      setStatusProgress(95, 'Release Submitted', 'warn');
    }

    await new Promise((resolve) => setTimeout(resolve, 600));

    const esc = await refreshEscrow();
    if (esc && esc.status === 'RELEASED') {
      const finalStatus = esc ? esc.status : 'unknown';
      report.steps.push({ step: 'finalCheck', ok: finalStatus === 'RELEASED', status: finalStatus });
      report.finishedAt = new Date().toISOString();
      report.success = true;
      report.logDigest = state.logLines.slice(report.logDigestStart, report.logDigestStart + 200);
      state.lastDemoReport = report;
      state.demoReports.unshift(report);
      state.demoReports = state.demoReports.slice(0, MAX_DEMO_REPORTS);
      persistDemoReports();
      renderDemoReportHistory();
      setStatusProgress(100, 'One-click demo complete: flow passed', 'success');
      setToast('One-click demo complete: core flow passed', 'success');
      setTimeout(() => {
        const t = $('resultToast');
        t.classList.remove('success');
      }, 900);
      log(`One-click DemoCompleted | ${state.escrowId}`);
      showResultModal(`Demo completed\nEscrow: ${state.escrowId}\nFinal status: ${esc.status}\nUse buttons to run another round.`, true);
    } else {
      report.steps.push({ step: 'finalCheck', ok: false, status: esc ? esc.status : 'unknown' });
      report.finishedAt = new Date().toISOString();
      report.success = false;
      report.logDigest = state.logLines.slice(report.logDigestStart, report.logDigestStart + 200);
      state.lastDemoReport = report;
      state.demoReports.unshift(report);
      state.demoReports = state.demoReports.slice(0, MAX_DEMO_REPORTS);
      persistDemoReports();
      renderDemoReportHistory();
      setStatusProgress(85, 'Waiting for watcher', 'warn');
      showResultModal('Release submitted, but backend status is not updated yet. Please refresh later.', false);
    }
  } catch (err) {
    report.steps.push({ step: 'error', ok: false, error: err.message });
    report.finishedAt = new Date().toISOString();
    report.success = false;
    report.logDigest = state.logLines.slice(report.logDigestStart, report.logDigestStart + 200);
    state.lastDemoReport = report;
    state.demoReports.unshift(report);
    state.demoReports = state.demoReports.slice(0, MAX_DEMO_REPORTS);
    persistDemoReports();
    renderDemoReportHistory();
    setToast(`Demo interrupted: ${err.message}`, 'error');
    log(`One-click DemoFailed: ${err.message}`);
    setStatusProgress(0, 'Demo failed', 'error');
    showResultModal(`Demo failed：${err.message}`, false);
  } finally {
    setBusy(false);
  }
  updateUi();
}

state.agentId = getStoredDefaultAgentId();
state.demoReports = getStoredDemoReports();
applyAdminPanelVisibility();
renderDemoReportHistory();
refreshYieldRateConfig().catch(() => {});

setInterval(async () => {
  if (state.escrowId) {
    await refreshEscrow();
  }
}, 3500);

setRobotState('idle');
applyStyleMode();
applyAgentOnlyView();
updateUi();
log('Pixel Console started (Agent-Only)');
$('apiBaseLabel').textContent = state.apiBase;
setToast('Waiting for action', '');
setStatusProgress(0, 'Waiting to Start', '');
setStep(null);
