const config = require("./config");
const { readJson, writeJson, nowIso } = require("./state");
const { round } = require("./indicators");

function pickFiniteNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function normalizeTradeStatus(status) {
  const value = String(status || "OPEN").toUpperCase();

  if (value.includes("TARGET ACHIEVED")) return "TARGET ACHIEVED";
  if (value === "SL1" || value === "SL2" || value === "SL HIT") return "SL HIT";
  if (value === "DISABLED" || value === "REMOVED") return "DISABLED";
  return "OPEN";
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))];
}

function normalizePosition(position, options = {}) {
  const normalized = { ...position };
  const targetPrice =
    pickFiniteNumber(normalized.targetPrice, normalized.target2Price, normalized.target1Price) ?? 0;
  const stopPrice =
    pickFiniteNumber(normalized.stopPrice, normalized.sl2Price, normalized.sl1Price) ?? 0;
  const pnlStatus = normalizeTradeStatus(normalized.pnlStatus ?? normalized.pnl2Status);
  const pnlClosedAt = normalized.pnlClosedAt ?? normalized.pnl2ClosedAt ?? null;
  const pnlExitPrice = pickFiniteNumber(normalized.pnlExitPrice, normalized.pnl2ExitPrice) ?? null;
  const pnlPct = round(pickFiniteNumber(normalized.pnlPct, normalized.pnl2PnlPct) ?? 0, 6);
  const pnlAmount = round(pickFiniteNumber(normalized.pnlAmount, normalized.pnl2PnlAmount) ?? 0, 6);

  normalized.targetPrice = targetPrice;
  normalized.target2Price = targetPrice;
  normalized.target1Price = null;
  normalized.stopPrice = stopPrice;
  normalized.sl2Price = stopPrice;
  normalized.sl1Price = null;
  normalized.tp1 = targetPrice;

  normalized.pnlStatus = pnlStatus;
  normalized.pnlClosedAt = pnlClosedAt;
  normalized.pnlExitPrice = pnlExitPrice;
  normalized.pnlPct = pnlPct;
  normalized.pnlAmount = pnlAmount;

  normalized.pnl1Status =
    normalized.pnl1Status && normalized.pnl1Status !== "OPEN"
      ? normalized.pnl1Status
      : "DISABLED";
  normalized.pnl2Status = pnlStatus;
  normalized.pnl1ClosedAt = normalized.pnl1ClosedAt ?? null;
  normalized.pnl2ClosedAt = pnlClosedAt;
  normalized.pnl1ExitPrice = normalized.pnl1ExitPrice ?? null;
  normalized.pnl2ExitPrice = pnlExitPrice;
  normalized.pnl1PnlPct = round(pickFiniteNumber(normalized.pnl1PnlPct) ?? 0, 6);
  normalized.pnl2PnlPct = pnlPct;
  normalized.pnl1PnlAmount = round(pickFiniteNumber(normalized.pnl1PnlAmount) ?? 0, 6);
  normalized.pnl2PnlAmount = pnlAmount;

  const existingRealized = round(pickFiniteNumber(normalized.realizedPnl) ?? 0, 6);
  const closed = options.closed || pnlStatus !== "OPEN";

  if (closed) {
    normalized.blocksNewSignals = false;
    normalized.monitoringActive = false;
    normalized.status = "CLOSED";
    normalized.closeTime =
      normalized.closeTime || normalized.closedAt || normalized.pnlClosedAt || null;
    normalized.closedAt = normalized.closeTime;
    normalized.realizedPnl = existingRealized || pnlAmount;
    return normalized;
  }

  normalized.blocksNewSignals =
    typeof normalized.blocksNewSignals === "boolean" ? normalized.blocksNewSignals : true;
  normalized.monitoringActive = normalized.monitoringActive !== false;
  normalized.status = "OPEN";
  normalized.realizedPnl = existingRealized;

  return normalized;
}

function loadOpenPositions() {
  return readJson(config.dryRunPositionsPath, []).map((position) => normalizePosition(position));
}

function saveOpenPositions(positions) {
  writeJson(
    config.dryRunPositionsPath,
    (positions || []).map((position) => normalizePosition(position))
  );
}

function loadClosedTrades() {
  return readJson(config.closedTradesPath, []).map((trade) =>
    normalizePosition(trade, { closed: true })
  );
}

function saveClosedTrades(trades) {
  writeJson(
    config.closedTradesPath,
    (trades || []).map((trade) => normalizePosition(trade, { closed: true }))
  );
}

function computeSignedPct(side, entry, exitPrice) {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exitPrice)) return 0;
  if (String(side).toUpperCase() === "SHORT") {
    return ((entry - exitPrice) / entry) * 100;
  }
  return ((exitPrice - entry) / entry) * 100;
}

function computeSignedAmount(notional, pct) {
  return round(Number(notional || 0) * (Number(pct || 0) / 100), 6);
}

function getSignalKey(signal) {
  return String(
    signal.signalKey ||
      [signal.pair, signal.side, signal.baseTimeframe]
        .map((v) => String(v || "").toUpperCase())
        .join("|")
  );
}

function buildStrategyUsed(signal) {
  return (
    signal.strategyUsed ||
    signal.strategySource ||
    `${signal.strategySourcePair || signal.sourcePair || "N/A"} ${
      signal.strategySourceTimeframe || signal.sourceTimeframe || ""
    }`.trim()
  );
}

function createPosition(signal) {
  const notional = Number(config.dryRunNotional || 100);
  const entry = Number(signal.entryPrice ?? signal.entry ?? 0);
  const qty = entry > 0 ? notional / entry : 0;
  const targetPrice = Number(signal.targetPrice ?? signal.target2Price);
  const stopPrice = Number(signal.stopPrice ?? signal.sl2Price ?? signal.stopLoss);

  return normalizePosition({
    signalId: signal.signalId || `${signal.pair}-${signal.side}-${signal.baseTimeframe}-${Date.now()}`,
    id: signal.signalId || `${signal.pair}-${signal.side}-${signal.baseTimeframe}-${Date.now()}`,
    signalKey: getSignalKey(signal),
    pair: String(signal.pair || "").toUpperCase(),
    side: String(signal.side || "LONG").toUpperCase(),
    baseTimeframe: signal.baseTimeframe,
    supportTimeframes: uniqueStrings(signal.supportTimeframes || signal.supportTfs || []),
    supportTimeframeCount: uniqueStrings(signal.supportTimeframes || signal.supportTfs || []).length,
    entryPrice: entry,
    entry,
    quantity: round(qty, 8),
    notional,
    targetPrice,
    target2Price: targetPrice,
    target1Price: null,
    stopPrice,
    sl2Price: stopPrice,
    sl1Price: null,
    tp1: targetPrice,
    tp2: Number(signal.ignoredTp3),
    tp3: Number(signal.ignoredTp4),
    ignoredTp3: Number(signal.ignoredTp3),
    ignoredTp4: Number(signal.ignoredTp4),
    originalSystemTp1: Number(signal.originalSystemTp1),
    originalSystemSl: Number(signal.originalSystemSl),
    strategyUsed: buildStrategyUsed(signal),
    strategySource: buildStrategyUsed(signal),
    score: Number(signal.score || 0),
    signalMessageId: signal.signalMessageId || null,
    messageId: signal.signalMessageId || null,
    openedAt: nowIso(),
    openTime: nowIso(),
    closeTime: null,
    currentMark: entry,
    unrealizedPnl: 0,
    realizedPnl: 0,
    pnlStatus: "OPEN",
    pnlClosedAt: null,
    pnlExitPrice: null,
    pnlPct: 0,
    pnlAmount: 0,
    pnl1Status: "DISABLED",
    pnl2Status: "OPEN",
    pnl1ClosedAt: null,
    pnl2ClosedAt: null,
    pnl1ExitPrice: null,
    pnl2ExitPrice: null,
    pnl1PnlPct: 0,
    pnl2PnlPct: 0,
    pnl1PnlAmount: 0,
    pnl2PnlAmount: 0,
    blocksNewSignals: true,
    monitoringActive: true,
    status: "OPEN",
  });
}

function updatePositionMark(position, mark) {
  position.currentMark = mark;
  const move = position.side === "LONG" ? mark - position.entryPrice : position.entryPrice - mark;
  position.unrealizedPnl = round(move * position.quantity, 6);
  return position;
}

function isFullyClosed(position) {
  return normalizeTradeStatus(position.pnlStatus ?? position.pnl2Status) !== "OPEN";
}

function releaseSignalGate(position) {
  if (position.blocksNewSignals && isFullyClosed(position)) {
    position.blocksNewSignals = false;
    position.firstClosedAt = position.firstClosedAt || nowIso();
  }
}

function refreshOverallStatus(position) {
  if (isFullyClosed(position)) {
    position.monitoringActive = false;
    position.status = "CLOSED";
    position.closeTime = position.closeTime || nowIso();
    position.closedAt = position.closeTime;
    position.realizedPnl = round(Number(position.pnlAmount || 0), 6);
  } else {
    position.monitoringActive = true;
    position.status = "OPEN";
  }
  return position;
}

function markTradeClosed(position, status, exitPrice) {
  if (normalizeTradeStatus(position.pnlStatus ?? position.pnl2Status) !== "OPEN") return null;

  const now = nowIso();
  const pct = computeSignedPct(position.side, position.entryPrice, exitPrice);
  const amount = computeSignedAmount(position.notional, pct);

  position.pnlStatus = status;
  position.pnlClosedAt = now;
  position.pnlExitPrice = exitPrice;
  position.pnlPct = round(pct, 6);
  position.pnlAmount = amount;

  position.pnl2Status = status;
  position.pnl2ClosedAt = now;
  position.pnl2ExitPrice = exitPrice;
  position.pnl2PnlPct = position.pnlPct;
  position.pnl2PnlAmount = amount;

  releaseSignalGate(position);
  refreshOverallStatus(position);

  return {
    type: status,
    position: { ...position },
    pair: position.pair,
    side: position.side,
    signalKey: position.signalKey,
    signalMessageId: position.signalMessageId,
  };
}

function findExistingTrackedSignal(pair, side, baseTimeframe) {
  return loadOpenPositions().find(
    (p) =>
      p.pair === String(pair || "").toUpperCase() &&
      p.side === String(side || "").toUpperCase() &&
      p.baseTimeframe === baseTimeframe &&
      p.monitoringActive &&
      p.blocksNewSignals
  );
}

function canOpenNewSignal() {
  return !loadOpenPositions().some((p) => p.monitoringActive && p.blocksNewSignals);
}

function getBlockingOpenTrades() {
  return loadOpenPositions().filter((position) => position.monitoringActive && position.blocksNewSignals);
}

function registerSignal(signal) {
  const existing = findExistingTrackedSignal(signal.pair, signal.side, signal.baseTimeframe);
  if (existing) return existing;
  if (!canOpenNewSignal()) return null;

  const positions = loadOpenPositions();
  const position = createPosition(signal);
  positions.push(position);
  saveOpenPositions(positions);
  return position;
}

function attachSignalMessage(signalId, messageId, signalKey) {
  const positions = loadOpenPositions();
  let updated = null;

  for (const position of positions) {
    if (position.signalId === signalId || position.id === signalId || position.signalKey === signalKey) {
      position.signalMessageId = messageId || position.signalMessageId;
      position.messageId = messageId || position.messageId;
      if (signalKey) position.signalKey = signalKey;
      updated = { ...position };
      break;
    }
  }

  if (updated) saveOpenPositions(positions);
  return updated;
}

function clearOpenTrades() {
  const openPositions = loadOpenPositions();
  saveOpenPositions([]);

  return {
    removedCount: openPositions.length,
    removedTrades: openPositions,
    removedSignalKeys: openPositions
      .map((position) => position.signalKey)
      .filter(Boolean),
  };
}

function evaluateTargetsAndStops(priceByPair) {
  const openPositions = loadOpenPositions();
  const stillOpen = [];
  const closedTrades = loadClosedTrades();
  const updates = [];

  for (const position of openPositions) {
    const mark = Number(priceByPair[position.pair]);
    if (!Number.isFinite(mark)) {
      stillOpen.push(position);
      continue;
    }

    updatePositionMark(position, mark);

    if (normalizeTradeStatus(position.pnlStatus ?? position.pnl2Status) === "OPEN") {
      const targetHit =
        position.side === "LONG" ? mark >= position.targetPrice : mark <= position.targetPrice;
      const stopHit =
        position.side === "LONG" ? mark <= position.stopPrice : mark >= position.stopPrice;

      if (targetHit) {
        const event = markTradeClosed(position, "TARGET ACHIEVED", position.targetPrice);
        if (event) updates.push(event);
      } else if (stopHit) {
        const event = markTradeClosed(position, "SL HIT", position.stopPrice);
        if (event) updates.push(event);
      }
    }

    refreshOverallStatus(position);

    if (isFullyClosed(position)) {
      closedTrades.push({ ...position });
    } else {
      stillOpen.push(position);
    }
  }

  saveOpenPositions(stillOpen);
  saveClosedTrades(closedTrades);
  return updates;
}

function getAllTrades() {
  return [...loadOpenPositions(), ...loadClosedTrades()];
}

function summarizeTrades(trades) {
  const totalSignals = trades.length;
  const targetCount = trades.filter(
    (trade) => normalizeTradeStatus(trade.pnlStatus ?? trade.pnl2Status) === "TARGET ACHIEVED"
  ).length;
  const slCount = trades.filter(
    (trade) => normalizeTradeStatus(trade.pnlStatus ?? trade.pnl2Status) === "SL HIT"
  ).length;
  const cumulativeProfitLoss = round(
    trades.reduce((sum, trade) => sum + Number(trade.realizedPnl || trade.pnlAmount || 0), 0),
    6
  );

  return {
    totalSignals,
    targetCount,
    slCount,
    winRate: totalSignals ? round((targetCount / totalSignals) * 100, 2) : 0,
    lossRate: totalSignals ? round((slCount / totalSignals) * 100, 2) : 0,
    cumulativeProfitLoss,
  };
}

function pnlModelSummary() {
  return summarizeTrades(getAllTrades());
}

function pnlSummary() {
  const openPositions = loadOpenPositions();
  const closedTrades = loadClosedTrades();
  const allTrades = [...openPositions, ...closedTrades];
  const blocking = openPositions.filter((p) => p.blocksNewSignals).length;
  const backgroundMonitoring = openPositions.filter((p) => !p.blocksNewSignals).length;

  return {
    openCount: openPositions.length,
    closedCount: closedTrades.length,
    blockingSignals: blocking,
    backgroundMonitoring,
    openUnrealized: round(
      openPositions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0),
      6
    ),
    realized: round(
      allTrades.reduce((sum, trade) => sum + Number(trade.realizedPnl || trade.pnlAmount || 0), 0),
      6
    ),
    pnl: summarizeTrades(allTrades),
  };
}

module.exports = {
  loadOpenPositions,
  saveOpenPositions,
  loadClosedTrades,
  saveClosedTrades,
  getAllTrades,
  registerSignal,
  attachSignalMessage,
  evaluateTargetsAndStops,
  pnlSummary,
  pnlModelSummary,
  canOpenNewSignal,
  getBlockingOpenTrades,
  clearOpenTrades,
  findExistingTrackedSignal,
  findExistingOpen: findExistingTrackedSignal,
};
