const { contextBridge, ipcRenderer } = require('electron');

// 1. logError function 
const logErrorCode = `
  const fs = require('fs');
  const path = require('path');
  const { app } = require('electron');
  const os = require('os');

  return function logError(msg, stack = '', errorLogs, logPath) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, msg, stack: stack || '' };
    errorLogs.push(entry);
    const logLine = '[${timestamp}] ${msg}\\n${stack || ''}\\n\\n';
    console.error(logLine);
    try {
      fs.appendFileSync(logPath, logLine);
    } catch (e) {}
    return entry;
  };
`;

// 2. saveWindowState function 
const saveWindowStateCode = `
  const fs = require('fs');
  const path = require('path');
  const { app } = require('electron');

  return function saveWindowState(windowState) {
    const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(windowState));
    } catch (e) {}
  };
`;

// 3. showErrorPage trigger 
const showErrorPageCode = `
  return function showErrorPage(mainWindow) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'error.html')).catch(() => {});
    }
  };
`;

// Expose unified API
contextBridge.exposeInMainWorld('electronAPI', {
  notifyLoadingComplete: () => ipcRenderer.send('loading-complete'),

  onHideLoading: (callback) => {
    ipcRenderer.once('hide-loading', () => callback());
  },

  // Multithreaded remote execution
  runInWorker: async (funcName, ...args) => {
    let code;
    if (funcName === 'logError') code = logErrorCode;
    if (funcName === 'saveWindowState') code = saveWindowStateCode;
    if (funcName === 'showErrorPage') code = showErrorPageCode;

    if (!code) return;

    return ipcRenderer.invoke('run-worker-function', funcName, code, args);
  },

  getErrorLogs: () => ipcRenderer.invoke('get-error-logs'),

  copyToClipboard: (text) => navigator.clipboard.writeText(text),

  retryOffline: () => ipcRenderer.invoke('retry-offline')
});
