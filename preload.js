const { contextBridge, ipcRenderer } = require('electron');
const functions = {
  logError: `
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');

    return function(msg, stack = '') {
      const timestamp = new Date().toISOString();
      const entry = { timestamp, msg, stack: stack || '' };
      const logLine = '[' + timestamp + '] ' + msg + '\\n' + (stack || '') + '\\n\\n';
      console.error(logLine);
      const logPath = path.join(app.getPath('userData'), 'error.log');
      try { fs.appendFileSync(logPath, logLine); } catch(e) {}
      return entry;
    };
  `,

  saveWindowState: `
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');

    return function(state) {
      const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
      try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch(e) {}
    };
  `,

  showErrorPage: `
    const path = require('path');
    return function(mainWindow) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(__dirname, 'error.html')).catch(() => {});
      }
    };
  `
};

contextBridge.exposeInMainWorld('electronAPI', {
  notifyLoadingComplete: () => ipcRenderer.send('loading-complete'),
  onHideLoading: (cb) => ipcRenderer.once('hide-loading', () => cb()),
  getErrorLogs: () => ipcRenderer.invoke('get-error-logs'),
  copyToClipboard: (text) => navigator.clipboard.writeText(text),
  retryOffline: () => ipcRenderer.invoke('retry-offline'),

  // Multithreaded call
  runInWorker: async (name, ...args) => {
    const code = functions[name];
    if (!code) throw new Error('Unknown function');
    return ipcRenderer.invoke('worker-exec', code, args);
  }
});
