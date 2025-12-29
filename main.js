const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

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
    const parsed = new URL(url);
    const isTrusted = parsed.origin === 'https://5mind.com' || parsed.origin.endsWith('.5mind.com');
    if (!isTrusted) return callback(false);
    if (permission === 'media' || permission === 'notifications' || permission === 'fullscreen') {
      return callback(true);
    }
    return callback(false);
  });
});

// ---------- Offline handling (registered ONCE) ----------
ipcMain.handle('retry-offline', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    await win.loadURL('https://5mind.com/').catch(() => {
      win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
    });
  }
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

// ---------- Create the REAL main window ----------
function createMainWindow() {
  // Custom window state persistence (no external deps)
  const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
  let savedState = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      savedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      // Corrupted? Ignore and use defaults
    }
  }
  const defaultState = {
    width: 1200,
    height: 800,
    x: undefined,
    y: undefined,
    isMaximized: false,
    isFullScreen: false
  };
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
  // Restore maximized/fullscreen
  if (windowState.isMaximized) win.maximize();
  if (windowState.isFullScreen) win.setFullScreen(true);
  // Save state on changes
  const saveState = () => {
    if (win.isDestroyed()) return;
    const currentState = {
      x: win.getBounds().x,
      y: win.getBounds().y,
      width: win.getBounds().width,
      height: win.getBounds().height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    };
    // Only save position/size when not maximized/fullscreen
    if (!win.isMaximized() && !win.isFullScreen()) {
      Object.assign(windowState, currentState);
    } else {
      windowState.isMaximized = currentState.isMaximized;
      windowState.isFullScreen = currentState.isFullScreen;
    }
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(windowState));
    } catch (e) {
      // Ignore write errors
    }
  };
  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('close', saveState);
  // Navigation security
  win.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'https://5mind.com' && !parsedUrl.origin.endsWith('.5mind.com')) {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'https://5mind.com' && !parsedUrl.origin.endsWith('.5mind.com')) {
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  // Load main app
  win.loadURL('https://5mind.com/').catch((error) => {
    logError('Failed to load main URL', error.message);
    win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
  });
  win.setMenuBarVisibility(false);
  // Load failure fallback
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    try {
      const parsedUrl = new URL(validatedURL);
      const origin = parsedUrl.origin;
      if (origin === 'https://5mind.com' || origin.endsWith('.5mind.com')) {
        logError(`Page load failed: ${validatedURL}`, `Code: ${errorCode}, Desc: ${errorDescription}`);
        win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
      }
    } catch {
      // Invalid URL — ignore
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

// ---------- Helper to hide loading and destroy it ----------
function hideAndDestroyLoading() {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    try {
      loadingWindow.webContents.send('hide-loading');
    } catch (e) {}
    setTimeout(() => {
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        loadingWindow.destroy();
        loadingWindow = null;
      }
    }, 700);
  }
}

// ---------- App lifecycle ----------
let loadingWindow = null;
app.on('ready', () => {
  console.log('Starting Electron v' + process.versions.electron + ' with Node.js v' + process.version);

  // Prevent double creation
  if (mainWindow || BrowserWindow.getAllWindows().length > 0) {
    return;
  }

  loadingWindow = createLoadingWindow();

  ipcMain.removeAllListeners('loading-complete');
  ipcMain.once('loading-complete', () => {
    console.log('Loading screen ready – creating main window');

    if (mainWindow) return;  // Prevent duplicates

    mainWindow = createMainWindow();

    const showTimeout = setTimeout(() => {
      console.log('Timeout reached - forcing show');
      hideAndDestroyLoading();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    }, 10000);

    mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      hideAndDestroyLoading();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });

    // Extra safety for offline: force show if load fails
    mainWindow.webContents.once('did-fail-load', () => {
      setTimeout(() => {
        hideAndDestroyLoading();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        }
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
