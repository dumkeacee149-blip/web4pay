const $ = (id) => document.getElementById(id);

const state = {
  apiBase: localStorage.getItem('web4pay_api_base') || 'http://127.0.0.1:3000',
  token: localStorage.getItem('web4pay_token') || 'dev-token-1',
  agentId: '',
  quoteId: '',
  escrowId: '',
};

const stepElements = {
  agent: $('step-agent'),
  quote: $('step-quote'),
  escrow: $('step-escrow'),
  release: $('step-release'),
};

function setStep(name, active) {
  Object.values(stepElements).forEach((el) => el.classList.remove('active'));
  if (name && stepElements[name]) {
    stepElements[name].classList.add('active');
  }
}

function setToast(message, kind = '') {
  const t = $('resultToast');
  t.className = 'toast' + (kind ? ` ${kind}` : '');
  t.innerHTML = `${message} ${kind === 'loading' ? '<span class="dot"></span>' : ''}`;
}

function log(line) {
  const out = $('log');
  const now = new Date().toLocaleTimeString();
  out.textContent = `[${now}] ${line}\n${out.textContent}`;
  if (out.textContent.length > 30000) {
    out.textContent = out.textContent.slice(0, 25000);
  }
}

function updateUi() {
  $('apiBase').value = state.apiBase;
  $('token').value = state.token;
  $('apiBaseLabel').textContent = state.apiBase;
  $('agentId').value = state.agentId || '';
  $('quoteId').value = state.quoteId || '';
  $('escrowId').value = state.escrowId || '';
}

function setBusy(isBusy) {
  const buttons = document.querySelectorAll('.pixel-btn');
  buttons.forEach((btn) => {
    btn.disabled = isBusy;
  });
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
  const headers = {
    ...(options.headers || {}),
    ...authHeaders(),
  };
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

  if (!resp.ok) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    throw new Error(msg || `HTTP ${resp.status}`);
  }

  return body;
}

async function refreshEscrow() {
  if (!state.escrowId) return;
  try {
    const data = await request(`/v1/escrows/${state.escrowId}`, { method: 'GET', headers: {} });
    $('escrowInfo').textContent = JSON.stringify(data, null, 2);
    return data;
  } catch (err) {
    $('escrowInfo').textContent = `查询失败: ${err.message}`;
    return null;
  }
}

function bindClick(id, handler) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('click', handler);
}

bindClick('saveConfig', () => {
  state.apiBase = $('apiBase').value.trim() || state.apiBase;
  state.token = $('token').value.trim() || state.token;
  localStorage.setItem('web4pay_api_base', state.apiBase);
  localStorage.setItem('web4pay_token', state.token);
  updateUi();
  $('chainState').textContent = '配置已保存';
  log('配置已更新');
  setToast('配置已保存', 'success');
});

bindClick('checkChain', async () => {
  setToast('检查链路中...', 'loading');
  setBusy(true);
  try {
    const data = await request('/v1/chain', { method: 'GET', headers: {} });
    $('chainInfo').textContent = JSON.stringify(data, null, 2);
    $('chainState').textContent = `已连通 (${data.name}/${data.chainId})`;
    setToast('链路检查成功', 'success');
    log('链路检查成功');
  } catch (err) {
    $('chainInfo').textContent = `失败: ${err.message}`;
    $('chainState').textContent = '链路失败';
    setToast('链路检查失败', 'error');
    log(`链路失败: ${err.message}`);
  } finally {
    setBusy(false);
  }
});

bindClick('createAgent', async () => {
  const name = $('agentName').value.trim() || `agent-${Date.now()}`;
  setStep('agent');
  setToast('创建 Agent 中...', 'loading');
  try {
    const data = await request('/v1/agents', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('agent') },
      body: JSON.stringify({ name }),
    });
    state.agentId = data.agentId;
    updateUi();
    log(`Agent 已创建: ${state.agentId}`);
    setToast('Agent 已创建', 'success');
  } catch (err) {
    setToast('创建 Agent 失败', 'error');
    log(`创建 Agent 失败: ${err.message}`);
  }
});

bindClick('createQuote', async () => {
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
  setStep('quote');
  setToast('创建 Quote 中...', 'loading');

  try {
    const data = await request('/v1/quotes', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('quote') },
      body: JSON.stringify(payload),
    });
    state.quoteId = data.quoteId;
    updateUi();
    log(`Quote 已创建: ${state.quoteId}`);
    setToast('Quote 已创建', 'success');
  } catch (err) {
    setToast('创建 Quote 失败', 'error');
    log(`创建 Quote 失败: ${err.message}`);
  }
});

bindClick('createEscrow', async () => {
  if (!state.quoteId) {
    alert('请先创建 Quote');
    return;
  }
  setStep('escrow');
  setToast('创建 Escrow 中...', 'loading');
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
    setToast('Escrow 已创建', 'success');
  } catch (err) {
    setToast('创建 Escrow 失败', 'error');
    log(`创建 Escrow 失败: ${err.message}`);
  }
});

bindClick('markDeposited', async () => {
  if (!state.escrowId) return alert('请先创建 Escrow');
  setToast('标记入金中...', 'loading');
  try {
    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
    });
    log(`已手动标记入金: ${state.escrowId}`);
    await refreshEscrow();
    setToast('入金标记完成', 'success');
  } catch (err) {
    setToast('标记入金失败', 'error');
    log(`标记入金失败: ${err.message}`);
  }
});

bindClick('releaseEscrow', async () => {
  if (!state.escrowId) return alert('请先创建 Escrow');
  setStep('release');
  setToast('Release 发起中...', 'loading');
  try {
    const data = await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: '0x' + Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0') }),
    });
    log(`Release 已发起: status=${data.status}`);
    await refreshEscrow();
    setToast('Release 已发起', 'success');
  } catch (err) {
    setToast('Release 失败', 'error');
    log(`Release 失败: ${err.message}`);
  }
});

bindClick('clearLog', () => {
  $('log').textContent = '';
  log('日志已清空');
});

bindClick('downloadLog', () => {
  const blob = new Blob([$('log').textContent || ''], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `web4pay-log-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});

bindClick('runDemo', async () => {
  setBusy(true);
  setStep('agent');
  setToast('开始自动演示...', 'loading');
  try {
    const base = state.apiBase;
    if (!base) {
      throw new Error('API 地址不能为空');
    }

    await (async () => {
      const chain = await request('/v1/chain', { method: 'GET', headers: {} });
      $('chainState').textContent = `已连通 (${chain.name}/${chain.chainId})`;
      log(`链路已检测: ${chain.name} ${chain.chainId}`);
    })();

    const name = `auto-${Date.now()}`;
    const agent = await request('/v1/agents', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('agent') },
      body: JSON.stringify({ name }),
    });
    state.agentId = agent.agentId;
    $('agentId').value = state.agentId;
    setStep('quote');

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
    });
    state.quoteId = quote.quoteId;
    $('quoteId').value = state.quoteId;
    setStep('escrow');

    const escrow = await request('/v1/escrows', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('escrow') },
      body: JSON.stringify({ quoteId: state.quoteId }),
    });
    state.escrowId = escrow.escrowId;
    $('escrowId').value = state.escrowId;

    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    setStep('release');

    await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: '0x' + Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0') }),
    });

    await refreshEscrow();
    setToast('一键演示完成：成功跑通主流程', 'success');
    log(`一键演示完成 | ${state.escrowId}`);
  } catch (err) {
    setToast(`演示中断: ${err.message}`, 'error');
    log(`一键演示失败: ${err.message}`);
  } finally {
    setBusy(false);
  }
});

setInterval(async () => {
  if (state.escrowId) {
    const data = await refreshEscrow();
    if (data && data.status === 'RELEASED') {
      setToast('状态确认：已 RELEASED', 'success');
    }
  }
}, 3500);

updateUi();
log('Pixel Console 已启动');
$('apiBaseLabel').textContent = state.apiBase;
setToast('等待操作', '');
