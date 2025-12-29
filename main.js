const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

// Global shared state
const errorLogs = [];
const logPath = path.join(app.getPath('userData'), 'error.log');

let mainWindow = null;
let loadingWindow = null;

// Wayland
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
  app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
}

// Security hardening
app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' https://5mind.com https://*.5mind.com; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://5mind.com https://*.5mind.com; " +
          "style-src 'self' 'unsafe-inline' https://5mind.com https://*.5mind.com; " +
          "img-src 'self' data: https:; " +
          "media-src 'self' blob: https:; " +
          "connect-src 'self' https://5mind.com https://*.5mind.com wss://5mind.com wss://*.5mind.com; " +
          "object-src 'none'; " +
          "frame-src 'self' https://5mind.com https://*.5mind.com; " +
          "base-uri 'self'; " +
          "form-action 'self' https://5mind.com;"
        ]
      }
    });
  });
  const customUserAgent = `5mind/${app.getVersion()} Electron/${process.versions.electron} Chrome/${process.versions.chrome}`;
  ses.setUserAgent(customUserAgent);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = customUserAgent;
    callback({ requestHeaders: details.requestHeaders });
  });
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = webContents.getURL();
    try {
      const parsed = new URL(url);
      const isTrusted = parsed.origin === 'https://5mind.com' || parsed.origin.endsWith('.5mind.com');
      if (!isTrusted) return callback(false);
      if (permission === 'media' || permission === 'notifications' || permission === 'fullscreen') {
        return callback(true);
      }
    } catch {}
    return callback(false);
  });
});

// ========== MULTITHREADED FUNCTION EXECUTOR ==========
ipcMain.handle('run-worker-function', async (event, funcName, codeStr, args) => {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      const fs = require('fs');
      const path = require('path');
      const { app, BrowserWindow } = require('electron');

      const { funcName, codeStr, args, errorLogs, logPath, mainWindowId } = workerData;

      try {
        const factory = eval(codeStr);
        const func = factory();

        let result = null;
        if (funcName === 'logError') {
          result = func(args[0], args[1], errorLogs, logPath);
        } else if (funcName === 'saveWindowState') {
          result = func(args[0]);
        } else if (funcName === 'showErrorPage') {
          if (mainWindowId) {
            const win = BrowserWindow.fromId(mainWindowId);
            result = func(win);
          }
        }

        parentPort.postMessage({ success: true, result });
      } catch (err) {
        parentPort.postMessage({ success: false, error: err.message, stack: err.stack });
      }
    `;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        funcName,
        codeStr,
        args,
        errorLogs,
        logPath,
        mainWindowId: mainWindow ? mainWindow.id : null
      }
    });

    worker.on('message', (msg) => {
      worker.terminate();
      if (msg.success) {
        if (msg.result && msg.result.timestamp) errorLogs.push(msg.result);
        resolve(msg.result);
      } else {
        reject(new Error(msg.error || 'Worker error'));
      }
    });

    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
  });
});

// Offline retry
ipcMain.handle('retry-offline', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    await win.loadURL('https://5mind.com/').catch(() => {
      win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
    });
  }
});

// Get logs
ipcMain.handle('get-error-logs', () => {
  return {
    logs: errorLogs,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    logFile: logPath
  };
});

// Window creation
function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(process.resourcesPath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    },
  });
  win.loadFile(path.join(__dirname, 'loading.html'));
  return win;
}

function createMainWindow() {
  const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
  let savedState = {};
  if (fs.existsSync(STATE_FILE)) {
    try { savedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  const defaultState = { width: 1200, height: 800, x: undefined, y: undefined, isMaximized: false, isFullScreen: false };
  const windowState = { ...defaultState, ...savedState };

  const iconPath = path.join(process.resourcesPath, 'icon-256.png');
  const iconOptions = fs.existsSync(iconPath) ? { icon: iconPath } : {};

  const win = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    backgroundColor: '#ffffff',
    resizable: true,
    show: false,
    ...iconOptions,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(process.resourcesPath, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    },
    ...(process.platform === 'linux' ? { type: 'window', decorations: true } : {}),
  });

  if (windowState.isMaximized) win.maximize();
  if (windowState.isFullScreen) win.setFullScreen(true);

  // Save state — send to renderer to run in worker
  const saveState = () => {
    if (win.isDestroyed()) return;
    const current = {
      x: win.getBounds().x,
      y: win.getBounds().y,
      width: win.getBounds().width,
      height: win.getBounds().height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    };
    const finalState = !win.isMaximized() && !win.isFullScreen() ? { ...windowState, ...current } : { ...windowState, isMaximized: current.isMaximized, isFullScreen: current.isFullScreen };
    Object.assign(windowState, finalState);
    win.webContents.send('run-save-state', finalState);
  };

  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('close', saveState);

  // Security
  win.webContents.on('will-navigate', (e, url) => {
    try {
      const origin = new URL(url).origin;
      if (origin !== 'https://5mind.com' && !origin.endsWith('.5mind.com')) e.preventDefault();
    } catch {}
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (origin !== 'https://5mind.com' && !origin.endsWith('.5mind.com')) return { action: 'deny' };
    } catch {}
    return { action: 'allow' };
  });

  // Load main app
  win.loadURL('https://5mind.com/').catch(async (error) => {
    await win.webContents.executeJavaScript(`window.electronAPI.runInWorker('logError', 'Failed to load main URL', '${error.message.replace(/'/g, "\\'")}')`).catch(() => {});
    win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
  });

  win.setMenuBarVisibility(false);

  // Load failure fallback
  win.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL) => {
    try {
      const parsedUrl = new URL(validatedURL);
      if (parsedUrl.origin === 'https://5mind.com' || parsedUrl.origin.endsWith('.5mind.com')) {
        await win.webContents.executeJavaScript(`window.electronAPI.runInWorker('logError', 'Page load failed: ${validatedURL}', 'Code: ${errorCode}, Desc: ${errorDescription}')`).catch(() => {});
        win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
      }
    } catch {}
  });

  // Renderer crash
  win.webContents.on('crashed', async () => {
    await win.webContents.executeJavaScript(`window.electronAPI.runInWorker('logError', 'Renderer process crashed')`).catch(() => {});
    await win.webContents.executeJavaScript(`window.electronAPI.runInWorker('showErrorPage')`).catch(() => {});
  });

  return win;
}

function hideAndDestroyLoading() {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    try { loadingWindow.webContents.send('hide-loading'); } catch {}
    setTimeout(() => {
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        loadingWindow.destroy();
        loadingWindow = null;
      }
    }, 700);
  }
}

// App lifecycle
app.on('ready', () => {
  console.log('Starting Electron v' + process.versions.electron + ' with Node.js v' + process.version);
  if (mainWindow || BrowserWindow.getAllWindows().length > 0) return;

  loadingWindow = createLoadingWindow();

  ipcMain.removeAllListeners('loading-complete');
  ipcMain.once('loading-complete', () => {
    console.log('Loading screen ready – creating main window');
    if (mainWindow) return;

    mainWindow = createMainWindow();

    const showTimeout = setTimeout(() => {
      console.log('Timeout reached - forcing show');
      hideAndDestroyLoading();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }, 10000);

    mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      hideAndDestroyLoading();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    });

    mainWindow.webContents.once('did-fail-load', () => {
      setTimeout(() => {
        hideAndDestroyLoading();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      }, 500);
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    loadingWindow = createLoadingWindow();
  }
});

// Global error handling
process.on('uncaughtException', async (err) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.webContents.executeJavaScript(`
      window.electronAPI.runInWorker('logError', 'Uncaught Exception', '${(err.stack || err.message).replace(/'/g, "\\'")}')
    `).catch(() => {});
    await mainWindow.webContents.executeJavaScript(`window.electronAPI.runInWorker('showErrorPage')`).catch(() => {});
  }
});

process.on('unhandledRejection', async (reason) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.webContents.executeJavaScript(`
      window.electronAPI.runInWorker('logError', 'Unhandled Rejection', '${String(reason).replace(/'/g, "\\'")}')
    `).catch(() => {});
    await mainWindow.webContents.executeJavaScript(`window.electronAPI.runInWorker('showErrorPage')`).catch(() => {});
  }
});
