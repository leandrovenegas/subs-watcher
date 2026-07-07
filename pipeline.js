const path = require('path');
const fs = require('fs');
const { getSettings, updateQueueEntry } = require('./supabase');
const { transcribe } = require('./transcribe');
const { renderSoftsub, renderHardsub, getVideoDuration } = require('./render');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './temp');
const INPUT_DIR = path.resolve(process.env.INPUT_DIR || './input');

const DEFAULT_TEMPLATE = {
  fontFamily: 'Arial',
  fontSize: 24,
  fontColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 2,
  position: 'bottom',
  verticalPosition: 10,
  maxLines: 1,
  mode: 'lipsync' // lipsync by default
};

/**
 * Process a single queue entry through the full pipeline:
 *   1. Verify file exists
 *   2. Get video duration
 *   3. Transcribe (0% - 50% progress)
 *   4. Render softsub (50% - 75% progress)
 *   5. Render hardsub (75% - 100% progress)
 *   6. Clean up temp files
 *   7. Update Supabase status to completed
 *
 * @param {object} entry - { id, filename } from subs_pipeline_queue
 */
async function processEntry(entry) {
  const { id, filename } = entry;
  const inputPath = path.resolve(INPUT_DIR, filename);
  const basename = path.basename(filename, path.extname(filename));
  const outputBase = path.resolve(OUTPUT_DIR, basename);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PIPELINE START: ${filename}`);
  console.log(`  Queue ID: ${id}`);
  console.log(`${'═'.repeat(60)}`);

  // Verify input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`  [pipeline] ✗ Input file not found: ${inputPath}`);
    await updateQueueEntry(id, { status: 'error', progress: 0, output_path: 'Archivo no encontrado' });
    return;
  }

  const fileSize = fs.statSync(inputPath).size;
  console.log(`  [pipeline] Input: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  try {
    // Mark as processing with 0% progress
    await updateQueueEntry(id, { status: 'procesando', progress: 0 });

    // Fetch video duration
    const duration = await getVideoDuration(inputPath);
    console.log(`  [pipeline] Video Duration: ${Math.round(duration)}s`);

    // Fetch current settings for the subtitle template
    const settings = await getSettings();
    const template = settings.template || DEFAULT_TEMPLATE;

    let lastProgressReported = 0;
    const reportProgress = async (prog) => {
      const rounded = Math.round(prog);
      if (rounded !== lastProgressReported && rounded <= 100) {
        lastProgressReported = rounded;
        try {
          await updateQueueEntry(id, { progress: rounded });
        } catch (e) {
          // ignore database update conflicts/timeouts
        }
      }
    };

    // --- Step 1: Transcribe (0% - 50%) ---
    console.log(`\n  [pipeline] ▸ Step 1/3: Transcription`);
    const transcriptionResult = await transcribe(inputPath, {
      tempDir: TEMP_DIR,
      model: process.env.WHISPER_MODEL || 'small',
      language: process.env.WHISPER_LANGUAGE || 'auto',
      template
    }, (whisperPercent) => {
      // whisperPercent is 0 to 100. Map to 0 - 50.
      reportProgress(whisperPercent * 0.50);
    });

    console.log(`  [pipeline] Transcription complete:`);
    console.log(`    Language: ${transcriptionResult.language}`);
    console.log(`    Duration: ${Math.round(transcriptionResult.duration)}s`);
    console.log(`    Segments: ${transcriptionResult.segmentsCount}`);

    // --- Step 2: Render softsub (50% - 75%) ---
    console.log(`\n  [pipeline] ▸ Step 2/3: Softsub render (zero quality loss)`);
    const softsubPath = await renderSoftsub(inputPath, transcriptionResult.srtPath, outputBase, {
      duration,
      onProgress: (renderPercent) => {
        // Map 0 - 100 of softsub render to 50 - 75
        reportProgress(50 + (renderPercent * 0.25));
      }
    });

    // --- Step 3: Render hardsub (75% - 100%) ---
    console.log(`\n  [pipeline] ▸ Step 3/3: Hardsub render (CRF 17)`);
    const hardsubPath = await renderHardsub(inputPath, transcriptionResult.assPath, outputBase, {
      duration,
      onProgress: (renderPercent) => {
        // Map 0 - 100 of hardsub render to 75 - 100
        reportProgress(75 + (renderPercent * 0.25));
      }
    });

    // --- Cleanup temp files ---
    for (const tmpFile of [transcriptionResult.srtPath, transcriptionResult.assPath]) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }

    // --- Update queue entry ---
    const outputPaths = {
      softsub: path.basename(softsubPath),
      hardsub: path.basename(hardsubPath)
    };

    await updateQueueEntry(id, {
      status: 'completado',
      progress: 100,
      output_path: JSON.stringify(outputPaths)
    });

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ✓ PIPELINE COMPLETE: ${filename}`);
    console.log(`    Softsub: ${outputPaths.softsub}`);
    console.log(`    Hardsub: ${outputPaths.hardsub}`);
    console.log(`${'─'.repeat(60)}\n`);

  } catch (err) {
    console.error(`\n  ✗ PIPELINE ERROR: ${filename}`);
    console.error(`    ${err.message}`);
    await updateQueueEntry(id, { status: 'error', progress: 0, output_path: err.message.slice(0, 500) });
  }
}

module.exports = { processEntry };
