require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  getSettings,
  updateAutoMode,
  updateTemplate,
  getQueueEntries,
  supabase
} = require('../supabase');

const app = express();
const PORT = parseInt(process.env.WEB_PORT) || 3800;

const INPUT_DIR = path.resolve(process.env.INPUT_DIR || './input');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './temp');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Video Streaming Endpoints ────────────────────────────────

/**
 * Helper to stream video file using HTTP range requests
 */
function streamVideoFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * GET /api/video/input/:filename — Stream an input video for HTML5 preview
 */
app.get('/api/video/input/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const targetPath = path.join(INPUT_DIR, safeFilename);
  streamVideoFile(req, res, targetPath);
});

/**
 * GET /api/video/output/:filename — Stream an output video
 */
app.get('/api/video/output/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const targetPath = path.join(OUTPUT_DIR, safeFilename);
  streamVideoFile(req, res, targetPath);
});

// ─── Subtitle Retrieval Endpoint ──────────────────────────────

/**
 * GET /api/subtitles/:queueId — Retrieve the SRT subtitle file
 */
app.get('/api/subtitles/:queueId', async (req, res) => {
  try {
    const queueId = req.params.queueId;
    
    // Fetch queue entry details
    const { data: entry, error } = await supabase
      .from('subs_pipeline_queue')
      .select('*')
      .eq('id', queueId)
      .single();
      
    if (error || !entry) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    const basename = path.basename(entry.filename, path.extname(entry.filename));
    const tempSrtPath = path.join(TEMP_DIR, `${basename}.srt`);

    // Case 1: Subtitle still exists in TEMP folder (currently processing or just finished)
    if (fs.existsSync(tempSrtPath)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return fs.createReadStream(tempSrtPath).pipe(res);
    }

    // Case 2: Process completed. Subtitles are muxed inside the output MKV file.
    // We dynamically extract the SRT stream using ffmpeg and pipe it directly to the response.
    const isCompleted = entry.status === 'completado' || entry.status === 'completed' || entry.status === 'ready' || entry.status === 'listo';
    if (isCompleted && entry.output_path) {
      let outputFilenames;
      try {
        outputFilenames = JSON.parse(entry.output_path);
      } catch {
        outputFilenames = { softsub: `${basename}_softsub.mkv` };
      }
      
      const softsubPath = path.join(OUTPUT_DIR, outputFilenames.softsub);
      if (fs.existsSync(softsubPath)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        
        // spawn FFmpeg to dump subtitle stream to stdout
        const ffmpeg = spawn('ffmpeg', [
          '-i', softsubPath,
          '-map', '0:s:0',     // Map first subtitle track
          '-f', 'srt',         // SRT format stdout
          '-'
        ]);

        ffmpeg.stdout.pipe(res);
        
        ffmpeg.stderr.on('data', () => { /* quiet down stderr */ });
        return;
      }
    }

    // Case 3: Subtitles not generated yet
    return res.status(400).json({ error: 'Subtitles not generated yet for this entry' });

  } catch (err) {
    console.error('[api] Subtitles retrieval failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API Routes ──────────────────────────────────────────────

/**
 * GET /api/settings — Retrieve current settings (auto_mode + template)
 */
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error('[api] GET /api/settings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/settings/auto-mode — Toggle auto_mode on/off
 */
app.put('/api/settings/auto-mode', async (req, res) => {
  try {
    const { auto_mode } = req.body;
    if (typeof auto_mode !== 'boolean') {
      return res.status(400).json({ error: 'auto_mode must be a boolean' });
    }
    const updated = await updateAutoMode(auto_mode);
    console.log(`[api] auto_mode → ${auto_mode ? 'ON' : 'OFF'}`);
    res.json(updated);
  } catch (err) {
    console.error('[api] PUT /api/settings/auto-mode error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/settings/template — Update subtitle style template
 */
app.put('/api/settings/template', async (req, res) => {
  try {
    const { template } = req.body;
    if (!template || typeof template !== 'object') {
      return res.status(400).json({ error: 'template must be an object' });
    }
    const updated = await updateTemplate(template);
    console.log(`[api] Template updated:`, JSON.stringify(template));
    res.json(updated);
  } catch (err) {
    console.error('[api] PUT /api/settings/template error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/queue — List queue entries (newest first)
 */
app.get('/api/queue', async (req, res) => {
  try {
    const entries = await getQueueEntries();
    res.json(entries);
  } catch (err) {
    console.error('[api] GET /api/queue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve SPA fallback ──────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         SubsPipeline — Web Interface             ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  URL: http://0.0.0.0:${PORT}`);
  console.log('');
});
