require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { getSettings, createQueueEntry, getPendingEntries } = require('./supabase');
const { processEntry } = require('./pipeline');

const INPUT_DIR = path.resolve(process.env.INPUT_DIR || './input');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './temp');
const POLL_INTERVAL = (parseInt(process.env.POLL_INTERVAL_SEC) || 15) * 1000;

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.ts', '.m4v'
]);

// Ensure required directories exist
[INPUT_DIR, OUTPUT_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[watcher] Created directory: ${dir}`);
  }
});

// Logs directory
const logsDir = path.resolve('./logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

let isProcessing = false;
const knownFiles = new Set();

/**
 * Wait for a file to stabilize (size stops changing).
 * Prevents processing files that are still being copied/written.
 */
async function waitForStable(filePath, checkInterval = 2000, maxWait = 600000) {
  let lastSize = -1;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === lastSize && stats.size > 0) {
        return true;
      }
      lastSize = stats.size;
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, checkInterval));
  }
  console.warn(`[watcher] File did not stabilize within ${maxWait / 1000}s: ${filePath}`);
  return false;
}

/**
 * Handle a new video file detected by chokidar.
 */
async function onNewVideo(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  // Skip non-video files
  if (!VIDEO_EXTENSIONS.has(ext)) return;

  // Skip already-known files
  if (knownFiles.has(filename)) return;
  knownFiles.add(filename);

  console.log(`[watcher] 📁 New video detected: ${filename}`);

  // Wait for file to finish being written
  console.log(`[watcher] Waiting for file to stabilize...`);
  const stable = await waitForStable(filePath);
  if (!stable) {
    console.error(`[watcher] ✗ File unstable or removed: ${filename}`);
    knownFiles.delete(filename);
    return;
  }

  const size = fs.statSync(filePath).size;
  console.log(`[watcher] ✓ File ready: ${filename} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  // Create queue entry in Supabase
  try {
    const entry = await createQueueEntry(filename);
    console.log(`[watcher] Queued: ${filename} → id ${entry.id}`);
  } catch (err) {
    console.error(`[watcher] Failed to queue ${filename}: ${err.message}`);
    knownFiles.delete(filename);
  }
}

/**
 * Poll for pending entries and process them if auto_mode is enabled.
 */
async function processPending() {
  if (isProcessing) return;

  try {
    const settings = await getSettings();

    if (!settings.auto_mode) {
      // Silently skip — auto mode is off
      return;
    }

    const pending = await getPendingEntries();
    if (pending.length === 0) return;

    isProcessing = true;
    console.log(`\n[watcher] 🔄 ${pending.length} pending entry(ies), auto_mode: ON — starting processing\n`);

    for (const entry of pending) {
      // Re-check auto_mode before each entry (user may toggle mid-batch)
      const currentSettings = await getSettings();
      if (!currentSettings.auto_mode) {
        console.log(`[watcher] ⏸  Auto mode turned OFF mid-batch, pausing`);
        break;
      }

      await processEntry(entry);
    }
  } catch (err) {
    console.error(`[watcher] Poll error: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

// ─── Startup Banner ───────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║          SubsPipeline — File Watcher             ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log(`  Input dir:     ${INPUT_DIR}`);
console.log(`  Output dir:    ${OUTPUT_DIR}`);
console.log(`  Temp dir:      ${TEMP_DIR}`);
console.log(`  Poll interval: ${POLL_INTERVAL / 1000}s`);
console.log(`  Whisper model: ${process.env.WHISPER_MODEL || 'small'}`);
console.log(`  Language:      ${process.env.WHISPER_LANGUAGE || 'auto'}`);
console.log('');

// ─── Initialize chokidar ─────────────────────────────────────
const watcher = chokidar.watch(INPUT_DIR, {
  ignored: /(^|[/\\])\./,         // ignore dotfiles
  persistent: true,
  ignoreInitial: false,            // process existing files on startup
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 500
  }
});

watcher.on('add', onNewVideo);
watcher.on('error', (err) => console.error('[watcher] chokidar error:', err));

console.log(`[watcher] 👁  Watching for new videos...\n`);

// ─── Start polling loop ──────────────────────────────────────
setInterval(processPending, POLL_INTERVAL);

// Process any existing pending entries after a short startup delay
setTimeout(processPending, 3000);
