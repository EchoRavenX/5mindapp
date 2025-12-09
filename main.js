// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
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

// ---------- Create the LOADING splash window ----------
function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'loading.html'));
  return win;
}

// ---------- Create the REAL main window ----------
function createMainWindow() {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  const iconPath = path.join(__dirname, 'icon-256.png');
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
      preload: path.join(__dirname, 'preload.js'),
    },
    ...(process.platform === 'linux' ? { type: 'window', decorations: true } : {}),
  });

  mainWindowState.manage(win);

  // Load main app
  win.loadURL('https://5mind.com/').catch((error) => {
    logError('Failed to load main URL', error.message);
    win.loadFile(path.join(__dirname, 'error.html')).catch(() => {});
  });

  win.setMenuBarVisibility(false);

  // Fallback on load failure
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logError(`Page load failed: ${validatedURL}`, `Code: ${errorCode}, Desc: ${errorDescription}`);
    win.loadFile(path.join(__dirname, 'error.html')).catch(() => {});
  });

  // Renderer crash
  win.webContents.on('crashed', () => {
    logError('Renderer process crashed');
    showErrorPage();
  });

  return win;
}

// ---------- Show error.html ----------
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
let mainWindow = null;

app.on('ready', () => {
  console.log('Starting Electron v' + process.versions.electron + ' with Node.js v' + process.version);
  loadingWindow = createLoadingWindow();

  ipcMain.on('loading-complete', () => {
    console.log('Loading screen ready – creating main window');
    mainWindow = createMainWindow();

    mainWindow.once('ready-to-show', () => {
      // Fade out loading
      loadingWindow.webContents.send('hide-loading');

      // Show main app
      mainWindow.show();

      // Destroy splash
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