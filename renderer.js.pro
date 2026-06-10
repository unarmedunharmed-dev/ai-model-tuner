const sysInfoDiv = document.getElementById('sysDetails');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const ollamaBtn = document.getElementById('ollamaBtn');
const modelListDiv = document.getElementById('modelList');
const modelInfoDiv = document.getElementById('modelInfo');
const settingsDiv = document.getElementById('settings');
const scanStatus = document.getElementById('scanStatus');
const tuningControls = document.getElementById('tuningControls');
const tweaksSection = document.getElementById('tweaksSection');
const themeToggle = document.getElementById('themeToggle');
const resourceCard = document.getElementById('resourceCard');
const resKvCache = document.getElementById('resKvCache');
const resWeights = document.getElementById('resWeights');
const resTotalVram = document.getElementById('resTotalVram');
const resUtilFill = document.getElementById('resUtilFill');
const resAvailableVram = document.getElementById('resAvailableVram');
const resCpuRam = document.getElementById('resCpuRam');
const resNote = document.getElementById('resNote');
const allocBody = document.getElementById('allocBody');
const poolGrid = document.getElementById('poolGrid');
const poolBadge = document.getElementById('poolBadge');

const ctxSlider = document.getElementById('ctxSlider');
const ctxValue = document.getElementById('ctxValue');
const ctxVramEst = document.getElementById('ctxVramEst');
const vramWarning = document.getElementById('vramWarning');

let sysInfo = null;
let scannedModels = [];
let currentModelType = null;
let currentModelPath = null;
let currentModelMeta = null;
let currentFileSize = 0;

const tweaksState = { gpuLayers: 'auto', batch: 'auto', kvCache: 'q4_0', flashAttn: 'on' };

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function getBadgeClass(type) {
  if (!type || type === 'unknown' || type === 'error') return 'badge-unknown';
  if (type === 'llama.cpp') return 'badge-gguf';
  if (type === 'onnx') return 'badge-onnx';
  if (type === 'pytorch') return 'badge-pytorch';
  if (['hf', 'safetensors'].includes(type)) return 'badge-hf';
  return 'badge-unknown';
}

function formatTypeLabel(type, format) {
  return `${type === 'llama.cpp' ? 'GGUF' : type} (${format})`;
}

// ---- Dark mode ----
function getPreferredTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('theme', theme); } catch {}
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

const savedTheme = (() => { try { return localStorage.getItem('theme'); } catch { return null; }})();
setTheme(savedTheme || getPreferredTheme());
themeToggle.addEventListener('click', toggleTheme);

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('theme')) setTheme(e.matches ? 'dark' : 'light');
});

// ---- Load system specs ----
(async function loadSysInfo() {
  try {
    sysInfo = await window.api.getSystemInfo();
    if (!sysInfo || !sysInfo.cpu) throw new Error('Empty sysInfo');
    const cpuBrand = escapeHtml(sysInfo.cpu.brand || 'Unknown CPU');
    const cpuDetail = `${sysInfo.cpu.cores}C / ${sysInfo.cpu.threads}T`;
    const ramGB = sysInfo.memory.totalGB || '?';
    let gpuItems = '<div class="empty-state" style="padding:8px 0;">None detected</div>';
    let sharedPool = 0;
    if (sysInfo.gpu && sysInfo.gpu.length) {
      gpuItems = '';
      sysInfo.gpu.forEach((g, i) => {
        const model = escapeHtml(g.model || 'Unknown GPU');
        const ded = parseFloat(g.vramGB) || 0;
        const shared = parseFloat(g.vramSharedGB) || 0;
        if (shared > sharedPool) sharedPool = shared;
        let memLine;
        if (ded > 0 && shared > 0) {
          memLine = `${ded.toFixed(2)} GB dedicated + shared system memory`;
        } else if (ded > 0) {
          memLine = `${ded.toFixed(2)} GB dedicated`;
        } else if (shared > 0) {
          memLine = 'Shared system memory';
        } else if (sharedPool > 0) {
          memLine = 'Shared system memory';
        } else {
          memLine = 'No VRAM detected';
        }
        gpuItems += `<div class="sys-item"><span class="icon">🎮</span><div class="info"><div class="label">GPU ${i + 1}</div><div class="value" title="${model}">${model}</div><div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${memLine}</div></div></div>`;
      });
    }

    sysInfoDiv.innerHTML = `
      <div class="sys-item"><span class="icon">🖥</span><div class="info"><div class="label">CPU</div><div class="value" title="${cpuBrand}">${cpuBrand}</div><div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${cpuDetail}</div></div></div>
      <div class="sys-item"><span class="icon">💾</span><div class="info"><div class="label">RAM</div><div class="value">${ramGB} GB</div></div></div>
      ${gpuItems}${sharedPool > 0 ? `
      <div class="sys-item"><span class="icon">🔗</span><div class="info"><div class="label">Shared GPU Memory Pool</div><div class="value">${sharedPool.toFixed(2)} GB</div><div style="font-size:11px;color:var(--text-muted);margin-top:1px;">System RAM shared across all GPUs</div></div></div>` : ''}
      <div class="sys-item"><span class="icon">🪟</span><div class="info"><div class="label">OS</div><div class="value">${escapeHtml(String(sysInfo.os || 'Unknown'))}</div></div></div>
    `;

    ctxSlider.value = 8192;
    ctxValue.textContent = '8,192';
    loadCompatibilityMatrix();
  } catch (e) {
    console.error('sysinfo failed:', e);
    sysInfoDiv.innerHTML = '<div class="empty-state">Error loading system specs. See console for details.</div>';
  }
})();

// ---- Scan folder ----
async function scanFolder(folderPath) {
  modelListDiv.innerHTML = '<div class="loading-text"><span class="spinner"></span> Scanning\u2026</div>';
  scanStatus.textContent = '';
  try {
    scannedModels = await window.api.scanFolderForModels(folderPath);
  } catch (e) {
    console.error('scan error:', e);
    modelListDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">Error scanning folder.</div>';
    return;
  }
  renderModelList();
}

function renderModelList() {
  modelListDiv.innerHTML = '';
  if (scannedModels.length === 0) {
    modelListDiv.innerHTML = '<div class="empty-state">No model files found in this directory.</div>';
    scanStatus.textContent = '0 files found';
    return;
  }
  scanStatus.textContent = `${scannedModels.length} file(s) found`;
  scannedModels.forEach(model => {
    const div = document.createElement('div');
    div.className = 'model-item';
    const badge = document.createElement('span');
    badge.className = 'badge badge-unknown';
    badge.textContent = '?';
    div.appendChild(badge);
    div.appendChild(document.createTextNode(' ' + model.relativePath));
    div.onclick = async () => {
      document.querySelectorAll('.model-item.selected').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      badge.className = 'badge badge-unknown';
      badge.textContent = '\u22EF';
      modelInfoDiv.innerHTML = '';
      currentModelPath = model.fullPath;
      await detectAndShowSettings(model.fullPath);
    };
    modelListDiv.appendChild(div);
  });
}

// ---- Detect model type and show settings ----
async function detectAndShowSettings(filePath) {
  settingsDiv.innerHTML = '<div class="loading-text"><span class="spinner"></span> Analysing model\u2026</div>';
  try {
    currentModelType = await window.api.detectModelType(filePath);
    const typeLabel = formatTypeLabel(currentModelType.type, currentModelType.format);
    const badgeClass = getBadgeClass(currentModelType.type);

    const selectedItem = document.querySelector('.model-item.selected');
    if (selectedItem) {
      const badge = selectedItem.querySelector('.badge');
      if (badge) { badge.className = `badge ${badgeClass}`; badge.textContent = currentModelType.type === 'llama.cpp' ? 'GGUF' : currentModelType.type.toUpperCase(); }
    }

    let fileInfoHtml = `<div class="model-info-grid">`;
    fileInfoHtml += `<div class="model-info-item"><div class="label">File</div><div class="value">${escapeHtml(filePath.split('\\').pop().split('/').pop())}</div></div>`;
    fileInfoHtml += `<div class="model-info-item"><div class="label">Type</div><div class="value"><span class="badge ${badgeClass}">${typeLabel}</span></div></div>`;

    currentFileSize = 0;
    try {
      const fi = await window.api.getFileInfo(filePath);
      if (fi) {
        currentFileSize = fi.sizeBytes;
        const sizeLabel = currentFileSize > 1024 * 1024 * 1024
          ? `${(currentFileSize / 1024 / 1024 / 1024).toFixed(2)} GB`
          : `${(currentFileSize / 1024 / 1024).toFixed(1)} MB`;
        fileInfoHtml += `<div class="model-info-item"><div class="label">Size</div><div class="value">${sizeLabel}</div></div>`;
      }
    } catch {}

    currentModelMeta = null;
    if (currentModelType.type === 'llama.cpp') {
      try {
        currentModelMeta = await window.api.getModelMeta(filePath);
        const meta = currentModelMeta;
        if (meta.name && meta.name !== '?') fileInfoHtml += `<div class="model-info-item"><div class="label">Model</div><div class="value">${escapeHtml(meta.name)}</div></div>`;
        if (meta.architecture && meta.architecture !== '?') fileInfoHtml += `<div class="model-info-item"><div class="label">Architecture</div><div class="value">${escapeHtml(meta.architecture)}</div></div>`;
        if (meta.parameters && meta.parameters !== '?') fileInfoHtml += `<div class="model-info-item"><div class="label">Parameters</div><div class="value">${escapeHtml(meta.parameters)}</div></div>`;
        if (meta.blockCount) fileInfoHtml += `<div class="model-info-item"><div class="label">Layers</div><div class="value">${meta.blockCount}</div></div>`;
        if (meta.expertCount) fileInfoHtml += `<div class="model-info-item"><div class="label">Experts</div><div class="value">${meta.expertCount}</div></div>`;
        if (meta.contextLength) fileInfoHtml += `<div class="model-info-item"><div class="label">Max Context</div><div class="value">${Number(meta.contextLength).toLocaleString()}</div></div>`;
        if (meta.contextLength && Number(meta.contextLength) > 0) {
          ctxSlider.max = Math.max(Number(meta.contextLength), 1024);
        }
      } catch {}
    }

    fileInfoHtml += `</div>`;
    modelInfoDiv.innerHTML = fileInfoHtml;

    if (currentModelType.type === 'llama.cpp') {
      tuningControls.classList.remove('hidden');
      tweaksSection.classList.remove('hidden');
      resourceCard.classList.remove('hidden');
    } else {
      tuningControls.classList.add('hidden');
      tweaksSection.classList.add('hidden');
      resourceCard.classList.add('hidden');
    }

    computeAndRenderSettings();
  } catch (e) {
    console.error('detect error:', e);
    settingsDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">Failed to detect model type.</div>';
    tuningControls.classList.add('hidden');
    tweaksSection.classList.add('hidden');
  }
}

// ---- VRAM warning for context slider ----
function updateVramWarning(ctxLen) {
  const meta = currentModelMeta;
  if (!meta || currentModelType?.type !== 'llama.cpp') {
    vramWarning.classList.add('hidden');
    ctxVramEst.textContent = '';
    return;
  }
  const nLayers = meta.blockCount || 32;
  const nHeads = meta.headCount || 32;
  const nKvHeads = meta.headCountKv || nHeads;
  const embDim = meta.embeddingLength || 4096;
  const headDim = embDim / nHeads;
  const vramList = (sysInfo.gpu || []).map(g => {
    const ded = parseFloat(g.vramGB) || 0;
    const shared = parseFloat(g.vramSharedGB) || 0;
    return ded + shared;
  });
  const vramGB = Math.max(0, ...vramList);
  let kvBytes;
  if (tweaksState.kvCache === 'off') kvBytes = 2;
  else if (tweaksState.kvCache === 'q8_0') kvBytes = 1;
  else kvBytes = 0.5;
  const kvCacheGB = (ctxLen * nLayers * 2 * nKvHeads * headDim * kvBytes) / (1024 * 1024 * 1024);

  let fractionGpu;
  if (tweaksState.gpuLayers === 'max') fractionGpu = 1;
  else if (tweaksState.gpuLayers === 'min') fractionGpu = 0;
  else fractionGpu = vramGB >= 24 ? 1 : vramGB >= 12 ? 0.5 : vramGB >= 8 ? 0.3 : vramGB >= 4 ? 0.16 : 0;
  const weightsOnGpuGB = currentFileSize ? (currentFileSize * fractionGpu) / (1024 * 1024 * 1024) : 0;
  const totalVramGB = kvCacheGB + weightsOnGpuGB;

  ctxVramEst.textContent = `KV cache: ${kvCacheGB.toFixed(2)} GB`;
  if (vramGB > 0 && totalVramGB > vramGB) {
    vramWarning.classList.remove('hidden');
    vramWarning.title = `Context at ${ctxLen.toLocaleString()} needs ${kvCacheGB.toFixed(2)} GB KV cache + ${weightsOnGpuGB.toFixed(2)} GB weights = ${totalVramGB.toFixed(2)} GB total, exceeds ${vramGB.toFixed(2)} GB VRAM`;
  } else {
    vramWarning.classList.add('hidden');
  }
}

// ---- Compute settings ----
function computeAndRenderSettings() {
  if (!sysInfo || !currentModelType) return;

  const ramGB = parseFloat(sysInfo.memory.totalGB) || 16;
  const vramList = (sysInfo.gpu || []).map(g => {
    const ded = parseFloat(g.vramGB) || 0;
    const shared = parseFloat(g.vramSharedGB) || 0;
    return ded + shared;
  });
  const vramGB = Math.max(0, ...vramList);
  const physicalCores = Math.max(1, sysInfo.cpu.physicalCores || sysInfo.cpu.cores || 4);

  const ctxLen = parseInt(ctxSlider.value);
  const threads = Math.min(physicalCores, 32);

  let gpuLayers, evalBatch, physBatch, flashAttn, kCacheQ, vCacheQ;

  if (tweaksState.gpuLayers === 'max') gpuLayers = 100;
  else if (tweaksState.gpuLayers === 'min') gpuLayers = 0;
  else gpuLayers = vramGB >= 24 ? 100 : vramGB >= 12 ? 50 : vramGB >= 8 ? 30 : vramGB >= 4 ? 16 : 0;

  if (tweaksState.batch === 'large') { evalBatch = 512; physBatch = 2048; }
  else if (tweaksState.batch === 'small') { evalBatch = 32; physBatch = 256; }
  else { evalBatch = vramGB > 8 ? 128 : 64; physBatch = vramGB > 8 ? 1024 : 512; }

  if (tweaksState.kvCache === 'off') { kCacheQ = 'Off'; vCacheQ = 'Off'; }
  else if (tweaksState.kvCache === 'q8_0') { kCacheQ = 'Q8_0'; vCacheQ = 'Q8_0'; }
  else { kCacheQ = 'Q4_0'; vCacheQ = 'Q4_0'; }

  flashAttn = tweaksState.flashAttn === 'on' ? 'On' : 'Off';

  const settings = {};

  if (currentModelType.type === 'llama.cpp') {
    settings.llamaCpp = {
      "Context Length": ctxLen,
      "GPU Offload (n_gpu_layers)": gpuLayers,
      "CPU Thread Pool Size": threads,
      "Evaluation Batch Size (n_ubatch)": evalBatch,
      "Physical Batch Size (n_batch)": physBatch,
      "Max Concurrent Predictions": 1,
      "Unified KV Cache": "On",
      "RoPE Frequency Base": "Auto",
      "RoPE Frequency Scale": "Auto",
      "Offload KV Cache to GPU": "Off",
      "Keep Model in Memory": "On",
      "Try mmap()": "On",
      "Seed": "Random",
      "Number of Experts": 8,
      "Number of Layers (Experimental)": 30,
      "Flash Attention": flashAttn,
      "K Cache Quantization": kCacheQ,
      "V Cache Quantization": vCacheQ
    };
    settings.ollama = {
      num_thread: threads,
      num_gpu: 1,
      num_ctx: ctxLen
    };
  } else if (['pytorch', 'hf', 'safetensors'].includes(currentModelType.type)) {
    const useGPU = vramGB >= 4;
    settings.hf = {
      device: useGPU ? 'cuda' : 'cpu',
      torch_dtype: useGPU ? 'float16' : 'float32',
      max_memory: {
        ...(useGPU ? { 0: `${Math.floor((vramGB - 2) * 0.9)}GB` } : {}),
        cpu: `${Math.floor((ramGB - 2) * 0.8)}GB`
      }
    };
  } else if (currentModelType.type === 'onnx' && vramGB >= 6) {
    settings.trtllm = {
      precision: 'fp16',
      max_batch_size: Math.floor(vramGB * 4),
      max_input_len: 512,
      max_output_len: 128
    };
  } else if (currentModelType.type === 'unknown' || currentModelType.type === 'error') {
    settings.info = 'Model type not recognised \u2013 try a GGUF, ONNX, PyTorch or SafeTensors file.';
  }

  renderSettings(settings);
  computeResourceEstimates(ctxLen, vramGB, gpuLayers, kCacheQ, vCacheQ);
  updateVramWarning(ctxLen);
}

// ---- Resource usage estimation ----
function computeResourceEstimates(ctxLen, vramGB, gpuLayers, kCacheQ, vCacheQ) {
  const meta = currentModelMeta;
  const nLayers = meta?.blockCount || 32;
  const nHeads = meta?.headCount || 32;
  const nKvHeads = meta?.headCountKv || nHeads;
  const embDim = meta?.embeddingLength || 4096;
  const isLLaMA = currentModelType?.type === 'llama.cpp';

  if (!isLLaMA || !meta || embDim === 0) {
    resourceCard.classList.add('hidden');
    return;
  }
  resourceCard.classList.remove('hidden');

  const headDim = embDim / nHeads;
  const ramGB = parseFloat(sysInfo.memory?.totalGB) || 16;

  let kvBytes, kvLabel;
  if (kCacheQ === 'Off') { kvBytes = 2; kvLabel = 'FP16'; }
  else if (kCacheQ === 'Q8_0') { kvBytes = 1; kvLabel = 'Q8_0'; }
  else { kvBytes = 0.5; kvLabel = 'Q4_0'; }

  const kvCacheBytes = ctxLen * nLayers * 2 * nKvHeads * headDim * kvBytes;
  const kvCacheGB = kvCacheBytes / (1024 * 1024 * 1024);

  const fractionGpu = Math.min(gpuLayers, nLayers) / nLayers;
  const weightsOnGpuBytes = currentFileSize * fractionGpu;
  const weightsOnGpuGB = weightsOnGpuBytes / (1024 * 1024 * 1024);

  const weightsOnCpuGB = (currentFileSize * (1 - fractionGpu)) / (1024 * 1024 * 1024);

  const totalVramGB = kvCacheGB + weightsOnGpuGB;
  const utilPct = vramGB > 0 ? Math.min(100, (totalVramGB / vramGB) * 100) : 0;

  const flashLabel = tweaksState.flashAttn === 'on' ? 'On' : 'Off';
  const rows = [
    { setting: 'Context Length', consumes: formatGB(kvCacheGB), resource: getChip('vram', 'VRAM'), detail: `KV cache grows linearly with context` },
    { setting: 'GPU Offload', consumes: `${formatGB(weightsOnGpuGB)} GPU / ${formatGB(weightsOnCpuGB)} CPU`, resource: getChip(fractionGpu > 0.5 ? 'vram' : 'ram', `${Math.round(fractionGpu * 100)}% GPU`), detail: `Weights split: GPU (${Math.round(fractionGpu * 100)}%) vs CPU RAM (${Math.round((1 - fractionGpu) * 100)}%)` },
    { setting: 'Batch Size', consumes: `~${formatGB(weightsOnGpuGB * 0.02)} extra`, resource: getChip('vram', 'VRAM'), detail: `Larger batches = more VRAM for attention buffers` },
    { setting: 'KV Cache Precision', consumes: `${kvLabel} \u2192 ${kvCacheGB > 0 ? formatGB(kvCacheGB) : '\u2014'}`, resource: getChip('vram', 'VRAM'), detail: `${kvLabel} = ${kvBytes === 2 ? '2\u00D7' : kvBytes === 1 ? '1\u00D7' : '0.5\u00D7'} VRAM vs FP16` },
    { setting: 'Flash Attention', consumes: flashLabel === 'On' ? 'Saves ~10-30% VRAM' : 'Standard VRAM', resource: getChip('gpu', 'GPU compute'), detail: flashLabel === 'On' ? 'Lower VRAM + faster on compatible GPUs' : 'Standard attention, uses more VRAM' }
  ];
  allocBody.innerHTML = rows.map(r =>
    `<tr><td class="al-setting">${r.setting}</td><td class="al-consumes">${r.consumes}</td><td class="al-resource">${r.resource}</td></tr>`
  ).join('');

  renderPoolInfo(vramGB, ramGB);

  resKvCache.textContent = `${kvCacheGB.toFixed(2)} GB`;
  resWeights.textContent = `${weightsOnGpuGB.toFixed(2)} GB`;
  resTotalVram.textContent = `${totalVramGB.toFixed(2)} GB`;
  resAvailableVram.textContent = `${vramGB.toFixed(2)} GB`;
  resCpuRam.textContent = `${(weightsOnCpuGB + ramGB * 0.1).toFixed(2)} GB (weights + overhead)`;
  resUtilFill.style.width = `${Math.min(utilPct, 100)}%`;
  resUtilFill.style.background = utilPct > 90 ? 'var(--danger)' : utilPct > 70 ? 'var(--warning)' : 'var(--success)';

  if (utilPct > 100) {
    resNote.textContent = `\u26A0 Exceeds VRAM by ${(totalVramGB - vramGB).toFixed(2)} GB \u2014 reduce context or increase CPU offload.`;
    resNote.style.color = 'var(--danger)';
  } else if (utilPct > 80) {
    resNote.textContent = `\u26A0 Tight fit \u2014 ${(100 - utilPct).toFixed(0)}% VRAM free.`;
    resNote.style.color = 'var(--warning)';
  } else {
    resNote.textContent = `\u2713 Comfortable \u2014 ${(100 - utilPct).toFixed(0)}% VRAM free.`;
    resNote.style.color = 'var(--success)';
  }
}

function getChip(type, label) {
  const cls = type === 'vram' ? 'chip-vram' : type === 'ram' ? 'chip-ram' : 'chip-gpu';
  return `<span class="alloc-chip ${cls}">${label}</span>`;
}

function formatGB(bytes) {
  if (bytes < 0.01) return '<0.01 GB';
  return bytes.toFixed(2) + ' GB';
}

function renderPoolInfo(vramGB, ramGB) {
  const gpuList = sysInfo?.gpu || [];
  const gpuCount = gpuList.length;

  let totalDedicated = 0;
  let totalShared = 0;
  const gpuLines = [];
  gpuList.forEach((g, i) => {
    const ded = parseFloat(g.vramGB) || 0;
    const shared = parseFloat(g.vramSharedGB) || 0;
    totalDedicated += ded;
    totalShared = Math.max(totalShared, shared);
    const label = gpuCount > 1 ? `GPU ${i + 1}` : 'GPU';
    gpuLines.push(`<span class="pool-gpu">${g.model || label}: ${ded.toFixed(1)} GB dedicated${shared > 0 ? ` + ${shared.toFixed(1)} GB shared` : ''}</span>`);
  });

  let poolNote = '';
  if (gpuCount > 1) {
    if (gpuList.every(g => (g.model || '').toLowerCase().includes('nvidia'))) {
      poolNote = 'NVIDIA GPUs support tensor parallelism (llama.cpp -ts) and CUDA peer access. Combined VRAM usable with --tensor-split.';
    } else {
      poolNote = `${gpuCount} GPUs detected. Pooling across heterogeneous GPUs is possible with llama.cpp's --tensor-split flag.`;
    }
  }
  if (totalShared > 0) {
    poolNote += (poolNote ? ' ' : '') + `Shared system memory (${totalShared.toFixed(1)} GB) is automatically used when dedicated VRAM is exceeded, at lower bandwidth.`;
  }

  const canPool = gpuCount > 1;
  poolBadge.textContent = canPool ? `${gpuCount} GPUs` : `${gpuCount} GPU`;
  poolBadge.style.background = canPool ? 'var(--accent-light)' : 'var(--bg-tertiary)';
  poolBadge.style.color = canPool ? 'var(--accent)' : 'var(--text-muted)';

  poolGrid.innerHTML = `
    <div class="pool-item"><span class="pool-label">Dedicated VRAM</span><span class="pool-value">${totalDedicated.toFixed(1)} GB${gpuCount > 1 ? ` (${gpuList.map(g => parseFloat(g.vramGB).toFixed(1) + ' GB').join(' + ')})` : ''}</span></div>
    <div class="pool-item"><span class="pool-label">Shared VRAM Pool</span><span class="pool-value">${totalShared.toFixed(1)} GB (system RAM, slower)</span></div>
    <div class="pool-item"><span class="pool-label">System RAM</span><span class="pool-value">${ramGB.toFixed(1)} GB</span></div>
    ${gpuLines.length > 0 ? `<div class="pool-item"><span class="pool-label">${gpuCount > 1 ? 'GPUs' : 'GPU'}</span><span class="pool-value">${gpuLines.join('<br>')}</span></div>` : ''}
    ${poolNote ? `<div class="pool-item pool-note"><span class="pool-label">Note</span><span class="pool-value">${poolNote}</span></div>` : ''}
  `;
}

// ---- Render settings as styled cards ----
window._lastSettings = null;

function renderSettings(settings) {
  window._lastSettings = settings;
  if (!settings || Object.keys(settings).length === 0) {
    settingsDiv.innerHTML = '<div class="empty-state">No settings available for this model type.</div>';
    return;
  }
  let html = '';
  for (const [backend, opts] of Object.entries(settings)) {
    if (typeof opts === 'string') {
      html += `<div class="settings-card">
        <div class="settings-card-header"><span class="title">${escapeHtml(backend)}</span></div>
        <div class="settings-card-body"><div class="empty-state">${escapeHtml(opts)}</div></div>
      </div>`;
    } else {
      html += `<div class="settings-card">
        <div class="settings-card-header">
          <span class="title">${escapeHtml(backend)}</span>
          <button class="btn-icon" data-copy-backend="${escapeHtml(backend)}" title="Copy as JSON">📋</button>
        </div>
        <div class="settings-card-body">`;
      for (const [key, value] of Object.entries(opts)) {
        const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
        html += `<div class="setting-row">
          <span class="label" title="${escapeHtml(key)}">${escapeHtml(key)}</span>
          <span class="val">${escapeHtml(valStr)}</span>
        </div>`;
      }
      html += `</div></div>`;
    }
  }
  html += `<div class="settings-actions">
    <button class="btn" data-copy-all="1">📋 Copy All as JSON</button>
  </div>`;
  settingsDiv.innerHTML = html;
}

// ---- Copy handlers (event delegation) ----
settingsDiv.addEventListener('click', async (e) => {
  const backendBtn = e.target.closest('[data-copy-backend]');
  if (backendBtn && window._lastSettings) {
    const backend = backendBtn.dataset.copyBackend;
    const data = window._lastSettings[backend];
    if (data) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        backendBtn.textContent = '✅';
        setTimeout(() => { backendBtn.textContent = '📋'; }, 2000);
      } catch {}
    }
    return;
  }
  const allBtn = e.target.closest('[data-copy-all]');
  if (allBtn && window._lastSettings) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(window._lastSettings, null, 2));
      allBtn.textContent = '✅ Copied!';
      setTimeout(() => { allBtn.textContent = '📋 Copy All as JSON'; }, 2500);
    } catch {}
  }
});

// ---- Context slider handler ----
ctxSlider.addEventListener('input', () => {
  ctxValue.textContent = parseInt(ctxSlider.value).toLocaleString();
  if (currentModelType && currentModelType.type === 'llama.cpp') {
    computeAndRenderSettings();
  }
});

// ---- Tweaks handler (event delegation) ----
tweaksSection.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-group-btn');
  if (!btn) return;
  const group = btn.closest('.btn-group');
  if (!group) return;
  const tweak = group.dataset.tweak;
  if (!tweak || !(tweak in tweaksState)) return;

  const value = btn.dataset.value;
  if (!value) return;

  group.querySelectorAll('.btn-group-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  tweaksState[tweak] = value;

  updateTweakDescriptions();
  if (currentModelType && currentModelType.type === 'llama.cpp') {
    computeAndRenderSettings();
  }
});

function updateTweakDescriptions() {
  const descMap = {
    gpuLayers: { min: 'Min \u2014 saves VRAM for big models', auto: 'Auto \u2014 optimized for VRAM', max: 'Max \u2014 fastest inference' },
    batch: { small: 'Small \u2014 lower VRAM usage', auto: 'Auto \u2014 optimized for VRAM', large: 'Large \u2014 higher throughput' },
    kvCache: { off: 'FP16 \u2014 best quality, higher VRAM', q4_0: 'Q4_0 \u2014 best trade-off', q8_0: 'Q8_0 \u2014 balanced' },
    flashAttn: { on: 'On \u2014 faster inference', off: 'Off \u2014 compatible only' }
  };
  const noteMap = {
    gpuLayers: {
      min: 'CPU-only inference. Saves VRAM for running alongside other GPU apps.',
      auto: 'Offloads layers proportionally to your VRAM. Best all-round choice.',
      max: 'Offloads all layers to GPU. Fastest but requires enough VRAM for the full model.'
    },
    batch: {
      small: 'Minimal VRAM overhead. Best when running large models near your VRAM limit.',
      auto: 'Batch sizes scaled to your available VRAM. Recommended for most users.',
      large: 'Increases throughput significantly. Needs abundant VRAM to avoid OOM errors.'
    },
    kvCache: {
      off: 'Full FP16 precision KV cache. Highest quality but uses ~2x VRAM.',
      q4_0: '4-bit quantised KV cache. Near-zero quality loss with ~4x VRAM savings.',
      q8_0: '8-bit quantised KV cache. Slight quality improvement over Q4_0 at ~2x VRAM.'
    },
    flashAttn: {
      on: 'Uses memory-efficient flash attention kernels. Faster and lower VRAM on compatible GPUs.',
      off: 'Standard attention implementation. Works everywhere, but slower and uses more VRAM.'
    }
  };
  for (const [tweak, value] of Object.entries(tweaksState)) {
    const descEl = document.getElementById(tweak + 'Desc');
    const noteEl = document.getElementById(tweak + 'Note');
    if (descEl && descMap[tweak] && descMap[tweak][value]) descEl.textContent = descMap[tweak][value];
    if (noteEl && noteMap[tweak] && noteMap[tweak][value]) noteEl.textContent = noteMap[tweak][value];
  }
}

// ---- Browse button ----
selectFolderBtn.addEventListener('click', async () => {
  const folderPath = await window.api.openDialogForFolder();
  if (!folderPath) return;
  await scanFolder(folderPath);
});

// ---- Ollama button ----
ollamaBtn.addEventListener('click', async () => {
  modelListDiv.innerHTML = '<div class="loading-text"><span class="spinner"></span> Reading Ollama manifests\u2026</div>';
  scanStatus.textContent = '';
  try {
    scannedModels = await window.api.scanOllamaModels();
    if (scannedModels.length === 0) {
      modelListDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">No Ollama models found. Make sure you have pulled at least one model.</div>';
      return;
    }
    selectFolderBtn.style.display = 'none';
    ollamaBtn.style.display = 'none';
    renderModelList();
    scanStatus.textContent = `${scannedModels.length} model(s) found`;
  } catch (e) {
    console.error('ollama scan error:', e);
    modelListDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">Failed to read Ollama models.</div>';
  }
});

// ---- Export Profiles ----
const exportCard = document.getElementById('exportCard');
const exportGrid = document.getElementById('exportGrid');
const exportOutput = document.getElementById('exportOutput');
const exportOutputPre = document.getElementById('exportOutputPre');
const exportOutputLabel = document.getElementById('exportOutputLabel');
const exportCopyBtn = document.getElementById('exportCopyBtn');

exportGrid.addEventListener('click', async (e) => {
  const card = e.target.closest('.export-card');
  if (!card) return;
  const format = card.dataset.export;
  if (!format || !window._lastSettings || !currentModelType) return;
  try {
    const result = await window.api.exportConfig(format, sysInfo, currentModelType, window._lastSettings);
    exportOutput.classList.remove('hidden');
    exportOutputPre.textContent = result.content;
    exportOutputLabel.textContent = `Export: ${result.contentType}`;
    await navigator.clipboard.writeText(result.content);
    const btn = card.querySelector('.btn-export');
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch (e) { console.error('export error:', e); }
});

exportCopyBtn.addEventListener('click', async () => {
  const text = exportOutputPre.textContent;
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      exportCopyBtn.textContent = '✅';
      setTimeout(() => { exportCopyBtn.textContent = '📋'; }, 2000);
    } catch {}
  }
});

// ---- Benchmark Integration ----
const benchmarkCard = document.getElementById('benchmarkCard');
const benchSummary = document.getElementById('benchSummary');
const benchBody = document.getElementById('benchBody');
const benchRefsBody = document.getElementById('benchRefsBody');

async function loadBenchmarkData() {
  if (!sysInfo || !currentModelMeta) return;
  try {
    const data = await window.api.getBenchmarkData(sysInfo, currentModelMeta);
    benchmarkCard.classList.remove('hidden');
    const est = data.estimated;
    const paramsLabel = est.paramCount >= 1 ? `${est.paramCount}B` : `${Math.round(est.paramCount * 1000)}M`;
    benchSummary.innerHTML = `
      <div class="bench-stat"><span class="bench-stat-label">Model Size</span><span class="bench-stat-value">${paramsLabel} params</span></div>
      <div class="bench-stat"><span class="bench-stat-label">GPU VRAM</span><span class="bench-stat-value">${est.gpuVramGb.toFixed(1)} GB</span></div>
      <div class="bench-stat"><span class="bench-stat-label">Memory BW</span><span class="bench-stat-value">~${est.memoryBandwidthGbs} GB/s</span></div>
      <div class="bench-stat highlight"><span class="bench-stat-label">Estimated Speed</span><span class="bench-stat-value">${est.tokensPerSecond} tok/s</span></div>`;
    benchBody.innerHTML = `
      <tr><td>Decode (token generation)</td><td>${est.tokensPerSecond} tok/s</td></tr>
      <tr><td>Prefill (prompt processing)</td><td>${est.prefillTokensPerSecond} tok/s</td></tr>
      <tr><td>Memory bandwidth (est.)</td><td>~${est.memoryBandwidthGbs} GB/s</td></tr>
      <tr><td>CPU threads</td><td>${est.cpuCores}</td></tr>
      <tr><td>System RAM</td><td>${est.systemRamGb.toFixed(1)} GB</td></tr>`;
    if (data.references && data.references.length > 0) {
      benchRefsBody.innerHTML = `<table class="bench-table" style="margin-top:8px;">
        <thead><tr><th>Hardware</th><th>Model</th><th>tok/s</th></tr></thead>
        <tbody>${data.references.map(r => `<tr><td>${escapeHtml(r.hardware)}</td><td>${escapeHtml(r.model)}</td><td>${r.tps}</td></tr>`).join('')}</tbody>
      </table>`;
    } else { benchRefsBody.innerHTML = '<div class="empty-state">No reference data.</div>'; }
  } catch (e) { console.error('benchmark error:', e); }
}

// ---- Hardware Compatibility Matrix ----
const compatCard = document.getElementById('compatCard');
const compatSpecs = document.getElementById('compatSpecs');
const compatBody = document.getElementById('compatBody');

async function loadCompatibilityMatrix() {
  if (!sysInfo) return;
  try {
    const data = await window.api.getCompatibilityMatrix(sysInfo);
    compatCard.classList.remove('hidden');
    compatSpecs.innerHTML = `
      <div class="compat-spec"><span>GPU Architecture</span><strong>${escapeHtml(data.gpuArch)}</strong></div>
      <div class="compat-spec"><span>VRAM</span><strong>${data.vramGB.toFixed(1)} GB</strong></div>
      <div class="compat-spec"><span>System RAM</span><strong>${data.ramGB.toFixed(1)} GB</strong></div>`;
    compatBody.innerHTML = data.rows.map(r => {
      let compatClass = 'compat-no';
      let compatLabel = '❌';
      if (r.compat.startsWith('✅')) { compatClass = 'compat-yes'; compatLabel = '✅ Optimal'; }
      else if (r.compat.startsWith('⚠️')) { compatClass = 'compat-limited'; compatLabel = '⚠️ Limited'; }
      return `<tr class="${compatClass}">
        <td class="compat-model-name">${escapeHtml(r.name)}</td>
        <td>${r.minVram} GB</td>
        <td>${r.recVram} GB</td>
        <td>${r.q4}</td>
        <td>${r.q8}</td>
        <td>${r.fp16}</td>
        <td><strong>${compatLabel}</strong></td>
      </tr>`;
    }).join('');
  } catch (e) { console.error('compat matrix error:', e); }
}

// Show/hide new cards when model is selected
const origDetectAndShow = detectAndShowSettings;
detectAndShowSettings = async function(filePath) {
  await origDetectAndShow(filePath);
  if (currentModelType && currentModelType.type === 'llama.cpp') {
    exportCard.classList.remove('hidden');
    loadBenchmarkData();
  } else {
    exportCard.classList.add('hidden');
    benchmarkCard.classList.add('hidden');
  }
};

// Load compatibility matrix after system info
const origSysInfoIife = (async function(){}); // placeholder, real load happens inline below

// ---- HF recommendations with app-aware import ----
const fetchHfBtn = document.getElementById('fetchHfBtn');
const hfStatus = document.getElementById('hfStatus');
const hfResults = document.getElementById('hfResults');
const importBackend = document.getElementById('importBackend');
const appBadge = document.getElementById('appBadge');
const appPrompt = document.getElementById('appPrompt');

let installedApps = [];

(async function loadInstalledApps() {
  try {
    installedApps = await window.api.scanInstalledApps();
    const detected = installedApps.filter(a => a.detected);
    importBackend.innerHTML = '';
    if (detected.length > 0) {
      detected.forEach(app => {
        const opt = document.createElement('option');
        opt.value = app.id;
        opt.textContent = `✓ ${app.name}`;
        opt.title = app.path;
        importBackend.appendChild(opt);
      });
      importBackend.innerHTML += '<option disabled>──────────</option>';
      appBadge.textContent = `✓ ${detected.map(a => a.name).join(', ')}`;
      appBadge.className = 'app-badge detected';
    }
    const nonDetected = installedApps.filter(a => !a.detected);
    nonDetected.forEach(app => {
      const opt = document.createElement('option');
      opt.value = app.id;
      opt.textContent = app.name;
      importBackend.appendChild(opt);
    });
    if (importBackend.options.length > 0) importBackend.selectedIndex = 0;
    if (detected.length === 0) {
      appBadge.textContent = 'No inference apps detected';
      appBadge.className = 'app-badge none';
      appPrompt.textContent = 'Install Ollama or llama.cpp for one-click import.';
      appPrompt.className = 'app-prompt info';
    }
  } catch (e) {
    console.error('app detection error:', e);
    importBackend.innerHTML = '<option value="ollama">Ollama</option><option value="llamacpp">llama.cpp</option><option value="hf-cli">HuggingFace CLI</option><option value="url">Direct URL</option>';
  }
})();

function getSelectedAppId() { return importBackend.value; }
function getSelectedApp() { return installedApps.find(a => a.id === getSelectedAppId()); }

fetchHfBtn.addEventListener('click', async () => {
  fetchHfBtn.disabled = true;
  hfStatus.textContent = '';
  hfResults.innerHTML = '<div class="loading-text"><span class="spinner"></span> Fetching recommendations\u2026</div>';
  const appId = getSelectedAppId();
  const app = getSelectedApp();
  try {
    const recs = await window.api.getHfRecommendations(sysInfo);
    let html = '';
    for (const [category, models] of Object.entries(recs)) {
      html += `<div class="rec-category"><h3>${escapeHtml(category)}</h3>`;
      for (const m of models) {
        const cmd = await window.api.getImportCommand(m.id, appId);
        const badge = m.pipeline ? ` <span style="font-size:11px;color:var(--text-muted)">[${escapeHtml(m.pipeline)}]</span>` : '';
        let actionBtn;
        if (cmd.action === 'open-url') {
          actionBtn = `<a href="${cmd.command}" target="_blank" rel="noopener" class="btn">📥 Open in Browser</a>`;
        } else {
          actionBtn = `<button class="btn cmd-btn" data-cmd="${escapeHtml(cmd.command)}">📥 ${escapeHtml(cmd.label)}</button>`;
        }
        html += `<div class="rec-card">
          <strong>${escapeHtml(m.id)}${badge}</strong>
          <div class="desc">${escapeHtml(m.comment || '')}</div>
          <div class="meta">\u2B07 ${(m.downloads || 0).toLocaleString()} \u00B7 \u2665 ${(m.likes || 0).toLocaleString()}</div>
          <div class="rec-actions">${actionBtn}<a href="${m.hfUrl}" target="_blank" rel="noopener">HF \u2197</a></div>
        </div>`;
      }
      html += '</div>';
    }
    hfResults.innerHTML = html;
    hfStatus.textContent = `Recommendations for ${app ? app.name : 'selected app'}`;
  } catch (e) {
    console.error('HF error:', e);
    hfResults.innerHTML = '<div class="empty-state" style="color:var(--danger);">Error fetching recommendations.</div>';
    hfStatus.textContent = 'Error';
  } finally { fetchHfBtn.disabled = false; }
});

hfResults.addEventListener('click', async (e) => {
  const btn = e.target.closest('.cmd-btn');
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (!cmd) return;
  try {
    await navigator.clipboard.writeText(cmd);
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch {}
});

importBackend.addEventListener('change', async () => {
  const appId = getSelectedAppId();
  const app = getSelectedApp();
  if (app) {
    appPrompt.textContent = app.detected ? `Using ${app.name} at ${app.path}` : `${app.name} \u2014 commands shown but app not detected`;
    appPrompt.className = `app-prompt ${app.detected ? 'detected' : 'undetected'}`;
  }
  const cmdBtns = hfResults.querySelectorAll('.cmd-btn');
  for (const btn of cmdBtns) {
    const recCard = btn.closest('.rec-card');
    if (!recCard) continue;
    const link = recCard.querySelector('a[href*="huggingface.co"]');
    if (!link) continue;
    const modelId = decodeURIComponent(link.getAttribute('href').replace('https://huggingface.co/', ''));
    try {
      const cmd = await window.api.getImportCommand(modelId, appId);
      if (cmd.action === 'open-url') {
        btn.outerHTML = `<a href="${cmd.command}" target="_blank" rel="noopener" class="btn">📥 Open in Browser</a>`;
      } else {
        btn.textContent = `📥 ${cmd.label}`;
        btn.dataset.cmd = cmd.command;
      }
    } catch {}
  }
});

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.key === 'o') {
    e.preventDefault();
    selectFolderBtn.click();
  } else if (e.key === 'r') {
    e.preventDefault();
    if (currentModelPath) detectAndShowSettings(currentModelPath);
  } else if (e.key === 'd') {
    e.preventDefault();
    toggleTheme();
  }
});
