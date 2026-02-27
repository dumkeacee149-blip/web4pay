const $ = (id) => document.getElementById(id);

const state = {
  apiBase: localStorage.getItem('web4pay_api_base') || 'http://127.0.0.1:3000',
  token: localStorage.getItem('web4pay_token') || 'dev-token-1',
  agentId: '',
  quoteId: '',
  escrowId: '',
};

function log(line) {
  const out = $('log');
  const now = new Date().toLocaleTimeString();
  out.textContent = `[${now}] ${line}\n${out.textContent}`;
  if (out.textContent.length > 20000) out.textContent = out.textContent.slice(0, 18000);
}

function updateUi() {
  $('apiBase').value = state.apiBase;
  $('token').value = state.token;
  $('apiBaseLabel').textContent = state.apiBase;
  $('agentId').value = state.agentId || '';
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
  const resp = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });

  const text = await resp.text();
  let body = text;
  try { body = JSON.parse(text); } catch {
    /* keep plain text */
  }

  if (!resp.ok) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    throw new Error(msg || `HTTP ${resp.status}`);
  }

  return body;
}

async function refreshEscrow() {
  if (!state.escrowId) return;
  try {
    const data = await request(`/v1/escrows/${state.escrowId}` , { method: 'GET', headers: {} });
    $('escrowInfo').textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    $('escrowInfo').textContent = `查询失败: ${err.message}`;
  }
}

$('saveConfig').addEventListener('click', () => {
  state.apiBase = $('apiBase').value.trim() || state.apiBase;
  state.token = $('token').value.trim() || state.token;
  localStorage.setItem('web4pay_api_base', state.apiBase);
  localStorage.setItem('web4pay_token', state.token);
  updateUi();
  $('chainState').textContent = '配置已保存';
  log('配置已更新');
});

$('checkChain').addEventListener('click', async () => {
  try {
    const data = await request('/v1/chain', { method: 'GET', headers: {} });
    $('chainInfo').textContent = JSON.stringify(data, null, 2);
    $('chainState').textContent = `已连通 (${data.name}/${data.chainId})`;
    log('链路检查成功');
  } catch (err) {
    $('chainInfo').textContent = `失败: ${err.message}`;
    $('chainState').textContent = '链路失败';
    log(`链路失败: ${err.message}`);
  }
});

$('createAgent').addEventListener('click', async () => {
  const name = $('agentName').value.trim() || `agent-${Date.now()}`;
  const ik = randomId('agent');
  try {
    const data = await request('/v1/agents', {
      method: 'POST',
      headers: { 'Idempotency-Key': ik },
      body: JSON.stringify({ name }),
    });
    state.agentId = data.agentId;
    updateUi();
    log(`Agent 已创建: ${state.agentId}`);
  } catch (err) {
    log(`创建 Agent 失败: ${err.message}`);
  }
});

$('createQuote').addEventListener('click', async () => {
  if (!state.agentId) {
    alert('请先创建 Agent');
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

  try {
    const data = await request('/v1/quotes', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('quote') },
      body: JSON.stringify(payload),
    });
    state.quoteId = data.quoteId;
    updateUi();
    log(`Quote 已创建: ${state.quoteId}`);
  } catch (err) {
    log(`创建 Quote 失败: ${err.message}`);
  }
});

$('createEscrow').addEventListener('click', async () => {
  if (!state.quoteId) {
    alert('请先创建 Quote');
    return;
  }
  try {
    const data = await request('/v1/escrows', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('escrow') },
      body: JSON.stringify({ quoteId: state.quoteId }),
    });
    state.escrowId = data.escrowId;
    updateUi();
    log(`Escrow 已创建: ${state.escrowId}`);
    await refreshEscrow();
  } catch (err) {
    log(`创建 Escrow 失败: ${err.message}`);
  }
});

$('markDeposited').addEventListener('click', async () => {
  if (!state.escrowId) return alert('请先创建 Escrow');
  try {
    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
    });
    log(`已手动标记入金: ${state.escrowId}`);
    await refreshEscrow();
  } catch (err) {
    log(`标记入金失败: ${err.message}`);
  }
});

$('releaseEscrow').addEventListener('click', async () => {
  if (!state.escrowId) return alert('请先创建 Escrow');
  try {
    const data = await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: '0x' + Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0') }),
    });
    log(`Release 已发起: status=${data.status}`);
    await refreshEscrow();
  } catch (err) {
    log(`Release 失败: ${err.message}`);
  }
});

$('clearLog').addEventListener('click', () => {
  $('log').textContent = '';
});

// 定时轮询显示最新状态
setInterval(() => {
  if (state.escrowId) refreshEscrow();
}, 3500);

updateUi();
log('Pixel Console 已启动');
$('apiBaseLabel').textContent = state.apiBase;
