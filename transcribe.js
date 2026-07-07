const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Extract audio from video as 16 kHz mono WAV (required by whisper).
 * @param {string} videoPath
 * @param {string} tempDir
 * @returns {Promise<string>} path to extracted WAV file
 */
function extractAudio(videoPath, tempDir) {
  return new Promise((resolve, reject) => {
    const basename = path.basename(videoPath, path.extname(videoPath));
    const wavPath = path.join(tempDir, `${basename}.wav`);

    const args = [
      '-i', videoPath,
      '-vn',               // no video
      '-ar', '16000',      // 16 kHz (whisper standard)
      '-ac', '1',          // mono
      '-f', 'wav',
      '-y',                // overwrite
      wavPath
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve(wavPath);
      else reject(new Error(`FFmpeg audio extraction failed (code ${code}): ${stderr.slice(-500)}`));
    });

    proc.on('error', (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
  });
}

/**
 * Run the Python transcription script and parse JSON output.
 * @param {string} audioPath
 * @param {object} opts - { model, language, srtPath, assPath, template }
 * @param {function} onProgress - Callback function(percent)
 * @returns {Promise<object>} transcription result
 */
function runPythonTranscribe(audioPath, { model, language, srtPath, assPath, template }, onProgress) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'transcribe.py');
    const templateJson = JSON.stringify(template);

    // Use virtualenv Python to access faster-whisper
    const pythonBin = path.join(__dirname, 'venv', 'bin', 'python3');
    const proc = spawn(pythonBin, [
      scriptPath, audioPath, model, language, srtPath, assPath, templateJson
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let lastResult = null;
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.status === 'progress' && onProgress) {
            onProgress(parsed.percent);
          } else {
            console.log(`    [whisper] ${parsed.status || 'info'}${parsed.model ? ` (${parsed.model})` : ''}${parsed.segments_count !== undefined ? ` — ${parsed.segments_count} segments` : ''}`);
          }
          if (parsed.status === 'done') lastResult = parsed;
          if (parsed.error) reject(new Error(parsed.error));
        } catch {
          // Non-JSON output from Python, ignore
        }
      }
    });

    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && lastResult) {
        resolve(lastResult);
      } else {
        reject(new Error(`Transcription process failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`Python spawn error: ${err.message}`)));
  });
}

/**
 * Full transcription pipeline: extract audio → run whisper → return subtitle paths.
 *
 * @param {string} videoPath - Absolute path to input video
 * @param {object} options
 * @param {string} options.tempDir   - Directory for temporary files
 * @param {string} options.model     - Whisper model size (tiny|base|small|medium|large)
 * @param {string} options.language  - Language code or 'auto'
 * @param {object} options.template  - Subtitle style template from Supabase
 * @param {function} onProgress      - Progress callback
 * @returns {Promise<{ srtPath: string, assPath: string, language: string, duration: number, segmentsCount: number }>}
 */
async function transcribe(videoPath, { tempDir, model, language, template }, onProgress) {
  const basename = path.basename(videoPath, path.extname(videoPath));
  const srtPath = path.join(tempDir, `${basename}.srt`);
  const assPath = path.join(tempDir, `${basename}.ass`);

  // Step 1: Extract audio to WAV
  console.log(`    [transcribe] Extracting audio from ${path.basename(videoPath)}...`);
  const audioPath = await extractAudio(videoPath, tempDir);
  const audioSize = fs.statSync(audioPath).size;
  console.log(`    [transcribe] Audio extracted: ${(audioSize / 1024 / 1024).toFixed(1)} MB`);

  // Step 2: Run faster-whisper via Python
  console.log(`    [transcribe] Running faster-whisper (model: ${model}, lang: ${language})...`);
  const result = await runPythonTranscribe(audioPath, {
    model,
    language,
    srtPath,
    assPath,
    template
  }, onProgress);

  // Step 3: Clean up temporary audio
  try { fs.unlinkSync(audioPath); } catch { /* ignore */ }

  return {
    srtPath: result.srt_path,
    assPath: result.ass_path,
    language: result.language,
    duration: result.duration,
    segmentsCount: result.segments_count
  };
}

module.exports = { transcribe };
