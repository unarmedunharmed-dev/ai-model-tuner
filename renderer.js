const escapeHtml = (str) => {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

let sysInfo = null;
let currentModelPath = null;
let currentModelType = null;
let currentModelMeta = null;
let currentFileSize = 0;
let tweaksState = {
  gpuLayers: 'auto',
  batch: 'auto',
  kvCache: 'q4_0',
  flashAttn: 'on'
};

const selectFolderBtn = document.getElementById('selectFolderBtn');
const modelListDiv = document.getElementById('modelList');
const tuningControls = document.getElementById('tuningControls');
const ctxSlider = document.getElementById('ctxSlider');
const ctxValue = document.getElementById('ctxValue');
const settingsDiv = document.getElementById('settings');
const tweaksSection = document.getElementById('tweaksSection');
const resourceCard = document.getElementById('resourceCard');
const allocBody = document.getElementById('allocBody');
const poolDetails = document.getElementById('poolDetails');
const poolGrid = document.getElementById('poolGrid');
const poolBadge = document.getElementById('poolBadge');
const resKvCache = document.getElementById('resKvCache');
const resWeights = document.getElementById('resWeights');
const resTotalVram = document.getElementById('resTotalVram');
const resUtilFill = document.getElementById('resUtilFill');
const resAvailableVram = document.getElementById('resAvailableVram');
const resCpuRam = document.getElementById('resCpuRam');
const resNote = document.getElementById('resNote');
const gpuDesc = document.getElementById('gpuDesc');
const gpuNote = document.getElementById('gpuNote');
const batchDesc = document.getElementById('batchDesc');
const batchNote = document.getElementById('batchNote');
const kvDesc = document.getElementById('kvDesc');
const kvNote = document.getElementById('kvNote');
const flashDesc = document.getElementById('flashDesc');
const flashNote = document.getElementById('flashNote');
const modelInfo = document.getElementById('modelInfo');
const sysDetails = document.getElementById('sysDetails');
const ollamaBtn = document.getElementById('ollamaBtn');
const scanStatus = document.getElementById('scanStatus');

document.querySelectorAll('.btn-group').forEach(group => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-group-btn');
    if (!btn) return;
    const tweak = group.dataset.tweak;
    if (!tweak) return;
    const value = btn.dataset.value;
    if (!value) return;
    if (tweaksState[tweak] === value) return;
    tweaksState[tweak] = value;
    group.querySelectorAll('.btn-group-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentModelPath && currentModelType) detectAndShowSettings(currentModelPath);
    updateTweakDescriptions();
  });
});

function updateTweakDescriptions() {
  const gpuMap = { min: 'Min — CPU offload', auto: 'Auto — optimized for VRAM', max: 'Max — all layers on GPU' };
  const gpuNotes = { min: 'Min keeps model on CPU to save VRAM for other uses.', auto: 'Auto balances VRAM and speed based on your GPU.', max: 'Max offloads everything to GPU for fastest inference.' };
  gpuDesc.textContent = gpuMap[tweaksState.gpuLayers] || '';
  gpuNote.textContent = gpuNotes[tweaksState.gpuLayers] || '';

  const batchMap = { small: 'Small — save VRAM', auto: 'Auto — optimized for VRAM', large: 'Large — faster' };
  const batchNotes = { small: 'Small batches use less VRAM for big models.', auto: 'Auto picks batch size based on model and VRAM.', large: 'Large batches increase throughput on powerful GPUs.' };
  batchDesc.textContent = batchMap[tweaksState.batch] || '';
  batchNote.textContent = batchNotes[tweaksState.batch] || '';

  const kvMap = { off: 'FP16 — quality', q4_0: 'Q4_0 — best trade-off', q8_0: 'Q8_0 — balanced' };
  const kvNotes = { off: 'FP16 KV cache preserves quality but uses more VRAM.', q4_0: 'Q4_0 quantisation saves significant VRAM at negligible quality loss.', q8_0: 'Q8_0 is a middle ground between quality and VRAM savings.' };
  kvDesc.textContent = kvMap[tweaksState.kvCache] || '';
  kvNote.textContent = kvNotes[tweaksState.kvCache] || '';

  const flashMap = { on: 'On — faster inference', off: 'Off — compatible' };
  const flashNotes = { on: 'Flash attention speeds up inference on compatible GPUs.', off: 'Turn off flash attention if you experience instability.' };
  flashDesc.textContent = flashMap[tweaksState.flashAttn] || '';
  flashNote.textContent = flashNotes[tweaksState.flashAttn] || '';
}
updateTweakDescriptions();

function computeResourceEstimates(ctxLen, vramGB, gpuLayersPct, kCacheQ, vCacheQ) {
  if (!currentModelMeta || !currentModelMeta.architecture) {
    resourceCard.classList.add('hidden');
    return null;
  }
  const meta = currentModelMeta;
  const nLayers = meta.blockCount || 32;
  const nHeads = meta.headCount || 32;
  const nKvHeads = meta.headCountKv || nHeads;
  const embDim = meta.embeddingLength || 4096;
  const headDim = embDim / nHeads;
  const nExpert = meta.expertCount || 0;
  const nUsedExpert = meta.usedExpertCount || 0;

  let kvBytes;
  if (kCacheQ === 'off') kvBytes = 2;
  else if (kCacheQ === 'q8_0') kvBytes = 1;
  else kvBytes = 0.5;
  let vBytes;
  if (vCacheQ === 'off') vBytes = 2;
  else if (vCacheQ === 'q8_0') vBytes = 1;
  else vBytes = 0.5;
  const kvCacheGB = (ctxLen * nLayers * (nKvHeads * headDim * kvBytes + nKvHeads * headDim * vBytes)) / (1e9);

  let totalParams = 0;
  if (currentFileSize && meta.quantization) {
    const bitsPerWeight = { 'Q4_0': 4.5, 'Q4_1': 4.5, 'Q5_0': 5.5, 'Q5_1': 5.5, 'Q8_0': 8.5, 'Q6_K': 6.5, 'Q5_K_M': 5.5, 'Q5_K_S': 5.5, 'Q4_K_M': 4.5, 'Q4_K_S': 4.5, 'Q3_K_M': 3.5, 'Q3_K_S': 3.5, 'Q2_K': 2.5, 'FP16': 16, 'FP32': 32, 'unknown': 8.5 };
    const bpw = bitsPerWeight[meta.quantization] || 8.5;
    totalParams = (currentFileSize * 8) / (bpw / 8);
  }

  const moeMultiplier = (nUsedExpert > 0 && nExpert > 0) ? (nUsedExpert / nExpert) : 1;
  const weightsOnGpuGB = totalParams ? (totalParams * 2 * gpuLayersPct * moeMultiplier) / (1e9) : 0;
  const totalVramGB = kvCacheGB + weightsOnGpuGB;

  resourceCard.classList.remove('hidden');
  allocBody.innerHTML = '';
  const rows = [
    { setting: `KV Cache (${kCacheQ.toUpperCase()})`, consumes: `${kvCacheGB.toFixed(2)} GB`, res: 'VRAM' },
    { setting: 'Weights on GPU', consumes: `${weightsOnGpuGB.toFixed(2)} GB`, res: 'VRAM' },
    { setting: 'Total VRAM', consumes: `${totalVramGB.toFixed(2)} GB`, res: 'VRAM' },
  ];
  if (nUsedExpert > 0 && nExpert > 0) {
    rows.push({ setting: `MoE active (${nUsedExpert}/${nExpert})`, consumes: `${moeMultiplier.toFixed(2)}x`, res: 'GPU' });
  }
  rows.forEach(r => {
    const chip = { VRAM: 'chip-vram', RAM: 'chip-ram', GPU: 'chip-gpu' }[r.res] || 'chip-ram';
    allocBody.innerHTML += `<tr><td class="al-setting">${escapeHtml(r.setting)}</td><td class="al-consumes">${escapeHtml(r.consumes)}</td><td class="al-resource"><span class="alloc-chip ${chip}">${escapeHtml(r.res)}</span></td></tr>`;
  });

  resKvCache.textContent = `${kvCacheGB.toFixed(2)} GB`;
  resWeights.textContent = `${weightsOnGpuGB.toFixed(2)} GB`;
  resTotalVram.textContent = `${totalVramGB.toFixed(2)} GB`;
  resAvailableVram.textContent = `${vramGB.toFixed(2)} GB`;

  const cpuRamGB = ((totalParams ? totalParams * 2 * (1 - gpuLayersPct) * moeMultiplier : 0) + (1.5 * 1024 ** 3)) / (1e9);
  resCpuRam.textContent = `${cpuRamGB.toFixed(2)} GB`;
  const utilPct = vramGB > 0 ? Math.min(100, (totalVramGB / vramGB) * 100) : 0;
  resUtilFill.style.width = `${utilPct}%`;
  if (utilPct > 90) resUtilFill.style.background = 'var(--danger)';
  else if (utilPct > 70) resUtilFill.style.background = 'var(--warning)';
  else resUtilFill.style.background = 'var(--success)';

  if (totalVramGB > vramGB) resNote.textContent = '⚠️ Not enough VRAM for this configuration. Reduce context length or use fewer GPU layers.';
  else if (utilPct > 80) resNote.textContent = '⚠️ Tight fit — VRAM is nearly full.';
  else if (utilPct < 40) resNote.textContent = '✅ Comfortable — plenty of VRAM headroom.';
  else resNote.textContent = '';

  const gpuList = (sysInfo.gpu || []).map(g => {
    const ded = parseFloat(g.vramGB) || 0;
    const shared = parseFloat(g.vramSharedGB) || 0;
    return { name: g.name || 'GPU', ded, shared, total: ded + shared };
  });

  poolDetails.classList.remove('hidden');
  let poolHtml = '';
  gpuList.forEach((g, i) => {
    poolHtml += `<div class="pool-item"><span class="pool-label">GPU ${i + 1}${i === 0 ? ' (primary)' : ''}</span><span class="pool-value">${g.name}<span class="pool-gpu">${g.ded.toFixed(1)} GB dedicated + ${g.shared.toFixed(1)} GB shared = ${g.total.toFixed(1)} GB</span></span></div>`;
  });
  if (sysInfo.totalRam) {
    const totalRamGB = parseFloat(sysInfo.totalRam.replace(' GB', '')) || 0;
    const usedRamGB = (sysInfo.usedRam ? parseFloat(sysInfo.usedRam.replace(' GB', '')) : 0) || 0;
    poolHtml += `<div class="pool-item"><span class="pool-label">System RAM</span><span class="pool-value">${usedRamGB.toFixed(1)} / ${totalRamGB.toFixed(1)} GB<span class="pool-gpu"></span></span></div>`;
    poolHtml += `<div class="pool-item pool-note"><span class="pool-label">Shared GPU mem</span><span class="pool-value">Auto-allocated by driver, can overlap with CPU RAM</span></div>`;
  }
  poolGrid.innerHTML = poolHtml;
  poolBadge.textContent = `${gpuList.length} GPU(s)${gpuList.length > 0 ? `, ${gpuList[0].total.toFixed(0)} GB` : ''}`;

  return { kvCacheGB, weightsOnGpuGB, totalVramGB, cpuRamGB };
}

function renderSettings(settings) {
  const sectionMap = {
    'Model & Inference': ['type', 'modelPath', 'modelType', 'fileSize'],
    'Context & Memory': ['ctxLen', 'predict', 'batchSize', 'ubatchSize', 'mlock', 'noMmap'],
    'Quantisation & Precision': ['memoryF32', 'cacheTypeK', 'cacheTypeV', 'flashAttn'],
    'GPU Acceleration': ['nGpuLayers', 'mainGpu', 'splitMode', 'tensorSplit'],
    'MoE (Mixture of Experts)': ['moeExpertCount'],
    'Parallelism & Threading': ['numa', 'cpuMask', 'strictCpuMask', 'poll'],
    'Server / Embedding': ['embedding', 'port', 'slotSavePath'],
    'Sampling Parameters': ['temp', 'topK', 'topP', 'repeatPenalty'],
    'Other / Advanced': ['contBatching', 'noKvOffload', 'noKvQuant', 'logDisable']
  };

  if (!settings || !settings.llamaContextParams) {
    settingsDiv.innerHTML = '<div class="empty-state">No settings available. Select a model first.</div>';
    return;
  }

  let html = '';
  const flat = settings.llamaContextParams;
  const keys = Object.keys(flat);

  for (const [section, wanted] of Object.entries(sectionMap)) {
    const entries = wanted.filter(k => k in flat);
    if (entries.length === 0) continue;
    html += `<div class="settings-card"><div class="settings-card-header"><span class="title">${escapeHtml(section)}</span></div><div class="settings-card-body">`;
    entries.forEach(k => {
      let val = flat[k];
      if (typeof val === 'boolean') val = val ? 'true' : 'false';
      else if (typeof val === 'number' && val > 10000) val = val.toLocaleString();
      html += `<div class="setting-row"><span class="label">${escapeHtml(k)}</span><span class="val">${escapeHtml(String(val))}</span></div>`;
    });
    html += '</div></div>';
  }

  if (settings.extraRecommendations) {
    html += `<div class="settings-card"><div class="settings-card-header"><span class="title">Extra Recommendations</span></div><div class="settings-card-body">`;
    Object.entries(settings.extraRecommendations).forEach(([k, v]) => {
      html += `<div class="setting-row"><span class="label">${escapeHtml(k)}</span><span class="val">${escapeHtml(v)}</span></div>`;
    });
    html += '</div></div>';
  }

  html += `<div class="settings-actions">
    <button class="btn" id="copySettingsBtn">📋 Copy All Settings</button>
    <button class="btn" id="saveSettingsBtn">💾 Save Config File</button>
  </div>`;

  settingsDiv.innerHTML = html;

  document.getElementById('copySettingsBtn').addEventListener('click', () => {
    const text = Object.entries(flat).map(([k, v]) => `${k}: ${v}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      document.getElementById('copySettingsBtn').textContent = '✅ Copied!';
      setTimeout(() => { document.getElementById('copySettingsBtn').textContent = '📋 Copy All Settings'; }, 2000);
    });
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const text = JSON.stringify(flat, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentModelType?.type === 'llama.cpp' ? 'llamacpp-config.json' : 'model-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function computeAndRenderSettings() {
  if (!currentModelPath || !currentModelType) return;

  let gpuLayers;
  if (tweaksState.gpuLayers === 'max') gpuLayers = 999;
  else if (tweaksState.gpuLayers === 'min') gpuLayers = 0;
  else gpuLayers = undefined;

  let batch;
  if (tweaksState.batch === 'small') batch = 'safe';
  else if (tweaksState.batch === 'large') batch = 'large';
  else batch = 'auto';

  const ctxLen = parseInt(ctxSlider.value) || 8192;

  window.api.calcSettings(sysInfo, currentModelType).then(settings => {
    window._lastSettings = settings;
    let gpuLayersPct = 1;
    if (settings.llamaContextParams && settings.llamaContextParams.nGpuLayers != null) {
      const totalLayers = currentModelMeta?.blockCount || 32;
      gpuLayersPct = Math.min(1, settings.llamaContextParams.nGpuLayers / totalLayers);
    }
    const vramList = (sysInfo.gpu || []).map(g => {
      const ded = parseFloat(g.vramGB) || 0;
      const shared = parseFloat(g.vramSharedGB) || 0;
      return ded + shared;
    });
    const vramGB = Math.max(0, ...vramList);
    computeResourceEstimates(ctxLen, vramGB, gpuLayersPct, tweaksState.kvCache, tweaksState.kvCache);
    renderSettings(settings);
  }).catch(e => {
    console.error('settings error:', e);
    settingsDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">Failed to compute settings.</div>';
  });
}

async function detectAndShowSettings(filePath) {
  tuningControls.classList.remove('hidden');
  tweaksSection.classList.remove('hidden');
  try {
    const [modelType, meta] = await Promise.all([
      window.api.detectModelType(filePath),
      window.api.getModelMeta(filePath)
    ]);
    currentModelType = modelType;
    currentModelMeta = meta;

    let infoHtml = `<div class="model-info-grid"><div class="model-info-item"><div class="label">Type</div><div class="value">${escapeHtml(modelType.type)}</div></div>`;
    if (meta) {
      Object.entries(meta).forEach(([k, v]) => {
        if (k === 'rawGGUF' || k === 'rawOnnx') return;
        infoHtml += `<div class="model-info-item"><div class="label">${escapeHtml(k)}</div><div class="value">${escapeHtml(String(v))}</div></div>`;
      });
    }
    infoHtml += '</div>';
    modelInfo.innerHTML = infoHtml;
    computeAndRenderSettings();
  } catch (e) {
    console.error('detect error:', e);
    modelInfo.innerHTML = '<div class="empty-state" style="color:var(--danger);">Failed to detect model type.</div>';
  }
}

ollamaBtn.addEventListener('click', async () => {
  try {
    scanStatus.textContent = 'Scanning…';
    const models = await window.api.scanOllamaModels();
    if (!models || models.length === 0) {
      modelListDiv.innerHTML = '<div class="empty-state">No Ollama models found.</div>';
      scanStatus.textContent = 'No Ollama models found';
      return;
    }
    scanStatus.textContent = `${models.length} model(s) found`;
    modelListDiv.innerHTML = models.map(m =>
      `<div class="model-item" data-model="${escapeHtml(m.path)}">${escapeHtml(m.name)}</div>`
    ).join('');
    modelListDiv.querySelectorAll('.model-item').forEach(el => {
      el.addEventListener('click', async () => {
        modelListDiv.querySelectorAll('.model-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        currentModelPath = el.dataset.model;
        await detectAndShowSettings(currentModelPath);
      });
    });
  } catch (e) {
    console.error('ollama scan error:', e);
    modelListDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">Failed to read Ollama models.</div>';
  }
});

const fetchHfBtn = document.getElementById('fetchHfBtn');
const hfStatus = document.getElementById('hfStatus');
const hfResults = document.getElementById('hfResults');

fetchHfBtn.addEventListener('click', async () => {
  fetchHfBtn.disabled = true;
  hfStatus.textContent = '';
  hfResults.innerHTML = '<div class="loading-text"><span class="spinner"></span> Fetching recommendations\u2026</div>';
  try {
    const recs = await window.api.getHfRecommendations(sysInfo);
    let html = '';
    for (const [category, models] of Object.entries(recs)) {
      html += `<div class="rec-category"><h3>${escapeHtml(category)}</h3>`;
      models.forEach(m => {
        const badge = m.pipeline ? ` <span style="font-size:11px;color:var(--text-muted)">[${escapeHtml(m.pipeline)}]</span>` : '';
            html += `<div class="rec-card">
              <strong>${escapeHtml(m.id)}${badge}</strong>
              <div class="desc">${escapeHtml(m.comment || '')}</div>
              <div class="meta">\u2B07 ${(m.downloads || 0).toLocaleString()} \u00B7 \u2665 ${(m.likes || 0).toLocaleString()}</div>
              <div class="rec-actions">
                <button class="btn" data-import-model="${escapeHtml(m.id)}">📥 Import</button>
                <a href="${m.hfUrl}" target="_blank" rel="noopener">Open on HuggingFace \u2197</a>
              </div>
            </div>`;
      });
      html += '</div>';
    }
    hfResults.innerHTML = html;
    hfStatus.textContent = 'Done';
  } catch (e) {
    console.error('HF error:', e);
    hfResults.innerHTML = '<div class="empty-state" style="color:var(--danger);">Error fetching recommendations.</div>';
    hfStatus.textContent = 'Error';
  } finally {
    fetchHfBtn.disabled = false;
  }
});

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

const themeToggle = document.getElementById('themeToggle');
function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme');
  if (current === 'dark') {
    root.removeAttribute('data-theme');
    themeToggle.textContent = '🌙';
  } else {
    root.setAttribute('data-theme', 'dark');
    themeToggle.textContent = '☀️';
  }
}
themeToggle.addEventListener('click', toggleTheme);

(async function initSysInfo() {
  try {
    sysInfo = await window.api.getSystemInfo();
    let html = '';
    const gpu = sysInfo.gpu || [];
    if (gpu.length > 0) {
      gpu.forEach((g, i) => {
        const vram = parseFloat(g.vramGB) || 0;
        const shared = parseFloat(g.vramSharedGB) || 0;
        html += `<div class="sys-item">
          <span class="icon">🎮</span>
          <span class="info">
            <span class="label">GPU ${i + 1}</span>
            <span class="value">${escapeHtml(g.name || 'Unknown')} &mdash; ${vram.toFixed(1)} GB${shared > 0 ? ` (+ ${shared.toFixed(1)} GB shared)` : ''}</span>
          </span>
        </div>`;
      });
    } else {
      html += `<div class="sys-item"><span class="icon">🖥️</span><span class="info"><span class="label">GPU</span><span class="value">No dedicated GPU detected</span></span></div>`;
    }
    if (sysInfo.cpu) {
      html += `<div class="sys-item"><span class="icon">⚙️</span><span class="info"><span class="label">CPU</span><span class="value">${escapeHtml(sysInfo.cpu)}</span></span></div>`;
    }
    if (sysInfo.totalRam) {
      html += `<div class="sys-item"><span class="icon">🧠</span><span class="info"><span class="label">RAM</span><span class="value">${escapeHtml(sysInfo.totalRam)}</span></span></div>`;
    }
    if (sysInfo.os) {
      html += `<div class="sys-item"><span class="icon">💻</span><span class="info"><span class="label">OS</span><span class="value">${escapeHtml(sysInfo.os)}</span></span></div>`;
    }
    sysDetails.innerHTML = html;
    ctxValue.textContent = '8,192';
  } catch (e) {
    console.error('sysinfo error:', e);
    sysDetails.innerHTML = '<div class="empty-state">Failed to read system information.</div>';
  }
})();

selectFolderBtn.addEventListener('click', async () => {
  const folder = await window.api.openDialogForFolder();
  if (!folder) return;
  try {
    modelListDiv.innerHTML = '<div class="loading-text"><span class="spinner"></span> Scanning models\u2026</div>';
    const models = await window.api.scanFolderForModels(folder);
    if (!models || models.length === 0) {
      modelListDiv.innerHTML = '<div class="empty-state">No supported GGUF / ONNX / PyTorch / Safetensors models found.</div>';
      return;
    }
    modelListDiv.innerHTML = models.map(m => {
      let badge = '<span class="badge badge-unknown">?</span>';
      if (m.type === 'gguf') badge = '<span class="badge badge-gguf">GGUF</span>';
      else if (m.type === 'onnx') badge = '<span class="badge badge-onnx">ONNX</span>';
      else if (m.type === 'pytorch') badge = '<span class="badge badge-pytorch">PyTorch</span>';
      else if (m.type === 'safetensors') badge = '<span class="badge badge-hf">Safetensors</span>';
      return `<div class="model-item" data-path="${escapeHtml(m.fullPath)}" data-size="${m.fileSize}">${badge}<span>${escapeHtml(m.name)}</span></div>`;
    }).join('');
    modelListDiv.querySelectorAll('.model-item').forEach(el => {
      el.addEventListener('click', async () => {
        modelListDiv.querySelectorAll('.model-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        currentModelPath = el.dataset.path;
        currentFileSize = parseInt(el.dataset.size) || 0;
        await detectAndShowSettings(currentModelPath);
      });
    });
  } catch (e) {
    console.error('scan error:', e);
    modelListDiv.innerHTML = '<div class="empty-state" style="color:var(--danger);">Error scanning folder.</div>';
  }
});

ctxSlider.addEventListener('input', () => {
  const val = parseInt(ctxSlider.value) || 8192;
  ctxValue.textContent = val.toLocaleString();
  if (currentModelPath && currentModelType) computeAndRenderSettings();
});
