const $ = (id) => document.getElementById(id);

const STORAGE_KEY = 'web4pay_lobster_trades_v1';
const HISTORY_LIMIT = 20;

const TOKEN_LIST = {
  USDT: {
    symbol: 'USDT',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
  },
  BUSD: {
    symbol: 'BUSD',
    address: '0xe9e7cea3dedca5984780bafc599bd69add087d56e',
    decimals: 18,
  },
  CAKE: {
    symbol: 'CAKE',
    address: '0x0E09Fabb73BD3Ade0A17Bc2205fE4A9aA6A1',
    decimals: 18,
  },
  XVS: {
    symbol: 'XVS',
    address: '0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63d',
    decimals: 18,
  },
  WBNB: {
    symbol: 'WBNB',
    address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    decimals: 18,
  },
};

const PAIR_INPUT = {
  USDT_WBNB: { in: 'USDT', out: 'WBNB' },
  BUSD_WBNB: { in: 'BUSD', out: 'WBNB' },
  CAKE_WBNB: { in: 'CAKE', out: 'WBNB' },
  XVS_WBNB: { in: 'XVS', out: 'WBNB' },
};

const BSC_MAINNET_ID = 56;
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
];

const state = {
  provider: null,
  signer: null,
  account: '',
  chainId: 0,
  router: null,
  running: false,
  intervalId: null,
  position: null,
  history: [],
};

function toast(message) {
  const badge = $('tradeStatus');
  if (badge) badge.textContent = message;
  appendLog(message);
}

function appendLog(message) {
  const el = $('log');
  const now = new Date().toLocaleTimeString();
  el.textContent = `[${now}] ${message}\n${el.textContent}`;
  el.textContent = el.textContent.slice(0, 14000);
}

function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history.slice(0, HISTORY_LIMIT)));
}

function renderHistory() {
  const list = $('tradeHistory');
  if (!list) return;
  list.textContent = '';
  if (!state.history.length) {
    list.textContent = '暂无记录';
    return;
  }
  state.history.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'line';
    const ok = item.status === 'closed' ? '✅' : item.status === 'stopped' ? '⏹️' : '🧪';
    row.innerHTML = `<div><strong>${ok} ${item.pair}</strong> <small>(${new Date(item.createdAt).toLocaleString()})</small></div>` +
      `<div class="meta">PnL: ${item.pnlPct}% · entryHash: ${item.entryTx || '-'} · exitHash: ${item.exitTx || '-'} </div>`;
    list.appendChild(row);
  });
}

function pushHistory(item) {
  state.history.unshift({ ...item, createdAt: new Date().toISOString() });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  saveHistory();
  renderHistory();
}

function updateUiPhase(text) {
  const phase = $('phase');
  if (phase) phase.value = text;
}

function setRunningState(isRunning) {
  state.running = isRunning;
  const startBtn = $('startBot');
  const stopBtn = $('stopBot');
  if (startBtn) startBtn.disabled = isRunning;
  if (stopBtn) stopBtn.disabled = !isRunning;
}

function getPairConfig() {
  const pair = (
    typeof window !== 'undefined' && window.document
      ? document.getElementById('pairSymbol')?.value
      : undefined
  ) || 'USDT_WBNB';
  return PAIR_INPUT[pair] || PAIR_INPUT.USDT_WBNB;
}

function parseNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureEthersLoaded() {
  if (!window.ethers || !window.ethers.Contract) {
    throw new Error('ethers.js 未加载成功');
  }
}

function getToken(symbol) {
  return TOKEN_LIST[symbol];
}

function getInputAmountWei(token) {
  const amount = parseNum($('amountIn').value, 0);
  if (amount <= 0) throw new Error('买入金额必须大于 0');
  return window.ethers.parseUnits(String(amount), token.decimals);
}

function nowPlus(minutes = 20) {
  return Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
}

function computePnlPercent(entryValue, currentValue) {
  if (!Number.isFinite(entryValue) || entryValue <= 0) return 0;
  return Number((((currentValue - entryValue) / entryValue) * 100).toFixed(4));
}

function speech(text) {
  const b = $('lobsterSpeech');
  if (!b) return;
  b.textContent = text;
  b.hidden = false;
  b.classList.add('show');
  setTimeout(() => {
    b.classList.remove('show');
    b.hidden = true;
  }, 1400);
}

async function ensureBscWalletConnected() {
  ensureEthersLoaded();
  if (!window.ethereum || typeof window.ethereum.request !== 'function') {
    throw new Error('未检测到可用钱包（MetaMask / 兼容钱包）');
  }

  const provider = new window.ethers.BrowserProvider(window.ethereum);
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || !accounts[0]) {
    throw new Error('钱包未返回账户');
  }

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== BSC_MAINNET_ID) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${BSC_MAINNET_ID.toString(16)}` }],
      });
    } catch (err) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: `0x${BSC_MAINNET_ID.toString(16)}`,
            chainName: 'BNB Smart Chain Mainnet',
            rpcUrls: ['https://bsc-dataseed.binance.org/'],
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            blockExplorerUrls: ['https://bscscan.com/'],
          }],
        });
      } else {
        throw new Error(`钱包网络切换失败：${err.message}`);
      }
    }
  }

  const signer = await provider.getSigner();
  const account = await signer.getAddress();
  const router = new window.ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, signer);
  state.provider = provider;
  state.signer = signer;
  state.account = account;
  state.chainId = BSC_MAINNET_ID;
  state.router = router;

  const addrEl = $('walletAddress');
  if (addrEl) addrEl.value = account;
  const conn = $('connBadge');
  if (conn) conn.textContent = `已连接：${account.slice(0, 6)}...${account.slice(-4)}`;
  await refreshBnbBalance();
  toast(`钱包已连接：${account}`);
}

async function refreshBnbBalance() {
  if (!state.provider || !state.account) return;
  const bal = await state.provider.getBalance(state.account);
  const el = $('bnbBalance');
  if (el) el.value = `${window.ethers.formatEther(bal)}`;
}

async function getTokenContract(token) {
  return new window.ethers.Contract(token.address, ERC20_ABI, state.signer);
}

async function quoteExactIn(tokenIn, tokenOut, amountInWei) {
  const amounts = await state.router.getAmountsOut(amountInWei, [tokenIn.address, tokenOut.address]);
  return amounts[1];
}

function toNumber(token, amountWei) {
  return Number(window.ethers.formatUnits(amountWei, token.decimals));
}

async function ensureAllowance(tokenIn, amountInWei) {
  const erc = await getTokenContract(tokenIn);
  const allowance = await erc.allowance(state.account, PANCAKE_ROUTER);
  if (allowance < amountInWei) {
    appendLog(`USDT approve 中：${window.ethers.formatUnits(amountInWei, tokenIn.decimals)} ${tokenIn.symbol}`);
    const tx = await erc.approve(PANCAKE_ROUTER, amountInWei);
    await tx.wait();
    appendLog('Approve 完成');
  }
}

async function executeBuy(pairCfg, amountInWei, slippageBps) {
  const tokenIn = getToken(pairCfg.in);
  const tokenOut = getToken(pairCfg.out);
  const outPreview = await quoteExactIn(tokenIn, tokenOut, amountInWei);
  const minOut = outPreview - (outPreview * BigInt(Math.floor(Number(slippageBps) || 80))) / 10000n;
  await ensureAllowance(tokenIn, amountInWei);

  const tx = await state.router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    amountInWei,
    minOut,
    [tokenIn.address, tokenOut.address],
    state.account,
    nowPlus(10),
    {
      gasLimit: 450000,
      gasPrice: await state.provider.getFeeData().then((d) => d.gasPrice ?? undefined),
    },
  );
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    outQuote: outPreview,
    gasUsed: receipt?.gasUsed ? receipt.gasUsed.toString() : '',
  };
}

async function executeSell(pairCfg, amountOutWei, slippageBps) {
  const tokenIn = getToken(pairCfg.in);
  const tokenOut = getToken(pairCfg.out);
  const outToIn = await quoteExactIn(tokenOut, tokenIn, amountOutWei);
  const minIn = outToIn - (outToIn * BigInt(Math.floor(Number(slippageBps) || 80))) / 10000n;
  const tx = await state.router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    amountOutWei,
    minIn,
    [tokenOut.address, tokenIn.address],
    state.account,
    nowPlus(10),
    {
      gasLimit: 450000,
      gasPrice: await state.provider.getFeeData().then((d) => d.gasPrice ?? undefined),
    },
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, gasUsed: receipt?.gasUsed ? receipt.gasUsed.toString() : '' };
}

function buildPairLabel(pairCfg) {
  return `${pairCfg.in}/${pairCfg.out}`;
}

async function readHolding(tokenOut) {
  const outContract = await getTokenContract(tokenOut);
  const bal = await outContract.balanceOf(state.account);
  return bal;
}

async function valueOutInInput(tokenOutAmountWei, pairCfg) {
  const tokenOut = getToken(pairCfg.out);
  const tokenIn = getToken(pairCfg.in);
  const inPerOut = await quoteExactIn(tokenOut, tokenIn, window.ethers.parseUnits('1', tokenOut.decimals));
  return (Number(window.ethers.formatUnits(tokenOutAmountWei, tokenOut.decimals)) * Number(window.ethers.formatUnits(inPerOut, tokenIn.decimals)));
}

async function monitorLoop(pairCfg, stopLossPct, takeProfitPct, slippageBps) {
  if (!state.position) return;
  const tokenIn = getToken(pairCfg.in);
  const tokenOut = getToken(pairCfg.out);

  const balanceOut = await readHolding(tokenOut);
  const holding = Number(window.ethers.formatUnits(balanceOut, tokenOut.decimals));
  $('holdingAmount').value = holding.toString();

  const currentValue = await valueOutInInput(balanceOut, pairCfg);
  const pnlPct = computePnlPercent(state.position.entryValueInput, currentValue);
  $('unrealizedPnl').value = `${pnlPct.toFixed(4)}%`;
  $('livePrice').value = `${currentValue.toFixed(6)} ${tokenIn.symbol}`;

  if (pnlPct >= takeProfitPct) {
    toast('触发止盈，准备平仓');
    speech('到达止盈，撤仓');
    await closePosition(pairCfg, stopLossPct, takeProfitPct, slippageBps, true);
  } else if (pnlPct <= -Math.abs(stopLossPct)) {
    toast('触发止损，准备止损');
    speech('到达止损，撤仓');
    await closePosition(pairCfg, stopLossPct, takeProfitPct, slippageBps, true);
  }
}

async function closePosition(pairCfg, stopLossPct, takeProfitPct, slippageBps, auto = true) {
  if (!state.position) return;

  const tokenOut = getToken(pairCfg.out);
  const amountToSell = await readHolding(tokenOut);
  const minToSell = amountToSell;
  if (minToSell <= 0n) {
    toast('仓位已清空，无需撤仓');
    state.position.status = 'stopped';
    state.position.exitReason = 'already_zero';
    pushHistory(state.position);
    stopStrategy();
    return;
  }

  const currentValue = await valueOutInInput(amountToSell, pairCfg);
  const sell = await executeSell(pairCfg, amountToSell, slippageBps);
  const pnl = computePnlPercent(state.position.entryValueInput, currentValue);
  state.position.exitTx = sell.txHash;
  state.position.status = 'closed';
  state.position.pnlPct = Number(pnl.toFixed(4));
  state.position.exitValue = Number(currentValue.toFixed(6));
  state.position.closedAt = new Date().toISOString();
  state.position.exitReason = auto ? 'auto' : 'manual';

  appendLog(`平仓成功: ${sell.txHash}`);
  pushHistory(state.position);
  renderPositionState('closed');
  stopStrategy();
}

async function startStrategy() {
  try {
    await ensureBscWalletConnected();
  } catch (err) {
    appendLog(`连接失败：${err.message}`);
    toast('连接失败，不能启动策略');
    return;
  }

  if (state.running) return;
  const cfg = getPairConfig();
  const amountInToken = getToken(cfg.in);
  const amountInWei = getInputAmountWei(amountInToken);
  const tp = parseNum($('takeProfit').value, 5);
  const sl = parseNum($('stopLoss').value, 2);
  const intervalSec = Math.max(4, parseInt($('intervalSec').value, 10) || 12);
  const slippageBps = Math.max(10, parseInt($('slippageBps').value, 10) || 80);

  if (tp <= 0 || sl <= 0) {
    toast('请设置大于 0 的 TP/SL');
    return;
  }

  setRunningState(true);
  updateUiPhase('准备买入');
  toast(`开始策略 ${cfg.in}/${cfg.out}`);
  speech('开始执行，记得看好滑点');

  try {
    const inputForOne = await quoteExactIn(amountInToken, getToken(cfg.out), amountInWei);
    const entryRate = toNumber(getToken(cfg.out), inputForOne) / parseNum($('amountIn').value, 1);
    $('entryRate').value = `${entryRate.toFixed(8)} ${cfg.out} / ${cfg.in}`;

    const buy = await executeBuy(cfg, amountInWei, slippageBps);
    const entryValue = toNumber(getToken(cfg.in), await valueOutInInput(await readHolding(getToken(cfg.out)), cfg));
    state.position = {
      pair: `${cfg.in}/${cfg.out}`,
      entryTx: buy.txHash,
      status: 'open',
      entryAmount: parseNum($('amountIn').value, 0),
      entryRate,
      entryValue,
      entryValueInput: parseNum($('amountIn').value, 0),
      createdAt: new Date().toISOString(),
    };
    renderPositionState('已买入等待触发');
    appendLog(`买入成交: ${buy.txHash}`);
    toast('买入完成，开始监控');
    speech('买入完成，开始看盘');

    state.intervalId = setInterval(() => {
      monitorLoop(cfg, sl, tp, slippageBps).catch((err) => {
        appendLog(`监控异常: ${err.message}`);
        toast('监控异常，稍后重试');
      });
    }, intervalSec * 1000);
    await monitorLoop(cfg, sl, tp, slippageBps);
  } catch (err) {
    toast(`启动失败: ${err.message}`);
    appendLog(`启动失败: ${err.message}`);
    stopStrategy(true);
  }
}

function renderPositionState(text) {
  updateUiPhase(text);
  const live = $('tradeStatus');
  if (live) live.textContent = text;
}

function stopStrategy(errorMode = false) {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  setRunningState(false);
  if (state.position && state.position.status === 'open' && errorMode) {
    state.position.status = 'stopped';
    state.position.stoppedAt = new Date().toISOString();
    const parsedPnl = parseFloat(($('unrealizedPnl').value || '0%').replace('%', '')) || 0;
    state.position.pnlPct = Number(parsedPnl.toFixed(4));
    pushHistory(state.position);
  }
  renderPositionState('已停止');
}

async function stopButtonHandler() {
  if (!state.position || state.position.status !== 'open') {
    stopStrategy();
    return;
  }
  toast('手动停止，尝试收口持仓为主动停止（不强平）');
  stopStrategy();
}

function clearLog() {
  const log = $('log');
  if (log) log.textContent = '';
}

function copyLog() {
  const log = $('log');
  if (!log) return;
  navigator.clipboard.writeText(log.textContent || '').then(() => {
    toast('日志已复制');
  }).catch(() => {
    toast('复制失败');
  });
}

function disconnectWallet() {
  state.provider = null;
  state.signer = null;
  state.account = '';
  state.router = null;
  const addr = $('walletAddress');
  const conn = $('connBadge');
  const b = $('bnbBalance');
  if (addr) addr.value = '';
  if (b) b.value = '';
  if (conn) conn.textContent = '未连接';
  toast('钱包断开（刷新可重新连接）');
}

function init() {
  const startBtn = $('startBot');
  const stopBtn = $('stopBot');
  const connectBtn = $('connectWallet');
  const disconnectBtn = $('disconnectWallet');
  const clearBtn = $('clearLog');
  const copyBtn = $('copyLog');

  state.history = getHistory();
  renderHistory();

  connectBtn && connectBtn.addEventListener('click', ensureBscWalletConnected);
  disconnectBtn && disconnectBtn.addEventListener('click', disconnectWallet);
  startBtn && startBtn.addEventListener('click', startStrategy);
  stopBtn && stopBtn.addEventListener('click', stopButtonHandler);
  clearBtn && clearBtn.addEventListener('click', clearLog);
  copyBtn && copyBtn.addEventListener('click', copyLog);

  setRunningState(false);
  updateUiPhase('待启动');
  toast('自动交易面板已就绪');
}

window.addEventListener('DOMContentLoaded', init);
