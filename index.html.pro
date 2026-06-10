<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AI Model Tuner PRO</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="watermark"></div>
  <div class="app-header">
    <h1>AI Model Tuner PRO</h1>
    <span class="pill">Windows</span>
    <button class="theme-toggle" id="themeToggle" title="Toggle dark mode">🌙</button>
  </div>

  <div class="card" id="sysInfo">
    <div class="card-title">System Specs</div>
    <div class="sys-grid" id="sysDetails">Loading system information…</div>
  </div>

  <div class="card">
    <div class="card-title">Select Model</div>
    <div class="btn-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <button class="btn" id="selectFolderBtn">📂 Browse Folder…</button>
      <button class="btn" id="ollamaBtn">🦙 Ollama Models</button>
      <span class="scan-status" id="scanStatus"></span>
    </div>
    <div class="model-list" id="modelList"></div>
    <div id="modelInfo" style="margin-top:10px;"></div>
  </div>

  <div class="card hidden" id="tuningControls">
    <div class="card-title">Context Window</div>
    <div class="control-group">
      <div class="label-row"><label for="ctxSlider">Context Length</label><span class="value" id="ctxValue">8,192</span><span class="vram-warning hidden" id="vramWarning">⚠️ VRAM</span></div>
      <input type="range" id="ctxSlider" min="1024" max="262144" value="8192" step="1">
      <div class="ctx-warn-row"><span class="hint">Higher = more tokens remembered, uses more VRAM. All other settings are auto-optimised for your hardware.</span><span class="ctx-vram-est" id="ctxVramEst"></span></div>
    </div>
  </div>

  <div class="card hidden" id="tweaksSection">
    <div class="card-title">Tweaks</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;">
      Override auto-optimised settings to fit a bigger model or squeeze more speed.
    </p>

    <div class="tweak-group">
      <div class="tweak-header">
        <span class="tweak-label">GPU Offload</span>
        <span class="tweak-desc" id="gpuDesc">Auto — optimized for VRAM</span>
      </div>
      <div class="btn-group" data-tweak="gpuLayers">
        <button class="btn-group-btn" data-value="min">Min (save VRAM)</button>
        <button class="btn-group-btn active" data-value="auto">Auto</button>
        <button class="btn-group-btn" data-value="max">Max (faster)</button>
      </div>
      <div class="tweak-note" id="gpuNote">Min keeps model on CPU to save VRAM for other uses. Max offloads everything to GPU.</div>
    </div>

    <div class="tweak-group">
      <div class="tweak-header">
        <span class="tweak-label">Batch Sizes</span>
        <span class="tweak-desc" id="batchDesc">Auto — optimized for VRAM</span>
      </div>
      <div class="btn-group" data-tweak="batch">
        <button class="btn-group-btn" data-value="small">Small (save VRAM)</button>
        <button class="btn-group-btn active" data-value="auto">Auto</button>
        <button class="btn-group-btn" data-value="large">Large (faster)</button>
      </div>
      <div class="tweak-note" id="batchNote">Small batches use less VRAM for big models. Large batches increase throughput.</div>
    </div>

    <div class="tweak-group">
      <div class="tweak-header">
        <span class="tweak-label">KV Cache Precision</span>
        <span class="tweak-desc" id="kvDesc">Q4_0 — best trade-off</span>
      </div>
      <div class="btn-group" data-tweak="kvCache">
        <button class="btn-group-btn" data-value="off">FP16 (quality)</button>
        <button class="btn-group-btn active" data-value="q4_0">Q4_0</button>
        <button class="btn-group-btn" data-value="q8_0">Q8_0</button>
      </div>
      <div class="tweak-note" id="kvNote">Quantising KV cache saves significant VRAM at negligible quality loss.</div>
    </div>

    <div class="tweak-group">
      <div class="tweak-header">
        <span class="tweak-label">Flash Attention</span>
        <span class="tweak-desc" id="flashDesc">On — faster inference</span>
      </div>
      <div class="btn-group" data-tweak="flashAttn">
        <button class="btn-group-btn active" data-value="on">On</button>
        <button class="btn-group-btn" data-value="off">Off</button>
      </div>
      <div class="tweak-note" id="flashNote">Flash attention speeds up inference on compatible GPUs. Turn off if unstable.</div>
    </div>
  </div>

  <div class="card hidden" id="resourceCard">
    <div class="card-title">Resource Allocation</div>
    <div id="resourceContent">
      <table class="alloc-table" id="allocTable">
        <thead><tr><th>Setting</th><th>Consumes</th><th>Resource</th></tr></thead>
        <tbody id="allocBody"></tbody>
      </table>
      <details class="pool-details" id="poolDetails">
        <summary class="pool-summary">Memory Pool <span class="pool-badge" id="poolBadge"></span></summary>
        <div class="pool-grid" id="poolGrid"></div>
      </details>
      <div class="vram-section">
        <div class="res-row"><span class="res-label">KV Cache</span><span class="res-value" id="resKvCache">—</span></div>
        <div class="res-row"><span class="res-label">Weights on GPU</span><span class="res-value" id="resWeights">—</span></div>
        <div class="res-row" style="border-bottom:none;"><span class="res-label">Total VRAM Needed</span><span class="res-value" id="resTotalVram">—</span></div>
        <div class="res-util-bar"><div class="res-util-fill" id="resUtilFill" style="width:0%"></div></div>
        <div class="res-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px;">
          <span class="res-label">Available VRAM</span>
          <span class="res-value" id="resAvailableVram">—</span>
        </div>
        <div class="res-row">
          <span class="res-label">CPU RAM (for CPU layers)</span>
          <span class="res-value" id="resCpuRam">—</span>
        </div>
        <div class="res-note" id="resNote"></div>
      </div>
    </div>
  </div>

  <div class="card" id="settingsOutput">
    <div class="card-title">Recommended Settings</div>
    <div id="settings"></div>
  </div>

  <!-- Export Profiles -->
  <div class="card hidden" id="exportCard">
    <div class="card-title">Export Profiles</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Generate ready-to-use config files for your inference engine.</p>
    <div class="export-grid" id="exportGrid">
      <div class="export-card" data-export="llama.cpp-config">
        <div class="export-icon">🦙</div>
        <div class="export-info">
          <div class="export-name">llama.cpp JSON Config</div>
          <div class="export-desc">Server-mode config file (.json)</div>
        </div>
        <button class="btn btn-export">📋 Copy</button>
      </div>
      <div class="export-card" data-export="llama.cpp-cli">
        <div class="export-icon">⚡</div>
        <div class="export-info">
          <div class="export-name">llama.cpp CLI Flags</div>
          <div class="export-desc">Command-line arguments</div>
        </div>
        <button class="btn btn-export">📋 Copy</button>
      </div>
      <div class="export-card" data-export="ollama-api">
        <div class="export-icon">🦙</div>
        <div class="export-info">
          <div class="export-name">Ollama API JSON</div>
          <div class="export-desc">REST API request body</div>
        </div>
        <button class="btn btn-export">📋 Copy</button>
      </div>
      <div class="export-card" data-export="ollama-modelfile">
        <div class="export-icon">📄</div>
        <div class="export-info">
          <div class="export-name">Ollama Modelfile</div>
          <div class="export-desc">Modelfile parameters</div>
        </div>
        <button class="btn btn-export">📋 Copy</button>
      </div>
      <div class="export-card" data-export="hf-transformers">
        <div class="export-icon">🤗</div>
        <div class="export-info">
          <div class="export-name">HF Transformers</div>
          <div class="export-desc">Python loading script</div>
        </div>
        <button class="btn btn-export">📋 Copy</button>
      </div>
    </div>
    <div class="export-output hidden" id="exportOutput">
      <div class="export-output-header">
        <span id="exportOutputLabel">Config</span>
        <button class="btn-icon" id="exportCopyBtn" title="Copy to clipboard">📋</button>
      </div>
      <pre id="exportOutputPre"></pre>
    </div>
  </div>

  <!-- Benchmark Integration -->
  <div class="card hidden" id="benchmarkCard">
    <div class="card-title">Estimated Performance</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Predicted inference speed based on your hardware and model size.</p>
    <div id="benchmarkContent">
      <div class="bench-summary" id="benchSummary"></div>
      <table class="bench-table" id="benchTable">
        <thead><tr><th>Metric</th><th>Estimated</th></tr></thead>
        <tbody id="benchBody"></tbody>
      </table>
      <details class="bench-refs">
        <summary>Reference Benchmarks (community)</summary>
        <div id="benchRefsBody"></div>
      </details>
    </div>
  </div>

  <!-- Hardware Compatibility Matrix -->
  <div class="card hidden" id="compatCard">
    <div class="card-title">Hardware Compatibility Matrix</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">See which model sizes work with your hardware at a glance.</p>
    <div id="compatContent">
      <div class="compat-specs" id="compatSpecs"></div>
      <div class="compat-table-wrap">
        <table class="compat-table" id="compatTable">
          <thead>
            <tr>
              <th>Model Size</th>
              <th>Min VRAM</th>
              <th>Rec. VRAM</th>
              <th>Q4_K_M</th>
              <th>Q8_0</th>
              <th>FP16</th>
              <th>Your Hardware</th>
            </tr>
          </thead>
          <tbody id="compatBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="card" id="hfSection">
    <div class="card-title">HuggingFace Recommendations</div>
    <div class="btn-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <button class="btn" id="fetchHfBtn">🤗 Fetch Recommendations</button>
      <select class="import-select" id="importBackend">
        <option value="" disabled>Detecting installed apps…</option>
      </select>
      <span class="app-badge" id="appBadge"></span>
      <span class="scan-status" id="hfStatus"></span>
    </div>
    <div class="app-prompt" id="appPrompt"></div>
    <div id="hfResults" style="margin-top:12px;"></div>
  </div>

  <div style="font-size:11px;color:var(--text-muted);text-align:center;padding:16px 0;border-top:1px solid var(--border);margin-top:8px;">
    AI Model Tuner PRO &mdash; Only the context slider is adjustable; all other settings are auto-optimised for your hardware. &middot; Ctrl+O &middot; Ctrl+R &middot; Ctrl+D<br><span style="font-weight:500;">Made by Heine Bræck</span>
  </div>

  <script src="./renderer.js"></script>
</body>
</html>
