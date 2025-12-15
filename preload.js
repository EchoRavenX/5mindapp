const { contextBridge, ipcRenderer } = require('electron');

/**
 * API exposed to the renderer (loading.html, error.html, main app)
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Tell the main process that the loading page is ready.
   */
  notifyLoadingComplete: () => ipcRenderer.send('loading-complete'),

  /**
   * Listen for "hide-loading" signal from main process.
   * Uses `once` so it only triggers one time (perfect for splash fade-out).
   */
  onHideLoading: (callback) => {
    ipcRenderer.once('hide-loading', () => callback());
  },

  /**
   * Get full error logs + system info (for error.html)
   */
  getErrorLogs: () => ipcRenderer.invoke('get-error-logs'),

  /**
   * Copy text to clipboard (for error.html "Copy All" button)
   */
  copyToClipboard: (text) => navigator.clipboard.writeText(text),

  /**
   * Retry loading main app after offline
   */
  retryOffline: () => ipcRenderer.invoke('retry-offline')
});
