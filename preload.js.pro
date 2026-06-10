const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  detectModelType: (path) => ipcRenderer.invoke('detect-model-type', path),
  calcSettings: (sysInfo, modelType) => ipcRenderer.invoke('calc-settings', { sysInfo, modelType }),
  openDialogForFolder: () => ipcRenderer.invoke('open-dialog-for-folder'),
  scanFolderForModels: (folderPath) => ipcRenderer.invoke('scan-folder-for-models', folderPath),
  getOllamaPath: () => ipcRenderer.invoke('get-ollama-path'),
  getModelMeta: (path) => ipcRenderer.invoke('get-model-meta', path),
  scanOllamaModels: () => ipcRenderer.invoke('scan-ollama-models'),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  getHfRecommendations: (sysInfo) => ipcRenderer.invoke('get-hf-recommendations', sysInfo),
  exportConfig: (format, sysInfo, modelType, settings) => ipcRenderer.invoke('export-config', { format, sysInfo, modelType, settings }),
  getBenchmarkData: (sysInfo, modelMeta) => ipcRenderer.invoke('get-benchmark-data', { sysInfo, modelMeta }),
  getCompatibilityMatrix: (sysInfo) => ipcRenderer.invoke('get-compatibility-matrix', sysInfo),
  scanInstalledApps: () => ipcRenderer.invoke('scan-installed-apps'),
  getImportCommand: (modelId, appId) => ipcRenderer.invoke('get-import-command', { modelId, appId })
});
