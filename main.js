const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const si = require('systeminformation');
const log = require('electron-log');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false
    }
  });
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);

// ---- Helper: read first bytes for magic detection ----
async function readMagicBytes(filePath) {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    await fd.read(buf, 0, 8, 0);
    return buf;
  } finally {
    await fd.close();
  }
}

// ---- Windows WMI GPU info (most reliable on Windows) ----
async function getGpuInfoWmi() {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    const ps = `Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, SharedSystemMemory | ConvertTo-Json`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 10000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        let data = JSON.parse(stdout);
        if (!Array.isArray(data)) data = [data];
        let maxShared = 0;
        for (const g of data) {
          const s = parseFloat(g.SharedSystemMemory) || 0;
          if (s > maxShared) maxShared = s;
        }
        return resolve(data.map(g => ({
          vendor: '',
          model: g.Name || 'Unknown GPU',
          vramGB: g.AdapterRAM ? (g.AdapterRAM / 1073741824).toFixed(2) : '0.00',
          vramSharedGB: (maxShared / 1073741824).toFixed(2)
        })));
      } catch (e) { reject(e); }
    });
  });
}

// ---- nvidia-smi for accurate NVIDIA VRAM ----
async function getNvidiaGpuInfo() {
  const { execFile } = require('child_process');
  try {
    const out = await new Promise((resolve, reject) => {
      execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 5000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
    const lines = out.trim().split('\n').filter(l => l);
    return lines.map(line => {
      const [name, memStr] = line.split(', ');
      return { name: name.trim(), vramMiB: parseFloat(memStr.replace(' MiB', '')) };
    });
  } catch { return null; }
}

// ---- System info (each component fails independently) ----
ipcMain.handle('get-system-info', async () => {
  const result = {};
  try {
    const cpu = await si.cpu();
    result.cpu = {
      brand: cpu.brand,
      cores: cpu.physicalCores || cpu.cores,
      physicalCores: cpu.physicalCores || cpu.cores,
      threads: cpu.cores,
      speedGhz: (cpu.speedMax / 1000).toFixed(2)
    };
  } catch (e) {
    log.error('CPU info error:', e);
    result.cpu = { brand: 'Unknown', cores: 0, physicalCores: 0, threads: 0, speedGhz: '0.00' };
  }

  try {
    const mem = await si.mem();
    result.memory = {
      totalGB: (mem.total / 1024 / 1024 / 1024).toFixed(2),
      usedGB: (mem.used / 1024 / 1024 / 1024).toFixed(2)
    };
  } catch (e) {
    log.error('Memory info error:', e);
    result.memory = { totalGB: '0.00', usedGB: '0.00' };
  }

  try {
    let totalRAM = 0;
    if (result.memory && result.memory.totalGB) totalRAM = parseFloat(result.memory.totalGB) || 0;
    let gpuData = null;
    try { gpuData = await getGpuInfoWmi(); } catch {}
    if (!gpuData || gpuData.length === 0) {
      const graphics = await si.graphics();
      const controllers = graphics.controllers || graphics;
      gpuData = controllers.map(g => ({
        vendor: g.vendor || '',
        model: g.model || 'Unknown GPU',
        vramGB: g.vram ? (g.vram / 1073741824).toFixed(2) : '0.00',
        vramSharedGB: g.vramDynamic ? (g.vramDynamic / 1073741824).toFixed(2) : '0.00'
      }));
    }
    if (gpuData.every(g => parseFloat(g.vramSharedGB) === 0) && totalRAM > 0) {
      const estimatedShared = Math.max(0, Math.round((totalRAM * 0.5) * 100) / 100);
      for (const g of gpuData) {
        g.vramSharedGB = estimatedShared.toFixed(2);
      }
    }
    try {
      const nvidiaGpus = await getNvidiaGpuInfo();
      if (nvidiaGpus && nvidiaGpus.length > 0) {
        let idx = 0;
        for (const gpu of gpuData) {
          if (gpu.model.toLowerCase().includes('nvidia') && idx < nvidiaGpus.length) {
            gpu.model = nvidiaGpus[idx].name;
            gpu.vramGB = (nvidiaGpus[idx].vramMiB / 1024).toFixed(2);
            idx++;
          }
        }
      }
    } catch {}
    result.gpu = gpuData;
  } catch (e) {
    log.error('GPU info error:', e);
    result.gpu = [];
    try { result.gpu = await getGpuInfoWmi(); } catch {}
  }

  try {
    const osInfo = await si.osInfo();
    result.os = `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`;
  } catch (e) {
    log.error('OS info error:', e);
    result.os = 'Unknown';
  }

  return result;
});

// ---- Detect model type by extension + magic bytes ----
ipcMain.handle('detect-model-type', async (event, filePath) => {
  try {
    const magic = await readMagicBytes(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (magic.length >= 4) {
      const ggufMagic = magic.slice(0, 4).toString('hex');
      if (ggufMagic === '47475546') return { type: 'llama.cpp', format: 'GGUF' };
    }
    if (ext === '.gguf') return { type: 'llama.cpp', format: 'GGUF' };
    if (ext === '.onnx') return { type: 'onnx', format: 'ONNX' };
    if (ext === '.pt' || ext === '.pth') return { type: 'pytorch', format: 'PyTorch' };
    if (ext === '.safetensors') return { type: 'hf', format: 'SafeTensors' };
    const ggufMagic2 = magic.slice(0, 4).toString('hex');
    if (ggufMagic2 === '47475546') return { type: 'llama.cpp', format: 'GGUF' };
    return { type: 'unknown', format: ext.slice(1).toUpperCase() || 'BINARY' };
  } catch (e) {
    log.error(`detect-model-type error for ${filePath}:`, e);
    return { type: 'error', format: '' };
  }
});

// ---- Parse GGUF metadata to show what model this is ----
ipcMain.handle('get-model-meta', async (event, filePath) => {
  const result = { name: '?', architecture: '?', parameters: '?', contextLength: 0, blockCount: 0, expertCount: 0, embeddingLength: 0, headCount: 0, headCountKv: 0 };
  try {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const header = Buffer.alloc(24);
      await fd.read(header, 0, 24, 0);
      const magic = header.slice(0, 4).toString('ascii');
      if (magic !== 'GGUF') return result;
      const version = header.readUInt32LE(4);
      const kvCount = Number(header.readBigUInt64LE(16));
      if (kvCount === 0 || kvCount > 500) return result;
      const metaSize = 8192;
      const metaBuf = Buffer.alloc(metaSize);
      const { bytesRead } = await fd.read(metaBuf, 0, metaSize, 24);
      const data = metaBuf.slice(0, bytesRead);
      let off = 0;
      for (let i = 0; i < kvCount; i++) {
        if (off + 8 > data.length) break;
        const keyLen = Number(data.readBigUInt64LE(off)); off += 8;
        if (off + keyLen > data.length) break;
        const key = data.slice(off, off + keyLen).toString('utf8'); off += keyLen;
        if (off + 4 > data.length) break;
        const valType = data.readUInt32LE(off); off += 4;
        function readVal() {
          if (valType === 0 || valType === 1) {
            if (off + 1 > data.length) return null;
            return data.readInt8(off++);
          }
          if (valType === 2 || valType === 3) {
            if (off + 2 > data.length) return null;
            const v = data.readInt16LE(off); off += 2; return v;
          }
          if (valType === 4 || valType === 5) {
            if (off + 4 > data.length) return null;
            const v = data.readInt32LE(off); off += 4; return v;
          }
          if (valType === 6) {
            if (off + 4 > data.length) return null;
            const v = data.readFloatLE(off); off += 4; return v;
          }
          if (valType === 7) {
            if (off + 1 > data.length) return null;
            return data.readUInt8(off++) !== 0;
          }
          if (valType === 8) {
            if (off + 8 > data.length) return null;
            const slen = Number(data.readBigUInt64LE(off)); off += 8;
            if (off + slen > data.length) return null;
            const s = data.slice(off, off + slen).toString('utf8'); off += slen; return s;
          }
          if (valType === 9) {
            if (off + 4 > data.length) return null;
            const arrType = data.readUInt32LE(off); off += 4;
            if (off + 8 > data.length) return null;
            const arrLen = Number(data.readBigUInt64LE(off)); off += 8;
            for (let j = 0; j < Math.min(arrLen, 1000); j++) {
              const val = readVal();
              if (val === null) break;
            }
            return null;
          }
          return null;
        }
        const val = readVal();
        if (val === null) continue;
        if (key === 'general.architecture') result.architecture = val;
        else if (key === 'general.name') result.name = val;
        else if (key === 'general.size_label') result.parameters = val;
        else if (key === 'llama.context_length') result.contextLength = Number(val);
        else if (key === 'llama.block_count') result.blockCount = Number(val);
        else if (key === 'llama.expert_count') result.expertCount = Number(val);
        else if (key === 'llama.embedding_length') result.embeddingLength = Number(val);
        else if (key === 'llama.attention.head_count') result.headCount = Number(val);
        else if (key === 'llama.attention.head_count_kv') result.headCountKv = Number(val);
      }
    } finally {
      await fd.close();
    }
  } catch (e) {
    log.error('GGUF meta read error:', e);
  }
  return result;
});

// ---- Settings calculation ----
ipcMain.handle('calc-settings', async (event, { sysInfo, modelType }) => {
  const settings = {};
  const threads = Math.max(1, sysInfo.cpu.physicalCores || 4);
  const ramGB = parseFloat(sysInfo.memory.totalGB) || 16;
  const vramList = (sysInfo.gpu || []).map(g => parseFloat(g.vramGB) || 0);
  const vramGB = Math.max(0, ...vramList);
  if (modelType.type === 'llama.cpp') {
    settings.llamaCpp = {
      "Context Length": 65009,
      "GPU Offload (n_gpu_layers)": 6,
      "CPU Thread Pool Size": threads > 3 ? 3 : threads,
      "Evaluation Batch Size (n_ubatch)": 64,
      "Physical Batch Size (n_batch)": 512,
      "Max Concurrent Predictions": 1,
      "Unified KV Cache": "On",
      "RoPE Frequency Base": "Auto",
      "RoPE Frequency Scale": "Auto",
      "Offload KV Cache to GPU Memory": "Off",
      "Keep Model in Memory": "On",
      "Try mmap()": "On",
      "Seed": "Random",
      "Number of Experts": 8,
      "Number of Layers (Experimental)": 30,
      "Flash Attention": "On",
      "K Cache Quantization (Experimental)": "Q4_0",
      "V Cache Quantization (Experimental)": "Q4_0"
    };
    settings.ollama = {
      num_thread: threads > 3 ? 3 : threads,
      num_gpu: 1,
      num_ctx: 65009
    };
  }
  if (['pytorch', 'hf', 'safetensors'].includes(modelType.type)) {
    const useGPU = vramGB >= 4;
    settings.hf = {
      device: useGPU ? 'cuda' : 'cpu',
      torch_dtype: useGPU ? 'float16' : 'float32',
      max_memory: {
        ...(useGPU ? { 0: `${Math.floor((vramGB - 2) * 0.9)}GB` } : {}),
        cpu: `${Math.floor((ramGB - 2) * 0.8)}GB`
      }
    };
  }
  if (modelType.type === 'onnx' && vramGB >= 6) {
    settings.trtllm = {
      precision: 'fp16',
      max_batch_size: Math.floor(vramGB * 4),
      max_input_len: 512,
      max_output_len: 128
    };
  }
  return settings;
});

// ---- Open folder dialog ----
ipcMain.handle('open-dialog-for-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ---- Scan folder for model files ----
ipcMain.handle('scan-folder-for-models', async (event, folderPath) => {
  const knownExts = new Set(['.gguf', '.onnx', '.pt', '.pth', '.safetensors', '.bin', '.ggml', '.ggmf', '.ggjt', '.ckpt', '.msgpack']);
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isBlobsDir = dir.endsWith('blobs') || dir.includes('\\blobs\\') || dir.includes('/blobs/');
        if (knownExts.has(ext)) {
          results.push({ fullPath, name: entry.name, relativePath: path.relative(folderPath, fullPath) });
        } else if (!ext || ext === '.') {
          let include = false;
          if (isBlobsDir) { include = true; } else {
            try {
              const magic = await readMagicBytes(fullPath);
              const hex = magic.length >= 4 ? magic.slice(0, 4).toString('hex') : '';
              if (hex === '47475546' || hex === '46544852') include = true;
            } catch {}
          }
          if (!include) {
            try {
              const stat = await fs.promises.stat(fullPath);
              if (stat.size > 50 * 1024 * 1024) include = true;
            } catch {}
          }
          if (include) {
            results.push({ fullPath, name: entry.name, relativePath: path.relative(folderPath, fullPath) });
          }
        }
      }
    }
  }
  await walk(folderPath);
  return results;
});

// ---- Get default Ollama models path ----
ipcMain.handle('get-ollama-path', async () => {
  const dir = await getOllamaDir();
  log.info('Ollama path check:', dir || 'not found');
  return dir;
});

// ---- Scan Ollama manifests and return human-readable model names + blob paths ----
ipcMain.handle('scan-ollama-models', async () => {
  const modelsDir = await getOllamaDir();
  if (!modelsDir) return [];
  const manifestsDir = path.join(modelsDir, 'manifests');
  if (!fs.existsSync(manifestsDir)) return [];
  const results = [];
  async function walk(dir, registry) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, registry ? `${registry}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        const parts = (registry || '').split('/');
        const modelName = parts.length >= 2 ? parts[parts.length - 1] : registry;
        let displayName = registry;
        if (displayName && displayName.startsWith('registry.ollama.ai/')) {
          displayName = displayName.slice('registry.ollama.ai/'.length);
        }
        displayName = displayName ? `${displayName}:${entry.name}` : entry.name;
        try {
          const content = await fs.promises.readFile(fullPath, 'utf8');
          const manifest = JSON.parse(content);
          const layers = manifest.layers || [];
          let modelLayer = null;
          for (const layer of layers) {
            if (layer.mediaType && layer.mediaType.includes('ollama.image')) {
              if (!modelLayer || (layer.size || 0) > (modelLayer.size || 0)) {
                modelLayer = layer;
              }
            }
          }
          const config = manifest.config || {};
          let targetDigest = modelLayer ? modelLayer.digest : null;
          if (targetDigest && targetDigest.startsWith('sha256:')) {
            const hex = targetDigest.slice('sha256:'.length);
            const blobPath = path.join(modelsDir, 'blobs', `sha256-${hex}`);
            if (fs.existsSync(blobPath)) {
              results.push({ name: displayName, fullPath: blobPath, relativePath: displayName, size: modelLayer ? modelLayer.size : 0 });
            }
          }
        } catch {}
      }
    }
  }
  await walk(manifestsDir, '');
  return results;
});

// ---- Internal: find Ollama models directory ----
async function getOllamaDir() {
  const candidates = [
    path.join(process.env.USERPROFILE || process.env.HOME, '.ollama', 'models'),
    path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE, 'ollama', 'models'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'ollama', 'models')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// ---- Get file info (size, dates) ----
ipcMain.handle('get-file-info', async (event, filePath) => {
  try {
    const stat = await fs.promises.stat(filePath);
    return { sizeBytes: stat.size, sizeMB: (stat.size / 1024 / 1024).toFixed(1), sizeGB: (stat.size / 1024 / 1024 / 1024).toFixed(2), modified: stat.mtime, created: stat.birthtime };
  } catch (e) {
    log.error('get-file-info error:', e);
    return null;
  }
});

// ---- Export config profiles ----
ipcMain.handle('export-config', async (event, { format, sysInfo, modelType, settings }) => {
  const threads = Math.max(1, sysInfo.cpu.physicalCores || 4);
  const vramList = (sysInfo.gpu || []).map(g => parseFloat(g.vramGB) || 0);
  const vramGB = Math.max(0, ...vramList);

  if (format === 'llama.cpp-cli') {
    const s = settings.llamaCpp || {};
    const lines = [
      `--ctx-size ${s['Context Length'] || 8192}`,
      `--n-gpu-layers ${s['GPU Offload (n_gpu_layers)'] || 0}`,
      `--threads ${threads}`,
      `--batch-size ${s['Physical Batch Size (n_batch)'] || 512}`,
      `--ubatch-size ${s['Evaluation Batch Size (n_ubatch)'] || 64}`,
      `--flash-attn ${s['Flash Attention'] === 'On' ? 1 : 0}`,
      `--no-mmap ${s['Try mmap()'] === 'Off' ? 1 : 0}`,
      `--mlock ${s['Keep Model in Memory'] === 'On' ? 1 : 0}`,
      `--seed ${s['Seed'] === 'Random' ? -1 : s['Seed']}`
    ];
    return { contentType: 'cli-flags', content: lines.join(' \\\n  ') };
  }

  if (format === 'llama.cpp-config') {
    const s = settings.llamaCpp || {};
    return {
      contentType: 'json',
      content: JSON.stringify({
        "ctx-size": s['Context Length'] || 8192,
        "n-gpu-layers": s['GPU Offload (n_gpu_layers)'] || 0,
        "threads": threads,
        "batch-size": s['Physical Batch Size (n_batch)'] || 512,
        "ubatch-size": s['Evaluation Batch Size (n_ubatch)'] || 64,
        "flash-attn": s['Flash Attention'] === 'On',
        "mlock": s['Keep Model in Memory'] === 'On',
        "no-mmap": s['Try mmap()'] !== 'On',
        "seed": s['Seed'] === 'Random' ? -1 : s['Seed'],
        "cache-type-k": (s['K Cache Quantization'] || 'Q4_0').toLowerCase(),
        "cache-type-v": (s['V Cache Quantization'] || 'Q4_0').toLowerCase()
      }, null, 2)
    };
  }

  if (format === 'ollama-modelfile') {
    const s = settings.ollama || {};
    const modelfile = [
      `PARAMETER num_ctx ${s.num_ctx || 8192}`,
      `PARAMETER num_thread ${s.num_thread || threads}`,
      `PARAMETER num_gpu ${s.num_gpu || 1}`,
      `PARAMETER stop "<\\/s>"`,
      `PARAMETER stop "\\n"`,
      `TEMPLATE """{{ .Prompt }}"""`
    ].join('\n');
    return { contentType: 'modelfile', content: modelfile };
  }

  if (format === 'ollama-api') {
    const s = settings.ollama || {};
    return {
      contentType: 'json',
      content: JSON.stringify({
        model: "{{MODEL_NAME}}",
        prompt: "{{PROMPT}}",
        stream: true,
        options: { num_ctx: s.num_ctx || 8192, num_thread: s.num_thread || threads, num_gpu: s.num_gpu || 1 }
      }, null, 2)
    };
  }

  if (format === 'hf-transformers') {
    const s = settings.hf || {};
    return {
      contentType: 'code',
      content: [
        `from transformers import AutoModelForCausalLM, AutoTokenizer`,
        ``,
        `model = AutoModelForCausalLM.from_pretrained(`,
        `    "{{MODEL_NAME}}",`,
        `    device_map="${s.device || 'auto'}",`,
        `    torch_dtype="${s.torch_dtype || 'auto'}",`,
        `    max_memory=${JSON.stringify(s.max_memory || {})}`,
        `)`,
        `tokenizer = AutoTokenizer.from_pretrained("{{MODEL_NAME}}")`
      ].join('\n')
    };
  }

  return { contentType: 'unknown', content: '' };
});

// ---- Benchmark integration ----
ipcMain.handle('get-benchmark-data', async (event, { sysInfo, modelMeta }) => {
  const vramList = (sysInfo.gpu || []).map(g => {
    const ded = parseFloat(g.vramGB) || 0;
    const shared = parseFloat(g.vramSharedGB) || 0;
    return ded + shared;
  });
  const vramGB = Math.max(0, ...vramList);
  const ramGB = parseFloat(sysInfo.memory.totalGB) || 16;
  const cpuCores = Math.max(1, sysInfo.cpu.physicalCores || 4);
  const cpuSpeed = parseFloat(sysInfo.cpu.speedGhz) || 2.5;

  const isNvidia = (sysInfo.gpu || []).some(g => (g.model || '').toLowerCase().includes('nvidia'));
  const isAmd = (sysInfo.gpu || []).some(g => (g.model || '').toLowerCase().includes('amd') || (g.model || '').toLowerCase().includes('radeon'));
  const isIntel = (sysInfo.gpu || []).some(g => (g.model || '').toLowerCase().includes('intel') || (g.model || '').toLowerCase().includes('arc'));

  const paramsB = modelMeta && modelMeta.parameters ? parseFloat(modelMeta.parameters.replace(/[^0-9.]/g, '')) : 7;
  const paramCount = paramsB > 0 ? paramsB : 7;

  let estimatedTps = 0;
  let prefillTps = 0;
  let memoryBandwidthGbs = 0;

  if (isNvidia) {
    if (vramGB >= 48) { memoryBandwidthGbs = 2000; estimatedTps = paramCount <= 8 ? 180 : paramCount <= 14 ? 110 : paramCount <= 34 ? 55 : 28; }
    else if (vramGB >= 24) { memoryBandwidthGbs = 936; estimatedTps = paramCount <= 8 ? 120 : paramCount <= 14 ? 70 : paramCount <= 34 ? 35 : 18; }
    else if (vramGB >= 12) { memoryBandwidthGbs = 600; estimatedTps = paramCount <= 8 ? 80 : paramCount <= 14 ? 45 : paramCount <= 34 ? 22 : 12; }
    else if (vramGB >= 8) { memoryBandwidthGbs = 320; estimatedTps = paramCount <= 8 ? 45 : paramCount <= 14 ? 25 : paramCount <= 34 ? 12 : 6; }
    else { memoryBandwidthGbs = 200; estimatedTps = paramCount <= 3 ? 30 : paramCount <= 8 ? 18 : 8; }
  } else if (isAmd) {
    if (vramGB >= 24) { memoryBandwidthGbs = 960; estimatedTps = paramCount <= 8 ? 90 : paramCount <= 14 ? 55 : paramCount <= 34 ? 28 : 14; }
    else if (vramGB >= 16) { memoryBandwidthGbs = 576; estimatedTps = paramCount <= 8 ? 65 : paramCount <= 14 ? 38 : paramCount <= 34 ? 18 : 10; }
    else { memoryBandwidthGbs = 288; estimatedTps = paramCount <= 8 ? 40 : paramCount <= 14 ? 22 : 10; }
  } else if (isIntel) {
    memoryBandwidthGbs = 240; estimatedTps = paramCount <= 8 ? 35 : paramCount <= 14 ? 20 : 10;
  } else {
    const cpuScore = cpuCores * cpuSpeed;
    if (cpuScore >= 48) { memoryBandwidthGbs = 80; estimatedTps = paramCount <= 3 ? 25 : paramCount <= 8 ? 12 : 5; }
    else if (cpuScore >= 24) { memoryBandwidthGbs = 50; estimatedTps = paramCount <= 3 ? 18 : paramCount <= 8 ? 8 : 3; }
    else { memoryBandwidthGbs = 30; estimatedTps = paramCount <= 3 ? 10 : paramCount <= 8 ? 5 : 2; }
  }

  prefillTps = Math.round(estimatedTps * 2.5);

  return {
    estimated: {
      tokensPerSecond: Math.round(estimatedTps),
      prefillTokensPerSecond: prefillTps,
      memoryBandwidthGbs: memoryBandwidthGbs,
      paramCount: paramCount,
      gpuVramGb: vramGB,
      systemRamGb: ramGB,
      cpuCores: cpuCores
    },
    references: [
      { hardware: 'RTX 4090 (24GB)', model: 'Llama-3-8B Q4_K_M', tps: 120, source: 'community' },
      { hardware: 'RTX 4090 (24GB)', model: 'Llama-3-70B Q4_K_M', tps: 18, source: 'community' },
      { hardware: 'RTX 3090 (24GB)', model: 'Llama-3-8B Q4_K_M', tps: 85, source: 'community' },
      { hardware: 'RTX 4070 (12GB)', model: 'Llama-3-8B Q4_K_M', tps: 55, source: 'community' },
      { hardware: 'RTX 4060 (8GB)', model: 'Llama-3-8B Q4_K_M', tps: 35, source: 'community' },
      { hardware: 'RTX 3060 (12GB)', model: 'Llama-3-8B Q4_K_M', tps: 30, source: 'community' },
      { hardware: 'Apple M2 Ultra (64GB)', model: 'Llama-3-8B Q4_K_M', tps: 70, source: 'community' },
      { hardware: 'Apple M2 Max (32GB)', model: 'Llama-3-8B Q4_K_M', tps: 50, source: 'community' },
      { hardware: 'Apple M1 (8GB)', model: 'Llama-3-8B Q4_K_M', tps: 20, source: 'community' },
      { hardware: 'AMD RX 7900XTX (24GB)', model: 'Llama-3-8B Q4_K_M', tps: 65, source: 'community' },
      { hardware: 'Intel Arc A770 (16GB)', model: 'Llama-3-8B Q4_K_M', tps: 30, source: 'community' },
      { hardware: 'CPU-only (16C/32T)', model: 'Llama-3-8B Q4_K_M', tps: 8, source: 'community' },
      { hardware: 'CPU-only (8C/16T)', model: 'Llama-3-8B Q4_K_M', tps: 4, source: 'community' }
    ]
  };
});

// ---- Hardware compatibility matrix ----
ipcMain.handle('get-compatibility-matrix', async (event, sysInfo) => {
  const vramList = (sysInfo.gpu || []).map(g => {
    const ded = parseFloat(g.vramGB) || 0;
    const shared = parseFloat(g.vramSharedGB) || 0;
    return ded + shared;
  });
  const vramGB = Math.max(0, ...vramList);
  const ramGB = parseFloat(sysInfo.memory.totalGB) || 16;

  const isNvidia = (sysInfo.gpu || []).some(g => (g.model || '').toLowerCase().includes('nvidia'));
  const isAmd = (sysInfo.gpu || []).some(g => (g.model || '').toLowerCase().includes('amd') || (g.model || '').toLowerCase().includes('radeon'));

  const gpuArch = isNvidia ? 'NVIDIA CUDA' : isAmd ? 'AMD ROCm' : 'CPU (no GPU)';

  const models = [
    ['1-3B (e.g. Phi-3, Gemma-2, Qwen2.5-1.5B)', 0, 2, 4, '✅', '✅', '✅', 'Runs on almost anything, even CPU'],
    ['7-8B (e.g. Llama-3-8B, Mistral, Qwen2.5-7B)', 4, 8, 8, '✅', '✅', '⚠ 16GB+', 'Sweet spot for 8-12GB GPUs'],
    ['12-14B (e.g. Mistral Nemo, Qwen2.5-14B)', 8, 12, 12, '✅', '⚠ 16GB+', '❌', 'Fits 12-16GB GPUs with Q4'],
    ['20-24B (e.g. Gemma-2-27B, Qwen2.5-32B)', 12, 24, 16, '✅', '⚠ 24GB+', '❌', 'Needs 24GB+ for good speed'],
    ['32B-34B (e.g. Qwen2.5-32B, Yi-34B)', 16, 24, 24, '✅', '❌', '❌', '24GB VRAM recommended'],
    ['70-72B (e.g. Llama-3-70B, Qwen2.5-72B)', 24, 48, 32, '✅', '❌', '❌', 'Q4_K_M ~40GB, needs dual GPU or RAM offload'],
    ['120B+ (e.g. Qwen2.5-120B, Command-R+)', 48, 80, 48, '✅', '❌', '❌', 'Multi-GPU or full offload to RAM']
  ];

  const rows = models.map(([name, minVram, recVram, minRam, q4, q8, fp16, notes]) => {
    const canRun = vramGB >= minVram && ramGB >= minRam;
    const recMet = vramGB >= recVram;
    let compat = '❌ No';
    if (canRun && recMet) compat = '✅ Optimal';
    else if (canRun) compat = '⚠️ Runs (limited)';
    return { name, minVram, recVram, minRam, q4, q8, fp16, notes, compat, canRun, recMet };
  });

  return { rows, gpuArch, vramGB, ramGB };
});

// ---- Scan for installed inference apps ----
ipcMain.handle('scan-installed-apps', async () => {
  const apps = [];
  const { execFile } = require('child_process');

  try {
    const out = await new Promise((resolve, reject) => {
      execFile('where', ['ollama'], { timeout: 3000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim().split('\n')[0]);
      });
    });
    const ollamaDir = await getOllamaDir();
    apps.push({ id: 'ollama', name: 'Ollama', path: out, detected: true, modelsPath: ollamaDir || '' });
  } catch {
    const ollamaDir = await getOllamaDir();
    if (ollamaDir) {
      apps.push({ id: 'ollama', name: 'Ollama', path: ollamaDir, detected: true, modelsPath: ollamaDir });
    }
  }

  for (const exe of ['llama-cli.exe', 'llama-server.exe', 'llama-bench.exe', 'main.exe']) {
    try {
      const out = await new Promise((resolve, reject) => {
        execFile('where', [exe], { timeout: 3000 }, (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.trim().split('\n')[0]);
        });
      });
      const dir = path.dirname(out);
      apps.push({ id: 'llamacpp', name: 'llama.cpp', path: dir, detected: true, modelsPath: dir });
      break;
    } catch {}
  }

  const lmPaths = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'LM Studio') : null,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'LM Studio') : null,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'LM Studio') : null,
  ].filter(Boolean);
  for (const p of lmPaths) {
    if (fs.existsSync(p)) {
      apps.push({ id: 'lmstudio', name: 'LM Studio', path: p, detected: true, modelsPath: path.join(p, 'models') });
      break;
    }
  }

  const detectedIds = apps.map(a => a.id);
  if (!detectedIds.includes('ollama')) {
    apps.push({ id: 'ollama', name: 'Ollama (not detected)', path: '', detected: false, modelsPath: '' });
  }
  if (!detectedIds.includes('llamacpp')) {
    apps.push({ id: 'llamacpp', name: 'llama.cpp (not detected)', path: '', detected: false, modelsPath: '' });
  }
  if (!detectedIds.includes('lmstudio')) {
    apps.push({ id: 'lmstudio', name: 'LM Studio (not detected)', path: '', detected: false, modelsPath: '' });
  }
  apps.push({ id: 'hf-cli', name: 'HuggingFace CLI', path: '', detected: false, modelsPath: '' });
  apps.push({ id: 'url', name: 'Direct URL / Manual', path: '', detected: false, modelsPath: '' });

  return apps;
});

// ---- Generate import command for a model + app ----
ipcMain.handle('get-import-command', async (event, { modelId, appId }) => {
  const shortName = modelId.split('/').pop() || modelId;
  const ggufName = shortName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-Q4_K_M.gguf';

  switch (appId) {
    case 'ollama':
      return { command: `ollama pull hf.co/${modelId}`, label: `ollama pull hf.co/${modelId}`, action: 'copy' };
    case 'llamacpp':
      return { command: `wget https://huggingface.co/${modelId}/resolve/main/${ggufName}`, label: `Download GGUF for llama.cpp`, action: 'copy' };
    case 'lmstudio':
      return { command: `https://huggingface.co/${modelId}`, label: `Open in LM Studio Hub`, action: 'open-url' };
    case 'hf-cli':
      return { command: `huggingface-cli download ${modelId}`, label: `huggingface-cli download ${modelId}`, action: 'copy' };
    default:
      return { command: `https://huggingface.co/${modelId}`, label: `Open on HuggingFace`, action: 'open-url' };
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- HuggingFace recommendations ----
ipcMain.handle('get-hf-recommendations', async (event, sysInfo) => {
  const https = require('https');
  function formatModel(m) {
    return {
      id: m.id, downloads: m.downloads || 0, likes: m.likes || 0,
      pipeline: m.pipeline || 'text-generation',
      hfUrl: `https://huggingface.co/${m.id}`
    };
  }
  const ramGB = parseFloat(sysInfo?.memory?.totalGB) || 16;
  const vramList = (sysInfo?.gpu || []).map(g => (parseFloat(g.vramGB) || 0) + (parseFloat(g.vramSharedGB) || 0));
  const vramGB = Math.max(0, ...vramList);
  const totalMem = ramGB + vramGB;
  let performanceTier;
  if (vramGB >= 24 && ramGB >= 32) {
    performanceTier = [
      { id: 'Qwen/Qwen2.5-72B-Instruct', pipeline: 'text-generation', comment: 'Fits 24GB+ VRAM, top benchmarks' },
      { id: 'meta-llama/Llama-3.1-70B-Instruct', pipeline: 'text-generation', comment: 'Strong, needs 24GB+ VRAM' },
      { id: 'Qwen/Qwen2.5-32B-Instruct', pipeline: 'text-generation', comment: 'Great quality for 24GB VRAM' }
    ];
  } else if (vramGB >= 12 && ramGB >= 16) {
    performanceTier = [
      { id: 'Qwen/Qwen2.5-14B-Instruct', pipeline: 'text-generation', comment: 'Best for 12-16GB VRAM' },
      { id: 'mistralai/Mistral-Nemo-Instruct-2407', pipeline: 'text-generation', comment: '12B, fits 12GB VRAM' },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', pipeline: 'text-generation', comment: '8B, runs on 8-12GB VRAM' }
    ];
  } else if (vramGB >= 8) {
    performanceTier = [
      { id: 'meta-llama/Llama-3.1-8B-Instruct', pipeline: 'text-generation', comment: 'Best for 8GB VRAM' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', pipeline: 'text-generation', comment: 'Runs on 8GB VRAM' },
      { id: 'mistralai/Mistral-7B-Instruct-v0.3', pipeline: 'text-generation', comment: 'Lightweight, 7B' }
    ];
  } else {
    performanceTier = [
      { id: 'Qwen/Qwen2.5-1.5B-Instruct', pipeline: 'text-generation', comment: 'CPU or 4GB VRAM' },
      { id: 'microsoft/Phi-3-mini-4k-instruct', pipeline: 'text-generation', comment: '3.8B, runs anywhere' },
      { id: 'google/gemma-2-2b-it', pipeline: 'text-generation', comment: '2B, ultra-lightweight' }
    ];
  }
  const curated = {
    'Best All-Round': [
      { id: 'Qwen/Qwen2-VL-7B-Instruct', pipeline: 'image-text-to-text', comment: 'Vision + tools + reasoning' },
      { id: 'meta-llama/Llama-3.2-11B-Vision-Instruct', pipeline: 'image-text-to-text', comment: 'Vision + function calling' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', pipeline: 'text-generation', comment: 'All-round text + tools' },
      { id: 'NousResearch/Hermes-3-Llama-3.1-8B', pipeline: 'text-generation', comment: 'Top fine-tune, tool use' }
    ],
    'Vision': [
      { id: 'llava-hf/llava-v1.6-mistral-7b-hf', pipeline: 'image-text-to-text', comment: 'Best open vision model' },
      { id: 'Qwen/Qwen2-VL-7B-Instruct', pipeline: 'image-text-to-text', comment: 'Strong vision-language' },
      { id: 'meta-llama/Llama-3.2-11B-Vision-Instruct', pipeline: 'image-text-to-text', comment: 'Llama vision' },
      { id: 'vikhyatk/moondream2', pipeline: 'image-text-to-text', comment: 'Lightweight' }
    ],
    'Tools & Function Calling': [
      { id: 'mistralai/Mistral-Nemo-Instruct-2407', pipeline: 'text-generation', comment: 'Best function calling' },
      { id: 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO', pipeline: 'text-generation', comment: 'Strong tool use' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', pipeline: 'text-generation', comment: 'Built-in tool support' },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', pipeline: 'text-generation', comment: 'Function calling' }
    ],
    'Thinking / Reasoning': [
      { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', pipeline: 'text-generation', comment: 'Best for 8GB VRAM' },
      { id: 'Qwen/QwQ-32B-Preview', pipeline: 'text-generation', comment: 'Strong math reasoning' },
      { id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B', pipeline: 'text-generation', comment: 'Reasoning distilled' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', pipeline: 'text-generation', comment: 'Good chain-of-thought' }
    ],
    'Best Performance': performanceTier
  };
  const results = {};
  for (const [category, fallbackList] of Object.entries(curated)) {
    results[category] = fallbackList.map(m => formatModel(m));
    try {
      const searchQueries = {
        'Best All-Round': 'instruct vision tools',
        'Vision': '',
        'Tools & Function Calling': 'function calling instruct',
        'Thinking / Reasoning': 'reasoning instruct',
        'Best Performance': 'instruct'
      };
      let apiUrl;
      if (category === 'Vision') {
        apiUrl = 'https://huggingface.co/api/models?task=image-text-to-text&sort=downloads&direction=-1&limit=5';
      } else {
        const q = searchQueries[category] || category;
        apiUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=5`;
      }
      const apiData = await new Promise((resolve, reject) => {
        https.get(apiUrl, { timeout: 10000 }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
      });
      const mapped = (apiData || []).filter(m => m && m.id && m.downloads >= 50).map(m => formatModel(m));
      if (mapped.length >= 2) { results[category] = mapped; }
    } catch (e) { log.error(`HF fetch error for ${category}:`, e); }
  }
  return results;
});
