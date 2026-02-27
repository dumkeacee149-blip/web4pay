const $ = (id) => document.getElementById(id);

const state = {
  apiBase: localStorage.getItem('web4pay_api_base') || 'http://127.0.0.1:3000',
  token: localStorage.getItem('web4pay_token') || 'dev-token-1',
  agentId: '',
  quoteId: '',
  escrowId: '',
  lastReleaseStatus: '',
};

const stepElements = {
  agent: $('step-agent'),
  quote: $('step-quote'),
  escrow: $('step-escrow'),
  release: $('step-release'),
};

function setStep(name) {
  Object.values(stepElements).forEach((el) => el.classList.remove('active'));
  if (name && stepElements[name]) {
    stepElements[name].classList.add('active');
  }
}

function setStatusProgress(percent, tagText = '等待开始', kind = 'default') {
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
  const staticIdempotencyKey = options.idempotencyKey || randomId('req');
  const headers = {
    ...(options.headers || {}),
    ...authHeaders(),
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

    if (resp.ok) return body;

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
    case 'TX_PENDING_DEPOSIT': return { p: 45, kind: 'warn', tag: '托管中（入金提交）' };
    case 'DEPOSITED': return { p: 55, kind: 'success', tag: '托管确认入金' };
    case 'TX_PENDING_RELEASE': return { p: 75, kind: 'warn', tag: '等待释放交易' };
    case 'RELEASED': return { p: 100, kind: 'success', tag: '释放成功完成' };
    case 'TX_PENDING_REFUND': return { p: 75, kind: 'warn', tag: '退款处理中' };
    case 'REFUNDED': return { p: 100, kind: 'warn', tag: '已退款' };
    case 'FAILED': return { p: 100, kind: 'error', tag: '流程失败' };
    default: return { p: 30, kind: '', tag: '托管单已创建' };
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
      setToast(`当前状态: ${data.status}`, data.status === 'RELEASED' ? 'success' : '');
      state.lastReleaseStatus = data.status;
      if (data.status === 'RELEASED') {
        setStep('release');
        setToast('状态确认：已 RELEASED', 'success');
      }
    }

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

function resetDemo() {
  state.agentId = '';
  state.quoteId = '';
  state.escrowId = '';
  state.lastReleaseStatus = '';
  $('agentId').value = '';
  $('quoteId').value = '';
  $('escrowId').value = '';
  $('escrowInfo').textContent = '还没创建 escrow';
  setToast('流程已重置', 'success');
  setStatusProgress(0, '已重置流程', '');
  setStep(null);
  log('Demo state reset');
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
    setStatusProgress(15, '链路已连通', 'success');
    log('链路检查成功');
  } catch (err) {
    $('chainInfo').textContent = `失败: ${err.message}`;
    $('chainState').textContent = '链路失败';
    setToast('链路检查失败', 'error');
    setStatusProgress(0, '链路失败', 'error');
    log(`链路失败: ${err.message}`);
  } finally {
    setBusy(false);
  }
});

bindClick('createAgent', async () => {
  const name = $('agentName').value.trim() || `agent-${Date.now()}`;
  setStep('agent');
  setToast('创建 Agent 中...', 'loading');
  setStatusProgress(25, '创建 Agent', 'warn');
  try {
    const data = await request('/v1/agents', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('agent') },
      body: JSON.stringify({ name }),
      retries: 2,
    });
    state.agentId = data.agentId;
    updateUi();
    log(`Agent 已创建: ${state.agentId}`);
    setToast('Agent 已创建', 'success');
    setStatusProgress(30, 'Agent 已创建', 'success');
  } catch (err) {
    setToast('创建 Agent 失败', 'error');
    setStatusProgress(15, '创建 Agent 失败', 'error');
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
  setStatusProgress(38, '创建 Quote', 'warn');
  setToast('创建 Quote 中...', 'loading');

  try {
    const data = await request('/v1/quotes', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('quote') },
      body: JSON.stringify(payload),
      retries: 2,
    });
    state.quoteId = data.quoteId;
    updateUi();
    log(`Quote 已创建: ${state.quoteId}`);
    setToast('Quote 已创建', 'success');
    setStatusProgress(42, 'Quote 已创建', 'success');
  } catch (err) {
    setToast('创建 Quote 失败', 'error');
    setStatusProgress(30, '创建 Quote 失败', 'error');
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
  setStatusProgress(52, '创建 Escrow', 'warn');
  try {
    const data = await request('/v1/escrows', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('escrow') },
      body: JSON.stringify({ quoteId: state.quoteId }),
      retries: 2,
    });
    state.escrowId = data.escrowId;
    updateUi();
    log(`Escrow 已创建: ${state.escrowId}`);
    await refreshEscrow();
    setToast('Escrow 已创建', 'success');
  } catch (err) {
    setToast('创建 Escrow 失败', 'error');
    setStatusProgress(42, '创建 Escrow 失败', 'error');
    log(`创建 Escrow 失败: ${err.message}`);
  }
});

bindClick('markDeposited', async () => {
  if (!state.escrowId) return alert('请先创建 Escrow');
  setStatusProgress(65, '模拟入金中', 'warn');
  setToast('标记入金中...', 'loading');
  try {
    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
      retries: 2,
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
  setStatusProgress(80, '发起 Release', 'warn');
  try {
    const data = await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: `0x${Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0')}` }),
      retries: 2,
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

bindClick('refreshState', async () => {
  if (!state.escrowId) {
    setToast('先创建 Escrow 再刷新', 'warn');
    return;
  }
  await refreshEscrow();
  setToast('状态已刷新', 'success');
});

bindClick('resetDemo', resetDemo);
bindClick('modalClose', hideResultModal);
bindClick('runDemo', runDemo);
bindClick('runDemoMobile', runDemo);

async function runDemo() {
  setBusy(true);
  setStep('agent');
  setStatusProgress(5, '开始演示', 'loading');
  setToast('开始自动演示...', 'loading');
  try {
    const chain = await request('/v1/chain', { method: 'GET', headers: {}, retries: 2 });
    $('chainState').textContent = `已连通 (${chain.name}/${chain.chainId})`;
    log(`链路已检测: ${chain.name} ${chain.chainId}`);
    setStatusProgress(10, '链路检测通过', 'success');

    const agent = await request('/v1/agents', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('agent') },
      body: JSON.stringify({ name: `auto-${Date.now()}` }),
      retries: 2,
    });
    state.agentId = agent.agentId;
    $('agentId').value = state.agentId;
    setStep('quote');
    setStatusProgress(25, 'Agent 已生成', 'success');

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
    $('quoteId').value = state.quoteId;
    setStep('escrow');
    setStatusProgress(42, 'Quote 已生成', 'success');

    const escrow = await request('/v1/escrows', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('escrow') },
      body: JSON.stringify({ quoteId: state.quoteId }),
      retries: 2,
    });
    state.escrowId = escrow.escrowId;
    $('escrowId').value = state.escrowId;
    setStatusProgress(55, 'Escrow 已创建', 'success');

    await request(`/internal/dev/escrows/${state.escrowId}/markDeposited`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('mark') },
      body: JSON.stringify({ ok: true }),
      retries: 2,
    });
    setStatusProgress(68, '已入金', 'success');

    setStep('release');
    setStatusProgress(80, 'Release 准备中', 'warn');

    const released = await request(`/v1/escrows/${state.escrowId}/release`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomId('release') },
      body: JSON.stringify({ deliverableHash: `0x${Math.floor(Math.random() * 1e16).toString(16).padStart(16, '0')}` }),
      retries: 2,
    });

    await refreshEscrow();

    if (released && released.status === 'TX_PENDING_RELEASE') {
      setStatusProgress(95, 'Release 已提交', 'warn');
    }

    await new Promise((resolve) => setTimeout(resolve, 600));

    const esc = await refreshEscrow();
    if (esc && esc.status === 'RELEASED') {
      setStatusProgress(100, '一键演示完成：流程跑通', 'success');
      setToast('一键演示完成：成功跑通主流程', 'success');
      log(`一键演示完成 | ${state.escrowId}`);
      showResultModal(`本次演示完成\nEscrow: ${state.escrowId}\n最终状态: ${esc.status}\n可通过按钮继续进行下一轮。`, true);
    } else {
      setStatusProgress(85, '等待 watcher 完成', 'warn');
      showResultModal('演示已提交 Release，但后端状态未立刻更新。请稍后刷新状态。', false);
    }
  } catch (err) {
    setToast(`演示中断: ${err.message}`, 'error');
    log(`一键演示失败: ${err.message}`);
    setStatusProgress(0, '演示失败', 'error');
    showResultModal(`演示失败：${err.message}`, false);
  } finally {
    setBusy(false);
  }
  updateUi();
}

setInterval(async () => {
  if (state.escrowId) {
    await refreshEscrow();
  }
}, 3500);

updateUi();
log('Pixel Console 已启动');
$('apiBaseLabel').textContent = state.apiBase;
setToast('等待操作', '');
setStatusProgress(0, '等待开始', '');
setStep(null);
