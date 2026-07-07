const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Get video duration in seconds using ffmpeg stderr output
 * @param {string} videoPath
 * @returns {Promise<number>} duration in seconds
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-i', videoPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const centiseconds = parseInt(match[4], 10);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
        resolve(totalSeconds || 1.0);
      } else {
        resolve(1.0); // fallback
      }
    });
  });
}

/**
 * Render softsub version — zero quality loss.
 * Muxes SRT subtitle as a separate stream inside an MKV container.
 * Video and audio streams are copied without re-encoding.
 *
 * @param {string} videoPath  - Path to original video
 * @param {string} srtPath    - Path to .srt subtitle file
 * @param {string} outputBase - Base path for output (without extension)
 * @param {object} opts       - { duration, onProgress }
 * @returns {Promise<string>} path to the generated softsub file
 */
function renderSoftsub(videoPath, srtPath, outputBase, { duration = 1.0, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const outPath = `${outputBase}_softsub.mkv`;

    const args = [
      '-i', videoPath,
      '-i', srtPath,
      '-c', 'copy',          // copy all streams (no re-encode)
      '-c:s', 'srt',         // subtitle codec
      '-metadata:s:s:0', 'language=spa',
      '-y',
      outPath
    ];

    console.log(`    [render] Softsub → ${path.basename(outPath)}`);
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      // Muxing copy is extremely fast, but we parse time updates for consistency
      const match = d.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (match && onProgress) {
        const secs = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
        const pct = Math.min(100, Math.round((secs / duration) * 100));
        onProgress(pct);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const size = fs.statSync(outPath).size;
        console.log(`    [render] Softsub ✓ ${(size / 1024 / 1024).toFixed(1)} MB`);
        if (onProgress) onProgress(100);
        resolve(outPath);
      } else {
        reject(new Error(`Softsub render failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
  });
}

/**
 * Render hardsub version — subtitles burned into the video.
 * Uses ASS subtitles for styled text. Video re-encoded with libx264 CRF 17.
 * Audio stream is copied without re-encoding.
 *
 * @param {string} videoPath  - Path to original video
 * @param {string} assPath    - Path to .ass subtitle file
 * @param {string} outputBase - Base path for output (without extension)
 * @param {object} opts       - { duration, onProgress }
 * @returns {Promise<string>} path to the generated hardsub file
 */
function renderHardsub(videoPath, assPath, outputBase, { duration = 1.0, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const outPath = `${outputBase}_hardsub.mp4`;

    // Escape path for FFmpeg filter: backslashes → forward slashes, colons escaped
    const escapedAss = assPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:');

    const args = [
      '-i', videoPath,
      '-vf', `ass='${escapedAss}'`,
      '-c:v', 'libx264',
      '-crf', '17',
      '-preset', 'medium',
      '-c:a', 'copy',        // audio untouched
      '-y',
      outPath
    ];

    console.log(`    [render] Hardsub → ${path.basename(outPath)} (CRF 17, preset medium)`);
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    let lastLog = 0;

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const match = d.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const secs = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
        if (secs - lastLog >= 5) {
          console.log(`    [render] Hardsub encoding: ${match[0]}`);
          lastLog = secs;
        }
        if (onProgress) {
          const pct = Math.min(100, Math.round((secs / duration) * 100));
          onProgress(pct);
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const size = fs.statSync(outPath).size;
        console.log(`    [render] Hardsub ✓ ${(size / 1024 / 1024).toFixed(1)} MB`);
        if (onProgress) onProgress(100);
        resolve(outPath);
      } else {
        reject(new Error(`Hardsub render failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
  });
}

module.exports = { renderSoftsub, renderHardsub, getVideoDuration };
