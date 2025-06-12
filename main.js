const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Enable debugging
process.env.ELECTRON_ENABLE_LOGGING = true;

// Track all browser windows
const browserWindows = new Map();

function createWindow(options = {}) {
  console.log('Creating new window with options:', options);
  const win = new BrowserWindow({
    width: options.width || 1000,
    height: options.height || 700,
    x: options.x,
    y: options.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      // Enable remote debugging
      enableRemoteModule: true
    }
  });

  win.webContents.openDevTools(); // Open DevTools by default
  win.loadFile('index.html');
  
  console.log('New window created with ID:', win.id);
  return win;
}

app.whenReady().then(() => {
  const mainWindow = createWindow();
  browserWindows.set(mainWindow.id, { window: mainWindow, isMain: true });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow();
      browserWindows.set(newWindow.id, { window: newWindow, isMain: true });
    }
  });

  // Listen for window close events to clean up
  app.on('browser-window-closed', (event, window) => {
    browserWindows.delete(window.id);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Track detachments in progress
const detachmentsInProgress = new Set();

// Handle tab detachment
ipcMain.on('detach-tab', (event, { tabId, url, title, bounds }) => {
  console.log('Received detach-tab event:', { tabId, url, title, bounds });
  
  // Prevent duplicate detachments
  if (detachmentsInProgress.has(tabId)) {
    console.log('Detachment already in progress for tab:', tabId);
    return;
  }
  
  try {
    detachmentsInProgress.add(tabId);
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    console.log('Source window ID:', sourceWindow.id);
    
    // Ensure bounds are within screen limits
    const displays = require('electron').screen.getAllDisplays();
    const display = displays.find(d => {
      return bounds.x >= d.bounds.x && bounds.x <= d.bounds.x + d.bounds.width &&
             bounds.y >= d.bounds.y && bounds.y <= d.bounds.y + d.bounds.height;
    }) || displays[0];

    // Adjust bounds to ensure window is visible
    bounds.x = Math.max(display.bounds.x, Math.min(bounds.x, display.bounds.x + display.bounds.width - bounds.width));
    bounds.y = Math.max(display.bounds.y, Math.min(bounds.y, display.bounds.y + display.bounds.height - bounds.height));

    const newWindow = new BrowserWindow({
      ...bounds,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: true
      },
      show: false
    });

    browserWindows.set(newWindow.id, {
      window: newWindow,
      isMain: false,
      sourceWindowId: sourceWindow.id
    });

    // Load the window with a query parameter to indicate we're waiting for a detached tab
    newWindow.loadFile('index.html', {
      query: { 'waitForDetachedTab': 'true' }
    });

    // Wait for window to be ready before sending tab data
    newWindow.webContents.once('did-finish-load', () => {
      newWindow.show();
      newWindow.focus();
      newWindow.webContents.send('init-detached-tab', {
        tabId,
        url,
        title,
        sourceWindowId: sourceWindow.id
      });
    });

    // Handle window close
    newWindow.on('closed', () => {
      browserWindows.delete(newWindow.id);
      detachmentsInProgress.delete(tabId);
    });

    // Also clean up if window fails to load
    newWindow.webContents.on('did-fail-load', () => {
      detachmentsInProgress.delete(tabId);
    });

  } catch (error) {
    console.error('Error during tab detachment:', error);
    // Notify renderer about the error
    event.sender.send('detach-tab-error', {
      error: error.message,
      tabId
    });
  }
});

// Handle tab merging
ipcMain.on('merge-tab', (event, { sourceWindowId, tabId, targetIndex }) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  const sourceWindow = browserWindows.get(sourceWindowId)?.window;

  if (sourceWindow && targetWindow) {
    sourceWindow.webContents.send('transfer-tab', {
      tabId,
      targetWindowId: targetWindow.id,
      targetIndex
    });
  }
});

// Track window positions for merging
ipcMain.on('update-window-tabs', (event, tabsData) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (browserWindows.has(window.id)) {
    browserWindows.get(window.id).tabs = tabsData;
  }
});

// Focus handling
app.on('browser-window-focus', (event, window) => {
  // Notify all windows about focus change
  browserWindows.forEach((data) => {
    if (data.window && !data.window.isDestroyed()) {
      data.window.webContents.send('window-focused', {
        focusedWindowId: window.id
      });
    }
  });
});

// Allow getting window positions for drag preview
ipcMain.handle('get-window-positions', () => {
  const positions = {};
  for (const [windowId, winData] of browserWindows) {
    const win = winData.window;
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    positions[windowId] = { x, y, width, height };
  }
  return positions;
});

// Secure IPC handlers for system operations
ipcMain.handle('system:get-platform', () => {
  return process.platform;
});

ipcMain.handle('system:get-memory', () => {
  return {
    total: require('os').totalmem(),
    free: require('os').freemem()
  };
});

// File system operations with path validation
ipcMain.handle('fs:read-file', async (event, filePath) => {
  try {
    // Validate path is within allowed directories
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(process.cwd())) {
      throw new Error('Access denied: Path outside allowed directory');
    }
    return await require('fs').promises.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

// Bookmark storage operations
ipcMain.handle('storage:get', async (event, key) => {
  try {
    const storePath = path.join(app.getPath('userData'), 'bookmarks.json');
    if (await require('fs').promises.access(storePath).catch(() => false)) {
      const data = await require('fs').promises.readFile(storePath, 'utf8');
      return JSON.parse(data)[key];
    }
    return null;
  } catch (error) {
    console.error('Storage read error:', error);
    return null;
  }
});

ipcMain.handle('storage:set', async (event, key, value) => {
  try {
    const storePath = path.join(app.getPath('userData'), 'bookmarks.json');
    let data = {};
    try {
      const existing = await require('fs').promises.readFile(storePath, 'utf8');
      data = JSON.parse(existing);
    } catch (e) {
      // File doesn't exist yet, use empty object
    }
    data[key] = value;
    await require('fs').promises.writeFile(storePath, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Storage write error:', error);
    return false;
  }
});

// Security-related IPC handlers
ipcMain.handle('security:validate-url', (event, url) => {
  try {
    const parsed = new URL(url);
    return {
      isValid: true,
      protocol: parsed.protocol,
      hostname: parsed.hostname
    };
  } catch {
    return { isValid: false };
  }
});
