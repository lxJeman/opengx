const { contextBridge, ipcRenderer } = require('electron');

// Create namespace for our API
const API = {
  // System information
  system: {
    getPlatform: () => ipcRenderer.invoke('system:get-platform'),
    getMemory: () => ipcRenderer.invoke('system:get-memory')
  },

  // File system operations
  fs: {
    readFile: (path) => ipcRenderer.invoke('fs:read-file', path)
  },

  // Persistent storage for bookmarks
  storage: {
    get: (key) => ipcRenderer.invoke('storage:get', key),
    set: (key, value) => ipcRenderer.invoke('storage:set', key, value)
  },

  // Security utilities
  security: {
    validateUrl: (url) => ipcRenderer.invoke('security:validate-url', url)
  },

  // IPC communication
  ipc: {
    send: (channel, data) => {
      // Whitelist channels that are allowed to be sent
      const validChannels = [
        'detach-tab',
        'navigate-to',
        'update-window-tabs',
        'merge-tab',
        'tab-reordered'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel, func) => {
      // Whitelist channels that are allowed to be received
      const validChannels = [
        'merge-tabs',
        'init-detached-tab',
        'update-title',
        'tab-merged',
        'window-focused',
        'detach-tab-error'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    invoke: (channel, ...args) => {
      const validChannels = ['get-window-positions'];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error('Invalid channel'));
    },
    // Remove event listener
    removeListener: (channel, func) => {
      const validChannels = ['merge-tab', 'update-title'];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, func);
      }
    }
  }
};

// Expose protected API to window object
contextBridge.exposeInMainWorld('electronAPI', API);

// Expose a minimal webview API
contextBridge.exposeInMainWorld('webviewAPI', {
  // Add any specific webview-related methods here
  create: (url) => {
    const webview = document.createElement('webview');
    webview.src = url;
    webview.setAttribute('webpreferences', 'contextIsolation');
    return webview;
  }
});