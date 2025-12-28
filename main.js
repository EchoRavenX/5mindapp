const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const windowStateKeeper = require('electron-window-state');

// ---------- Wayland support ----------
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
  app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
}

// ---------- Global Error Logging ----------
const errorLogs = [];
const logPath = path.join(app.getPath('userData'), 'error.log');
function logError(msg, stack = '') {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, msg, stack: stack || '' };
  errorLogs.push(entry);
  const logLine = `[${timestamp}] ${msg}\n${stack}\n\n`;
  console.error(logLine);
  fs.appendFileSync(logPath, logLine);
}

// Catch unhandled errors
process.on('uncaughtException', (err) => {
  logError('Uncaught Exception', err.stack);
  showErrorPage();
});
process.on('unhandledRejection', (reason) => {
  logError('Unhandled Rejection', reason?.stack || String(reason));
  showErrorPage();
});

// ---------- Permission and Security Hardening ----------
app.whenReady().then(() => {
  const ses = session.defaultSession;
  // Restrictive CSP for loaded remote content
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
  // Set custom User-Agent for the 5mind desktop client
  const customUserAgent = `5mind/${app.getVersion()} Electron/${process.versions.electron} Chrome/${process.versions.chrome}`;
  ses.setUserAgent(customUserAgent);
  // Enforce User-Agent header explicitly as a reliable fallback
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = customUserAgent;
    callback({ requestHeaders: details.requestHeaders });
  });
  // Permission handler: Allow required features only from trusted origin
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = webContents.getURL();
    const parsed = new URL(url);
    const isTrusted = parsed.origin === 'https://5mind.com' || parsed.origin.endsWith('.5mind.com');
    if (!isTrusted) {
      return callback(false);
    }
    // Allow media, notifications, fullscreen; deny others by default
    if (permission === 'media' || permission === 'notifications' || permission === 'fullscreen') {
      return callback(true);
    }
    return callback(false);
  });
});

// ---------- Create the LOADING splash window ----------
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

// ---------- Offline handling ----------
function setupOfflineHandling(win) {
  ipcMain.handle('retry-offline', () => {
    win.loadURL('https://5mind.com/').catch(() => {
      win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
    });
  });
}

// ---------- Create the REAL main window ----------
function createMainWindow() {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  });
  const iconPath = path.join(process.resourcesPath, 'icon-256.png');
  const iconOptions = fs.existsSync(iconPath) ? { icon: iconPath } : {};
  const win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
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
  mainWindowState.manage(win);
  // Prevent navigation to untrusted origins
  win.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'https://5mind.com' && !parsedUrl.origin.endsWith('.5mind.com')) {
      event.preventDefault();
    }
  });
  // Prevent untrusted new windows/popups
  win.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'https://5mind.com' && !parsedUrl.origin.endsWith('.5mind.com')) {
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  // Set up offline handling
  setupOfflineHandling(win);
  // Load main app
  win.loadURL('https://5mind.com/').catch((error) => {
    logError('Failed to load main URL', error.message);
    win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
  });
  win.setMenuBarVisibility(false);
  // Fallback on load failure
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL.startsWith('https://5mind.com')) {
      logError(`Page load failed: ${validatedURL}`, `Code: ${errorCode}, Desc: ${errorDescription}`);
      win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
    }
  });
  // Renderer crash
  win.webContents.on('crashed', () => {
    logError('Renderer process crashed');
    showErrorPage();
  });
  return win;
}

// ---------- Show error.html ----------
let mainWindow = null;
function showErrorPage() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'error.html')).catch(() => {});
  }
}

// ---------- IPC: Send logs to error.html ----------
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

// ---------- App lifecycle ----------
let loadingWindow = null;
app.on('ready', () => {
  console.log('Starting Electron v' + process.versions.electron + ' with Node.js v' + process.version);
  loadingWindow = createLoadingWindow();
  ipcMain.on('loading-complete', () => {
    console.log('Loading screen ready – creating main window');
    mainWindow = createMainWindow();
    const showTimeout = setTimeout(() => {
      console.log('Timeout reached - showing window anyway');
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        try {
          loadingWindow.webContents.send('hide-loading');
        } catch (e) {}
        loadingWindow.destroy();
        loadingWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    }, 10000);
    mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        try {
          loadingWindow.webContents.send('hide-loading');
        } catch (e) {}
      }
      mainWindow.show();
      setTimeout(() => {
        if (loadingWindow && !loadingWindow.isDestroyed()) {
          loadingWindow.destroy();
          loadingWindow = null;
        }
      }, 700);
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
