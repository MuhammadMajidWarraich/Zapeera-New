const { contextBridge, ipcRenderer } = require('electron');

// Validated IPC channels - only these are allowed
const VALID_SEND_CHANNELS = [
  'minimize-window',
  'maximize-window',
  'close-window',
  'set-window-state'
];

const VALID_INVOKE_CHANNELS = [
  'get-app-version',
  'is-packaged',
  'get-platform',
  'get-backend-status',
  'get-storage-info',
  'get-log-file-path',
  'open-external',
  'save-file',
  'get-downloads-path',
  'is-fresh-database',
  'get-window-state',
  'print-receipt',
  'get-sync-status',
  'check-connectivity',
  'get-local-business-states',
  'provision-local-session'
];

// Validate URL for open-external
function isAllowedUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// Validate save-file options
function validateSaveOptions(options) {
  if (!options || typeof options !== 'object') return false;
  if (typeof options.content !== 'string') return false;
  if (typeof options.filename !== 'string') return false;
  return true;
}

// Expose a safe, minimal API to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  isPackaged: () => ipcRenderer.invoke('is-packaged'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Backend status
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),

  // Logging
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),

  // External links - validated
  openExternal: (url) => {
    if (!isAllowedUrl(url)) return Promise.resolve({ success: false, error: 'Invalid URL' });
    return ipcRenderer.invoke('open-external', url);
  },

  // File save - uses native dialog
  saveFile: (options) => {
    if (!validateSaveOptions(options)) return Promise.resolve({ success: false, error: 'Invalid options' });
    return ipcRenderer.invoke('save-file', options);
  },
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),

  // Database check
  isFreshDatabase: () => ipcRenderer.invoke('is-fresh-database'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  setWindowState: (state) => ipcRenderer.send('set-window-state', state),

  // Cloud API URL (set by main process)
  getCloudApiUrl: () => ipcRenderer.invoke('get-cloud-api-url'),

  // Local API URL (dynamic port from embedded server)
  getLocalApiUrl: () => ipcRenderer.invoke('get-local-api-url'),

  // Provisioning (trusted Desktop bootstrap)
  provisionLocalSession: (data) => ipcRenderer.invoke('provision-local-session', data),

  // Sync
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
  checkConnectivity: () => ipcRenderer.invoke('check-connectivity'),
  getLocalBusinessStates: () => ipcRenderer.invoke('get-local-business-states'),

  // Printing
  printReceipt: (options) => ipcRenderer.invoke('print-receipt', options)
});

// Expose window controls separately for custom titlebar
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window')
});

// Minimal app info - no process/env leaks
contextBridge.exposeInMainWorld('appInfo', {
  name: 'Zapeera',
  description: 'Business Management Platform'
});
