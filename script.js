/* Enhanced Trading Simulator */
const CONFIG = {
    candleIntervalMs: 1000,
    maxCandles: 60,
    initialPrice: 100.00,
    priceSigma: 0.0025,
    maxJumpPct: 0.03,
    qtyDecimals: 4,
};

const initialAccountState = {
    balance: 10000.00,
    holdings: { qty: 0, avgPrice: 0 },
    history: [],
    positionType: null, // 'long', 'short', or null
    realizedPnl: 0.00,
};

const state = {
    candles: [],
    account: JSON.parse(JSON.stringify(initialAccountState)),
    previousPrice: 100.00
};

/* Utilities */
function roundToCents(x) {
    return Math.round(x * 100) / 100;
}

function roundQty(q) {
    const mult = Math.pow(10, CONFIG.qtyDecimals);
    return Math.floor(q * mult) / mult;
}

function nowIso() { return new Date().toISOString(); }

function randNormal(mean = 0, std = 1) {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * std + mean;
}

/* Candle Generator (No Wicks/Shadows) */
function generateNextCandle(prev) {
    const open = prev ? prev.close : CONFIG.initialPrice;
    let r = randNormal(0, CONFIG.priceSigma);
    if (r > CONFIG.maxJumpPct) r = CONFIG.maxJumpPct;
    if (r < -CONFIG.maxJumpPct) r = -CONFIG.maxJumpPct;
    let close = open * (1 + r);
    close = Math.max(0.01, close);

    const high = Math.max(open, close);
    const low = Math.min(open, close);

    const volume = Math.floor(100 + Math.random() * 400);

    return {
        t: Date.now(),
        open: roundToCents(open),
        high: roundToCents(high),
        low: roundToCents(low),
        close: roundToCents(close),
        volume
    };
}

/* Trading Logic */
function executeOrder(type, amountUSD) {
    if (state.account.positionType) return { error: 'You must exit your current position first' };
    
    const latest = getLatestPrice();
    if (!latest) return { error: 'No price available yet' };
    const price = latest.close;
    amountUSD = Number(amountUSD);
    if (!isFinite(amountUSD) || amountUSD <= 0) return { error: 'Invalid amount' };

    let qty = amountUSD / price;
    qty = roundQty(qty);
    if (qty <= 0) return { error: 'Amount too small' };

    if (type === 'buy') {
        const tradeCost = roundToCents(qty * price);
        if (tradeCost > state.account.balance) return { error: 'Insufficient funds' };

        state.account.balance = roundToCents(state.account.balance - tradeCost);
        state.account.holdings.qty = qty;
        state.account.holdings.avgPrice = price;
        state.account.positionType = 'long';

        const rec = {
            id: 'tx-' + Date.now(), type: 'BUY', price, qty, amount: tradeCost
        };
        state.account.history.unshift(rec);
        return { success: true, trade: rec };

    } else if (type === 'short') {
        const proceeds = roundToCents(qty * price);
        
        state.account.balance = roundToCents(state.account.balance + proceeds);
        state.account.holdings.qty = -qty; // Store short position as negative qty
        state.account.holdings.avgPrice = price;
        state.account.positionType = 'short';

        const rec = {
            id: 'tx-' + Date.now(), type: 'SHORT', price, qty, amount: proceeds
        };
        state.account.history.unshift(rec);
        return { success: true, trade: rec };
    }
    return { error: 'Unknown order type' };
}

function exitPosition() {
    if (!state.account.positionType) return { error: 'No open position to exit' };

    const latest = getLatestPrice();
    if (!latest) return { error: 'No price available yet' };
    const price = latest.close;
    const { qty, avgPrice } = state.account.holdings;
    let realizedPnl = 0;
    let rec = {};

    if (state.account.positionType === 'long') {
        const proceeds = roundToCents(qty * price);
        realizedPnl = roundToCents((price - avgPrice) * qty);
        state.account.balance = roundToCents(state.account.balance + proceeds);
        rec = { id: 'tx-' + Date.now(), type: 'EXIT LONG', price, qty, amount: proceeds, realizedPnl };

    } else if (state.account.positionType === 'short') {
        const qtyToCover = -qty;
        const costToCover = roundToCents(qtyToCover * price);
        if (costToCover > state.account.balance) return { error: 'Insufficient funds to cover short position' };
        
        realizedPnl = roundToCents((avgPrice - price) * qtyToCover);
        state.account.balance = roundToCents(state.account.balance - costToCover);
        rec = { id: 'tx-' + Date.now(), type: 'EXIT SHORT', price, qty: qtyToCover, amount: costToCover, realizedPnl };
    }
    
    state.account.realizedPnl = roundToCents(state.account.realizedPnl + realizedPnl);
    state.account.history.unshift(rec);
    state.account.holdings = { qty: 0, avgPrice: 0 };
    state.account.positionType = null;
    return { success: true, trade: rec };
}


/* Helpers */
function addFunds(amount) {
    amount = Number(amount);
    if (!isFinite(amount) || amount <= 0) return { error: 'invalid amount' };
    state.account.balance = roundToCents(state.account.balance + amount);
    const rec = { id: 'fund-' + Date.now(), time: nowIso(), type: 'FUND', amount: roundToCents(amount) };
    state.account.history.unshift(rec);
    return { success: true, rec };
}

function resetSession() {
    state.account = JSON.parse(JSON.stringify(initialAccountState));
    renderAccount();
    renderCandles();
    toast('Session has been reset', 'success');
}


function getLatestPrice() {
    return state.candles.length ? state.candles[state.candles.length - 1] : null;
}

/* DOM Elements */
const DOM = {};

function initDom() {
    DOM.svg = document.getElementById('chart-svg');
    DOM.amountInput = document.getElementById('amount');
    DOM.balanceEl = document.getElementById('balance');
    DOM.holdingsEl = document.getElementById('holdings');
    DOM.pnlEl = document.getElementById('pnl');
    DOM.realizedPnlEl = document.getElementById('realized-pnl');
    DOM.positionTypeLabel = document.getElementById('position-type-label');
    DOM.historyEl = document.getElementById('history');
    DOM.addFundsBtn = document.getElementById('add-funds');
    DOM.buyBtn = document.getElementById('buy-btn');
    DOM.shortBtn = document.getElementById('short-btn');
    DOM.exitBtn = document.getElementById('exit-btn');
    DOM.resetBtn = document.getElementById('reset-btn');
    DOM.currentPriceEl = document.getElementById('current-price');
    DOM.priceChangeEl = document.getElementById('price-change');

    DOM.addFundsBtn.addEventListener('click', () => {
        addFunds(1000);
        renderAccount();
        toast('Added $1000 to your account', 'success');
    });

    DOM.buyBtn.addEventListener('click', () => {
        const amt = parseFloat(DOM.amountInput.value || '0');
        const res = executeOrder('buy', amt);
        if (res.error) {
          toast(res.error, 'error');
          return;
        }
        renderAccount();
        renderCandles();
        toast(`Bought ${res.trade.qty.toFixed(4)} @ $${res.trade.price.toFixed(2)}`, 'success');
    });

    DOM.shortBtn.addEventListener('click', () => {
        const amt = parseFloat(DOM.amountInput.value || '0');
        const res = executeOrder('short', amt);
        if (res.error) {
          toast(res.error, 'error');
          return;
        }
        renderAccount();
        renderCandles();
        toast(`Shorted ${res.trade.qty.toFixed(4)} @ $${res.trade.price.toFixed(2)}`, 'success');
    });

    DOM.exitBtn.addEventListener('click', () => {
        const res = exitPosition();
        if (res.error) {
          toast(res.error, 'error');
          return;
        }
        renderAccount();
        renderCandles();
        const pnl = res.trade.realizedPnl;
        const pnlMsg = pnl >= 0 ? `Profit: $${pnl.toFixed(2)}` : `Loss: $${pnl.toFixed(2)}`;
        toast(`Position exited. ${pnlMsg}`, 'success');
    });
    
    DOM.resetBtn.addEventListener('click', resetSession);

    renderAccount();
    renderCandles();
}

function toast(msg, type = 'success') {
    const toastEl = document.getElementById('toast');
    toastEl.textContent = msg;
    toastEl.className = `toast toast-${type}`;
    toastEl.style.opacity = 1;

    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
        toastEl.style.opacity = 0;
    }, 3000);
}

function updateButtonStates() {
    const hasPosition = !!state.account.positionType;
    DOM.buyBtn.disabled = hasPosition;
    DOM.shortBtn.disabled = hasPosition;
    DOM.amountInput.disabled = hasPosition;
    DOM.exitBtn.disabled = !hasPosition;
}

function renderAccount() {
    DOM.balanceEl.textContent = '$' + state.account.balance.toFixed(2);
    DOM.holdingsEl.textContent = state.account.holdings.qty.toFixed(CONFIG.qtyDecimals);

    // Render Realized P&L
    const totalPnl = state.account.realizedPnl;
    DOM.realizedPnlEl.textContent = (totalPnl >= 0 ? '' : '-') + '$' + Math.abs(totalPnl).toFixed(2);
    if (totalPnl > 0) DOM.realizedPnlEl.style.color = 'var(--accent-success)';
    else if (totalPnl < 0) DOM.realizedPnlEl.style.color = 'var(--accent-danger)';
    else DOM.realizedPnlEl.style.color = 'var(--text-primary)';


    // Render Unrealized P&L
    const latest = getLatestPrice();
    let pnlText = '$0.00';
    
    if (latest && state.account.positionType) {
        const currentVal = state.account.holdings.qty * latest.close;
        const entryVal = state.account.holdings.qty * state.account.holdings.avgPrice;
        const pnl = roundToCents(currentVal - entryVal);
        pnlText = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
        DOM.pnlEl.style.color = pnl >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)';
        const typeStr = state.account.positionType === 'long' ? 'Long' : 'Short';
        DOM.positionTypeLabel.textContent = `(${typeStr})`;
    } else {
        DOM.pnlEl.style.color = 'var(--text-primary)';
        DOM.positionTypeLabel.textContent = `(None)`;
    }
    DOM.pnlEl.textContent = pnlText;

    // Update price display
    if (latest) {
        DOM.currentPriceEl.textContent = '$' + latest.close.toFixed(2);
        const change = ((latest.close - state.previousPrice) / state.previousPrice) * 100;
        DOM.priceChangeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
        DOM.priceChangeEl.className = 'price-change ' + (change >= 0 ? 'positive' : 'negative');
        state.previousPrice = latest.close;
    }

    // Render transaction history
    DOM.historyEl.innerHTML = '';
    state.account.history.slice(0, 20).forEach(tx => {
        const div = document.createElement('div');
        div.className = 'transaction';
        
        let typeClass = 'transaction-fund';
        if (tx.type === 'BUY') typeClass = 'transaction-buy';
        else if (tx.type === 'SHORT') typeClass = 'transaction-sell';
        else if (tx.type.includes('EXIT')) typeClass = 'transaction-exit';

        let pnlHtml = '';
        if (tx.realizedPnl !== undefined) {
            const isProfit = tx.realizedPnl >= 0;
            const pnlClass = isProfit ? 'transaction-pnl-positive' : 'transaction-pnl-negative';
            pnlHtml = `<div class="transaction-pnl ${pnlClass}">
                ${isProfit ? 'Gain' : 'Loss'}: $${Math.abs(tx.realizedPnl).toFixed(2)}
            </div>`;
        }

        div.innerHTML = `
            <div class="transaction-type ${typeClass}">${tx.type}</div>
            <div class="transaction-details">
                ${tx.type === 'FUND' 
                    ? `<div class="transaction-amount">+$${tx.amount.toFixed(2)}</div>`
                    : `<div class="transaction-amount">${tx.qty.toFixed(4)} @ $${tx.price.toFixed(2)}</div>`
                }
                ${pnlHtml}
                <div class="transaction-time">${new Date(tx.time || Date.now()).toLocaleTimeString()}</div>
            </div>
        `;
        DOM.historyEl.appendChild(div);
    });
    
    updateButtonStates();
}

/* Chart Rendering */
function renderCandles() {
    const svg = DOM.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 400;
    const paddingRight = 60; // Space for price labels
    const chartWidth = w - paddingRight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const candles = state.candles.slice(-Math.min(CONFIG.maxCandles, state.candles.length));
    if (candles.length === 0) return;

    const prices = candles.flatMap(c => [c.high, c.low]);
    const maxP = Math.max(...prices);
    const minP = Math.min(...prices);
    const pad = (maxP - minP) * 0.08 || 1;
    const top = maxP + pad;
    const bottom = Math.max(0.0001, minP - pad);

    const px = (p) => h - ((p - bottom) / (top - bottom)) * h;

    const count = candles.length;
    const candleWidth = Math.max(4, Math.floor(chartWidth / count * 0.7));
    const gap = Math.max(1, Math.floor((chartWidth - candleWidth * count) / Math.max(1, count - 1)));

    // Draw grid lines and price labels
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const price = bottom + (top - bottom) * (i / gridLines);
        const y = px(price);
        
        const line = document.createElementNS(svg.namespaceURI, 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('x2', chartWidth); // End line at chart edge
        line.setAttribute('y1', y);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', 'var(--border-color)');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '2,2');
        svg.appendChild(line);

        const label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', w - 10); // Position label in the padding area
        label.setAttribute('y', y > 10 ? y - 5 : 10);
        label.setAttribute('fill', 'var(--text-muted)');
        label.setAttribute('font-size', '10');
        label.setAttribute('text-anchor', 'end');
        label.textContent = '$' + price.toFixed(2);
        svg.appendChild(label);
    }

    // Draw entry position line if active
    if (state.account.positionType) {
        const entryY = px(state.account.holdings.avgPrice);
        const entryLine = document.createElementNS(svg.namespaceURI, 'line');
        entryLine.setAttribute('x1', 0);
        entryLine.setAttribute('x2', chartWidth);
        entryLine.setAttribute('y1', entryY);
        entryLine.setAttribute('y2', entryY);
        entryLine.setAttribute('stroke', 'var(--accent-warning)');
        entryLine.setAttribute('stroke-width', '1.5');
        entryLine.setAttribute('stroke-dasharray', '4,4');
        svg.appendChild(entryLine);
    }
    
    // Draw candles
    let x = 0;
    for (let i = 0; i < count; i++) {
        const c = candles[i];
        const isUp = c.close >= c.open;
        const color = isUp ? 'var(--accent-success)' : 'var(--accent-danger)';

        const bodyY = px(Math.max(c.open, c.close));
        const bodyHeight = Math.max(1, Math.abs(px(c.open) - px(c.close)));
        
        const rect = document.createElementNS(svg.namespaceURI, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', bodyY);
        rect.setAttribute('width', candleWidth);
        rect.setAttribute('height', bodyHeight);
        rect.setAttribute('fill', color);
        svg.appendChild(rect);

        x += candleWidth + gap;
    }
}

/* Start Generator Loop */
function startCandleLoop() {
    let prev = null;
    for (let i = 0; i < 40; i++) {
        const c = generateNextCandle(prev);
        state.candles.push(c);
        prev = c;
    }
    renderCandles();
    renderAccount();

    setInterval(() => {
        const next = generateNextCandle(state.candles[state.candles.length - 1]);
        state.candles.push(next);
        if (state.candles.length > CONFIG.maxCandles) state.candles.shift();
        renderCandles();
        renderAccount();
    }, CONFIG.candleIntervalMs);
}

/* Initialize */
document.addEventListener('DOMContentLoaded', () => {
    initDom();
    startCandleLoop();
    window.addEventListener('resize', renderCandles);
});