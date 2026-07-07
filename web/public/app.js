/**
 * SubsPipeline — Frontend Application (Fase 3)
 * Handles style editor, synchronized preview player, social media effects, and queue list selection.
 */

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────
  const API_BASE = window.location.origin;
  const QUEUE_POLL_MS = 3000;

  // ─── DOM Elements ──────────────────────────────────
  const $id = (id) => document.getElementById(id);

  const dom = {
    // Connection
    connectionStatus: $id('connectionStatus'),
    statusDot: null,
    statusText: null,

    // Auto mode
    autoModeToggle: $id('autoModeToggle'),
    autoModeDesc: $id('autoModeDesc'),

    // Editor fields
    fontFamily:      $id('fontFamily'),
    fontSize:        $id('fontSize'),
    fontSizeNum:     $id('fontSizeNum'),
    fontSizeValue:   $id('fontSizeValue'),
    fontColor:       $id('fontColor'),
    fontColorHex:    $id('fontColorHex'),
    outlineColor:    $id('outlineColor'),
    outlineColorHex: $id('outlineColorHex'),
    outlineWidth:    $id('outlineWidth'),
    outlineWidthNum: $id('outlineWidthNum'),
    outlineWidthValue: $id('outlineWidthValue'),
    subtitleEffect:  $id('subtitleEffect'),
    verticalPosition: $id('verticalPosition'),
    verticalPositionNum: $id('verticalPositionNum'),
    verticalPositionValue: $id('verticalPositionValue'),
    maxLines:        $id('maxLines'),
    maxLinesField:   $id('maxLinesField'),
    saveBtn:         $id('saveTemplateBtn'),

    // Preview Elements
    previewTitle:    $id('previewTitle'),
    previewPlayer:   $id('previewPlayer'),
    videoWrapper:    $id('videoWrapper'),
    subtitleOverlay: $id('subtitleOverlay'),
    subtitleOverlayText: $id('subtitleOverlayText'),
    testVideoFile:   $id('testVideoFile'),
    videoStatusOverlay: $id('videoStatusOverlay'),

    // Queue
    queueContainer:  $id('queueContainer'),
    refreshBtn:      $id('refreshQueueBtn'),

    // Toast
    toastContainer:  $id('toastContainer'),
  };

  dom.statusDot = dom.connectionStatus.querySelector('.status-dot');
  dom.statusText = dom.connectionStatus.querySelector('.status-text');

  const modeRadios = document.getElementsByName('subtitleMode');
  const posButtons = document.querySelectorAll('.editor__pos-btn');

  // ─── State ─────────────────────────────────────────
  let currentTemplate = {
    fontFamily: 'Arial',
    fontSize: 24,
    fontColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    effect: 'none', // none | pop | fade | slide | glow | typewriter | shake
    verticalPosition: 10,
    maxLines: 1,
    mode: 'lipsync',
  };

  let savedTemplate = { ...currentTemplate };
  let isConnected = false;
  
  // Preview State
  let activeSubtitles = []; 
  let lastSubText = '';
  let selectedQueueItem = null;

  // ─── API Helpers ───────────────────────────────────
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ─── Connection Status ─────────────────────────────
  function setConnected(connected, text) {
    isConnected = connected;
    dom.statusDot.className = 'status-dot' + (connected ? ' connected' : '');
    dom.statusText.textContent = text || (connected ? 'Conectado' : 'Desconectado');
  }

  function setError(text) {
    dom.statusDot.className = 'status-dot error';
    dom.statusText.textContent = text || 'Error';
  }

  // ─── Toast Notifications ───────────────────────────
  function showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove());
    }, duration);
  }

  // ─── Load Settings ─────────────────────────────────
  async function loadSettings() {
    try {
      const settings = await api('GET', '/api/settings');
      setConnected(true);

      dom.autoModeToggle.checked = settings.auto_mode;
      updateAutoModeDesc(settings.auto_mode);

      if (settings.template) {
        currentTemplate = { ...currentTemplate, ...settings.template };
        savedTemplate = { ...currentTemplate };
      }

      applyTemplate();
      updatePreviewStyles();
      checkDirty();

    } catch (err) {
      setError('Sin conexión');
      showToast(`Error al cargar configuración: ${err.message}`, 'error');
    }
  }

  // ─── Auto Mode ─────────────────────────────────────
  function updateAutoModeDesc(on) {
    dom.autoModeDesc.textContent = on
      ? 'Los videos se procesarán automáticamente'
      : 'Procesamiento pausado — los videos quedan en cola';
  }

  async function toggleAutoMode() {
    const newValue = dom.autoModeToggle.checked;
    try {
      await api('PUT', '/api/settings/auto-mode', { auto_mode: newValue });
      updateAutoModeDesc(newValue);
      showToast(
        newValue ? 'Modo automático activado' : 'Modo automático desactivado',
        'success'
      );
    } catch (err) {
      dom.autoModeToggle.checked = !newValue;
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ─── Template Editor ───────────────────────────────
  function applyTemplate() {
    dom.fontFamily.value = currentTemplate.fontFamily;
    dom.fontSize.value = currentTemplate.fontSize;
    dom.fontSizeNum.value = currentTemplate.fontSize;
    dom.fontSizeValue.textContent = currentTemplate.fontSize;
    dom.fontColor.value = currentTemplate.fontColor;
    dom.fontColorHex.textContent = currentTemplate.fontColor.toUpperCase();
    dom.outlineColor.value = currentTemplate.outlineColor;
    dom.outlineColorHex.textContent = currentTemplate.outlineColor.toUpperCase();
    
    dom.outlineWidth.value = currentTemplate.outlineWidth;
    dom.outlineWidthNum.value = currentTemplate.outlineWidth;
    dom.outlineWidthValue.textContent = currentTemplate.outlineWidth;

    dom.subtitleEffect.value = currentTemplate.effect || 'none';

    dom.verticalPosition.value = currentTemplate.verticalPosition;
    dom.verticalPositionNum.value = currentTemplate.verticalPosition;
    dom.verticalPositionValue.textContent = `${currentTemplate.verticalPosition}%`;

    dom.maxLines.value = currentTemplate.maxLines;

    const mode = currentTemplate.mode || 'lipsync';
    modeRadios.forEach((r) => {
      r.checked = r.value === mode;
    });

    dom.maxLinesField.style.display = mode === 'lipsync' ? 'none' : 'flex';

    posButtons.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.posVal) === currentTemplate.verticalPosition);
    });
  }

  const loadedFonts = new Set([
    'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'
  ]);

  function loadGoogleFont(fontName) {
    if (!fontName || loadedFonts.has(fontName)) return;
    loadedFonts.add(fontName);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
    console.log(`[loadGoogleFont] Loaded font from Google Fonts: ${fontName}`);
  }

  function updatePreviewStyles() {
    const t = currentTemplate;
    const el = dom.subtitleOverlayText;

    if (t.fontFamily && !loadedFonts.has(t.fontFamily)) {
      loadGoogleFont(t.fontFamily);
    }

    el.style.fontFamily = t.fontFamily;
    el.style.fontSize = `${t.fontSize}px`;
    el.style.color = t.fontColor;
    
    el.style.textShadow = `
      -${t.outlineWidth}px -${t.outlineWidth}px 0 ${t.outlineColor},
       ${t.outlineWidth}px -${t.outlineWidth}px 0 ${t.outlineColor},
      -${t.outlineWidth}px  ${t.outlineWidth}px 0 ${t.outlineColor},
       ${t.outlineWidth}px  ${t.outlineWidth}px 0 ${t.outlineColor}
    `;

    dom.subtitleOverlay.style.setProperty('--sub-margin-v', `${t.verticalPosition}%`);
  }

  function checkDirty() {
    const dirty = JSON.stringify(currentTemplate) !== JSON.stringify(savedTemplate);
    dom.saveBtn.disabled = !dirty;
  }

  function onFieldChange(field, value) {
    currentTemplate[field] = value;
    updatePreviewStyles();
    checkDirty();
  }

  async function saveTemplate() {
    dom.saveBtn.classList.add('saving');
    dom.saveBtn.disabled = true;

    try {
      await api('PUT', '/api/settings/template', { template: currentTemplate });
      savedTemplate = { ...currentTemplate };
      checkDirty();
      showToast('Plantilla guardada correctamente', 'success');
    } catch (err) {
      showToast(`Error al guardar: ${err.message}`, 'error');
      checkDirty();
    } finally {
      dom.saveBtn.classList.remove('saving');
    }
  }

  // ─── Subtitle Sync & Effects Logic ────────────────
  
  function parseSRT(data) {
    const subs = [];
    const blocks = data.replace(/\r/g, '').split('\n\n');
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length >= 3) {
        const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3}) --> (\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
        if (timeMatch) {
          const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
          const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
          const text = lines.slice(2).join('\n');
          subs.push({ start, end, text });
        }
      }
    }
    return subs;
  }

  function wrapPreviewText(text) {
    if (currentTemplate.mode === 'lipsync') {
      return text.split('\n')[0] || '';
    }

    const maxLines = parseInt(currentTemplate.maxLines) || 1;
    const words = text.replace(/\n/g, ' ').split(' ');
    if (words.length <= 1 || maxLines <= 1) {
      return text;
    }

    const chunkSize = Math.ceil(words.length / maxLines);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    return chunks.join('\n');
  }

  /**
   * Apply dynamic CSS animation classes to the subtitle overlay element
   */
  function applyActiveSubtitleEffect(element, text) {
    const effect = currentTemplate.effect || 'none';
    
    // Clear previous effect classes
    element.className = 'preview__overlay-text';
    
    if (!text) {
      element.innerText = '';
      return;
    }

    element.innerText = wrapPreviewText(text);

    // Apply animation effect
    if (effect !== 'none') {
      if (effect === 'typewriter') {
        // Simple HTML5 Typewriter emulation: step reveals characters
        element.style.animation = 'none';
        element.offsetHeight; // trigger reflow
        element.style.animation = `effectFade 0.2s steps(${text.length}, end) forwards`;
      } else {
        // Normal CSS transitions class toggling
        element.classList.add(`effect-${effect}`);
      }
    }
  }

  function syncSubtitle(currentTime) {
    if (!activeSubtitles || activeSubtitles.length === 0) {
      if (dom.previewPlayer.paused) {
        applyActiveSubtitleEffect(dom.subtitleOverlayText, "Carga un video para sincronizar");
      } else {
        applyActiveSubtitleEffect(dom.subtitleOverlayText, "");
      }
      return;
    }

    const currentSub = activeSubtitles.find(sub => currentTime >= sub.start && currentTime <= sub.end);
    const subText = currentSub ? currentSub.text : '';

    // Only apply animation when the subtitle text actually changes
    if (subText !== lastSubText) {
      lastSubText = subText;
      applyActiveSubtitleEffect(dom.subtitleOverlayText, subText);
    }
  }

  dom.previewPlayer.addEventListener('loadedmetadata', () => {
    const w = dom.previewPlayer.videoWidth;
    const h = dom.previewPlayer.videoHeight;
    if (w && h) {
      dom.videoWrapper.style.aspectRatio = `${w}/${h}`;
    }
  });

  dom.previewPlayer.addEventListener('timeupdate', () => {
    syncSubtitle(dom.previewPlayer.currentTime);
  });

  // ─── Queue Video Selection Handler ───────────────────
  
  /**
   * Loads a video item from queue into previewer
   * @param {object} item - queue item properties
   */
  async function selectQueueVideo(item) {
    selectedQueueItem = item;
    const overlay = dom.videoStatusOverlay;
    
    overlay.style.display = 'flex';
    dom.previewPlayer.style.display = 'none';
    dom.subtitleOverlay.style.display = 'none';
    
    dom.previewTitle.innerText = `Vista Previa: ${item.filename}`;
    activeSubtitles = [];
    lastSubText = '';

    console.log('[selectQueueVideo] Selected item:', item);

    // Status: Pending (No subtitles yet)
    if (item.status === 'pendiente') {
      overlay.querySelector('.preview__status-icon').innerText = '⏳';
      overlay.querySelector('.preview__status-text').innerHTML = `
        <span class="waiting">Esperando transcripción...</span><br>
        <span style="font-size: 0.75rem; color: var(--text-muted)">El video se está preparando para procesarse</span>
      `;
      return;
    }

    // Status: Processing or Completed (Load video streaming + fetch subtitles)
    overlay.querySelector('.preview__status-icon').innerText = '🔄';
    overlay.querySelector('.preview__status-text').innerText = 'Cargando subtítulos y video...';

    // Set video source path
    let streamUrl;
    const isCompleted = item.status === 'completado' || item.status === 'completed' || item.status === 'ready' || item.status === 'listo';
    if (isCompleted && item.output_path) {
      try {
        const out = JSON.parse(item.output_path);
        // Prefer loading softsub MKV or hardsub MP4 if available
        streamUrl = `${API_BASE}/api/video/output/${out.hardsub}`;
      } catch {
        streamUrl = `${API_BASE}/api/video/input/${item.filename}`;
      }
    } else {
      streamUrl = `${API_BASE}/api/video/input/${item.filename}`;
    }

    console.log('[selectQueueVideo] Stream URL:', streamUrl);

    try {
      // 1. Fetch generated SRT subtitles crudo
      const srtResponse = await fetch(`${API_BASE}/api/subtitles/${item.id}`);
      if (!srtResponse.ok) throw new Error('Subtítulos en preparación');
      
      const srtText = await srtResponse.text();
      activeSubtitles = parseSRT(srtText);

      // 2. Load video source stream directly on the video element
      dom.previewPlayer.src = streamUrl;
      dom.previewPlayer.load();

      // Show player and hide status overlay
      overlay.style.display = 'none';
      dom.previewPlayer.style.display = 'block';
      dom.subtitleOverlay.style.display = 'flex';
      
      dom.previewPlayer.play().catch(() => {
        // Handle autoplay block browser restrictions
      });
      showToast(`Video cargado: ${item.filename}`, 'success');

    } catch (err) {
      // Subtitle isn't ready yet (Whisper is still transcribing)
      overlay.querySelector('.preview__status-icon').innerText = '🎙️';
      overlay.querySelector('.preview__status-text').innerHTML = `
        <span class="waiting">Transcribiendo audio (Paso 1)...</span><br>
        <span style="font-size: 0.75rem; color: var(--text-muted)">Progreso de transcripción: ${item.progress || 0}%</span>
      `;
      
      // Load video on backend fallback, but KEEP the overlay visible showing the progress
      dom.previewPlayer.src = streamUrl;
      dom.previewPlayer.load();
      
      // We don't hide the overlay here because we are still waiting for subtitles
      dom.previewPlayer.style.display = 'none';
      dom.subtitleOverlay.style.display = 'none';
    }
  }

  // ─── Test Local File Loader ──────────────────────
  dom.testVideoFile.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const fileURL = URL.createObjectURL(file);
      dom.previewPlayer.src = fileURL;
      
      dom.videoStatusOverlay.style.display = 'none';
      dom.previewPlayer.style.display = 'block';
      dom.subtitleOverlay.style.display = 'flex';
      
      dom.previewPlayer.load();
      dom.previewPlayer.play();
      dom.previewTitle.innerText = `Vista Previa: ${file.name} (Local)`;
      showToast(`Cargado local: ${file.name}`, 'info');

      // Default preview test tracks
      const mockSrt = `
1
00:00:01,000 --> 00:00:04,500
Bienvenidos a SubsPipeline

2
00:00:05,000 --> 00:00:08,200
Este es un subtítulo de prueba sincronizado

3
00:00:08,800 --> 00:00:12,000
Prueba de posicionamiento, color y grosor de outline
      `;
      activeSubtitles = parseSRT(mockSrt);
      lastSubText = '';
    }
  });

  // ─── Queue rendering ────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function statusBadge(status) {
    const labels = {
      pendiente: 'Pendiente',
      procesando: 'Procesando',
      completado: 'Completado',
      completed: 'Completado',
      ready: 'Listo',
      listo: 'Listo',
      error: 'Error',
    };
    const s = (status || 'pendiente').toLowerCase();
    return `<span class="badge badge--${s === 'completed' || s === 'ready' || s === 'listo' ? 'completado' : s}">${labels[s] || s}</span>`;
  }

  function statusIcon(status) {
    let s = (status || 'pendiente').toLowerCase();
    if (s === 'completed' || s === 'ready' || s === 'listo') s = 'completado';
    const colors = {
      pendiente: 'rgba(251,191,36,0.12)',
      procesando: 'rgba(96,165,250,0.12)',
      completado: 'rgba(52,211,153,0.12)',
      error: 'rgba(248,113,113,0.12)',
    };
    const strokes = {
      pendiente: '#fbbf24',
      procesando: '#60a5fa',
      completado: '#34d399',
      error: '#f87171',
    };
    return `
      <div class="queue__item-icon" style="background:${colors[s] || colors.pendiente}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${strokes[s] || strokes.pendiente}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      </div>
    `;
  }

  function progressBlock(status, progress) {
    const s = (status || 'pendiente').toLowerCase();
    const isCompletedOrProc = s === 'procesando' || s === 'completado' || s === 'completed' || s === 'ready' || s === 'listo';
    if (!isCompletedOrProc) return '';

    const p = Math.min(100, Math.max(0, parseInt(progress) || 0));
    return `
      <div class="queue__progress-container">
        <div class="queue__progress-bar-bg">
          <div class="queue__progress-bar" style="width: ${p}%"></div>
        </div>
        <div class="queue__progress-pct">${p}%</div>
      </div>
    `;
  }

  async function loadQueue() {
    try {
      const entries = await api('GET', '/api/queue');

      if (!entries || entries.length === 0) {
        dom.queueContainer.innerHTML = `
          <div class="queue__empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <rect x="2" y="2" width="20" height="20" rx="2"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="12" y1="2" x2="12" y2="22"/>
            </svg>
            <p>No hay videos en cola</p>
          </div>
        `;
        return;
      }

      dom.queueContainer.innerHTML = '';
      
      entries.forEach((entry) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'queue__item';
        
        // Highlight active selection
        if (selectedQueueItem && selectedQueueItem.id === entry.id) {
          itemEl.style.borderColor = 'var(--accent-cyan)';
          itemEl.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.15)';
        }

        itemEl.innerHTML = `
          <div class="queue__item-row">
            ${statusIcon(entry.status)}
            <div class="queue__item-info">
              <div class="queue__item-name" title="${entry.filename}">${entry.filename}</div>
              <div class="queue__item-meta">${formatDate(entry.created_at)}</div>
            </div>
            <div class="queue__item-status">
              ${statusBadge(entry.status)}
            </div>
          </div>
          ${progressBlock(entry.status, entry.progress)}
        `;

        // Click row to select video
        itemEl.addEventListener('click', () => {
          selectQueueVideo(entry);
          // Quick redraw queue style borders immediately
          loadQueue();
        });

        dom.queueContainer.appendChild(itemEl);
      });

      // Keep polling updating preview if actively transcribing selected item
      if (selectedQueueItem) {
        const activeItem = entries.find(x => x.id === selectedQueueItem.id);
        if (activeItem && activeItem.status !== selectedQueueItem.status || (activeItem && activeItem.progress !== selectedQueueItem.progress)) {
          // Update status overlay if state changes
          selectQueueVideo(activeItem);
        }
      }

    } catch (err) {
      console.error('Failed to load queue:', err);
    }
  }

  // ─── Event Listeners ───────────────────────────────

  dom.autoModeToggle.addEventListener('change', toggleAutoMode);

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      dom.maxLinesField.style.display = mode === 'lipsync' ? 'none' : 'flex';
      onFieldChange('mode', mode);
    });
  });

  dom.fontFamily.addEventListener('change', (e) => {
    onFieldChange('fontFamily', e.target.value);
  });

  dom.fontSize.addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    dom.fontSizeNum.value = v;
    dom.fontSizeValue.textContent = v;
    onFieldChange('fontSize', v);
  });
  dom.fontSizeNum.addEventListener('input', (e) => {
    const v = Math.max(12, Math.min(72, parseInt(e.target.value) || 12));
    dom.fontSize.value = v;
    dom.fontSizeValue.textContent = v;
    onFieldChange('fontSize', v);
  });

  dom.fontColor.addEventListener('input', (e) => {
    dom.fontColorHex.textContent = e.target.value.toUpperCase();
    onFieldChange('fontColor', e.target.value);
  });

  dom.outlineColor.addEventListener('input', (e) => {
    dom.outlineColorHex.textContent = e.target.value.toUpperCase();
    onFieldChange('outlineColor', e.target.value);
  });

  dom.outlineWidth.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    dom.outlineWidthNum.value = v;
    dom.outlineWidthValue.textContent = v;
    onFieldChange('outlineWidth', v);
  });
  dom.outlineWidthNum.addEventListener('input', (e) => {
    const v = Math.max(0, Math.min(8, parseFloat(e.target.value) || 0));
    dom.outlineWidth.value = v;
    dom.outlineWidthValue.textContent = v;
    onFieldChange('outlineWidth', v);
  });

  // Subtitle Effect changes listener
  dom.subtitleEffect.addEventListener('change', (e) => {
    onFieldChange('effect', e.target.value);
    // force preview redraw to check animation instantly
    lastSubText = '';
    syncSubtitle(dom.previewPlayer.currentTime);
  });

  dom.verticalPosition.addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    dom.verticalPositionNum.value = v;
    dom.verticalPositionValue.textContent = `${v}%`;
    onFieldChange('verticalPosition', v);
  });
  dom.verticalPositionNum.addEventListener('input', (e) => {
    const v = Math.max(5, Math.min(95, parseInt(e.target.value) || 5));
    dom.verticalPosition.value = v;
    dom.verticalPositionValue.textContent = `${v}%`;
    onFieldChange('verticalPosition', v);
  });

  posButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      posButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const v = parseInt(btn.dataset.posVal);
      dom.verticalPosition.value = v;
      dom.verticalPositionNum.value = v;
      dom.verticalPositionValue.textContent = `${v}%`;
      onFieldChange('verticalPosition', v);
    });
  });

  dom.maxLines.addEventListener('change', (e) => {
    onFieldChange('maxLines', parseInt(e.target.value));
  });

  dom.saveBtn.addEventListener('click', saveTemplate);

  dom.refreshBtn.addEventListener('click', () => {
    dom.refreshBtn.querySelector('svg').style.transform = 'rotate(360deg)';
    setTimeout(() => {
      dom.refreshBtn.querySelector('svg').style.transform = '';
    }, 400);
    loadQueue();
  });

  // ─── Init ──────────────────────────────────────────
  async function init() {
    await loadSettings();
    await loadQueue();

    setInterval(loadQueue, QUEUE_POLL_MS);
  }

  init();
})();
