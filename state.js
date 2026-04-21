const fs = require("fs");
const path = require("path");
const config = require("./config");
const defaultPairs = require("./pair");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureJsonFile(filePath, defaultValue) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

function readJson(filePath, defaultValue = null) {
  try {
    ensureJsonFile(filePath, defaultValue ?? {});
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : defaultValue;
  } catch (error) {
    console.error(`readJson failed for ${filePath}:`, error.message);
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendJsonArray(filePath, item) {
  const arr = readJson(filePath, []);
  arr.push(item);
  writeJson(filePath, arr);
  return arr;
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueUpper(values) {
  return [...new Set((values || []).map((v) => String(v).trim().toUpperCase()).filter(Boolean))];
}

function getAllowedPairs() {
  return uniqueUpper(defaultPairs);
}

function filterToAllowedPairs(pairs) {
  const allowed = new Set(getAllowedPairs());
  return uniqueUpper(pairs).filter((pair) => allowed.has(pair));
}

function defaultRuntimeSettings() {
  return {
    strategyRetentionHours: Number(config.defaultStrategyRetentionHours || 4),
    updatedAt: nowIso(),
  };
}

function ensureStorage() {
  ensureDir(config.storageDir || path.join(__dirname, "storage"));
  ensureDir(config.strategiesDir);
  ensureJsonFile(config.pairsPath, getAllowedPairs());
  ensureJsonFile(config.scoreStatePath, {});
  ensureJsonFile(config.activeSignalsPath, {});
  ensureJsonFile(config.dryRunPositionsPath, []);
  ensureJsonFile(config.closedTradesPath, []);
  ensureJsonFile(config.learnedPumpsPath, []);
  ensureJsonFile(config.strategiesIndexPath, []);
  ensureJsonFile(config.runtimeSettingsPath, defaultRuntimeSettings());
}

function getWatchedPairs() {
  const stored = readJson(config.pairsPath, getAllowedPairs()) || [];
  const filtered = filterToAllowedPairs(stored);
  return filtered.length ? filtered : getAllowedPairs();
}

function saveWatchedPairs(pairs) {
  const normalized = filterToAllowedPairs(pairs).sort();
  writeJson(config.pairsPath, normalized);
  return normalized;
}

function getRuntimeSettings() {
  const stored = readJson(config.runtimeSettingsPath, defaultRuntimeSettings()) || {};
  return {
    ...defaultRuntimeSettings(),
    ...stored,
    strategyRetentionHours: Number(stored.strategyRetentionHours || config.defaultStrategyRetentionHours || 4),
  };
}

function saveRuntimeSettings(patch = {}) {
  const next = {
    ...getRuntimeSettings(),
    ...patch,
    updatedAt: nowIso(),
  };
  writeJson(config.runtimeSettingsPath, next);
  return next;
}

function clearAllTradingStatus() {
  writeJson(config.activeSignalsPath, {});
  writeJson(config.dryRunPositionsPath, []);
  writeJson(config.closedTradesPath, []);
  return {
    cleared: true,
    clearedAt: nowIso(),
  };
}

function isJsonFile(fileName) {
  return String(fileName || "").toLowerCase().endsWith(".json");
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`safeUnlink failed for ${filePath}:`, error.message);
    return false;
  }
}

function clearAllTradingStrategies() {
  ensureDir(config.strategiesDir);
  const removedFiles = [];

  for (const fileName of fs.readdirSync(config.strategiesDir)) {
    if (!isJsonFile(fileName)) continue;
    const fullPath = path.join(config.strategiesDir, fileName);
    if (safeUnlink(fullPath)) removedFiles.push(fileName);
  }

  writeJson(config.strategiesIndexPath, []);
  writeJson(config.learnedPumpsPath, []);

  return {
    cleared: true,
    removedFiles,
    clearedAt: nowIso(),
  };
}

function parseDate(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function pruneStrategiesByRetentionHours(hours) {
  const retentionHours = Math.max(1, Number(hours || getRuntimeSettings().strategyRetentionHours || 4));
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const all = readJson(config.strategiesIndexPath, []);
  const kept = [];
  const removed = [];

  for (const item of all) {
    const ts = parseDate(item?.eventTime || item?.timestamp || item?.savedAt || item?.createdAt);
    if (ts && ts >= cutoff) kept.push(item);
    else removed.push(item);
  }

  writeJson(config.strategiesIndexPath, kept);
  saveRuntimeSettings({ strategyRetentionHours: retentionHours });

  return {
    retentionHours,
    cutoffIso: new Date(cutoff).toISOString(),
    kept: kept.length,
    removed: removed.length,
  };
}

module.exports = {
  ensureDir,
  ensureJsonFile,
  ensureStorage,
  readJson,
  writeJson,
  appendJsonArray,
  nowIso,
  uniqueUpper,
  getAllowedPairs,
  filterToAllowedPairs,
  getWatchedPairs,
  saveWatchedPairs,
  getRuntimeSettings,
  saveRuntimeSettings,
  clearAllTradingStatus,
  clearAllTradingStrategies,
  pruneStrategiesByRetentionHours,
};