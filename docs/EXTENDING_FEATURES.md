# Adding Node.js Features Securely

This document explains how to safely add new Node.js features to the Electron application while maintaining security best practices.

## Architecture Overview

The application uses a secure three-layer architecture:

1. **Main Process** (`main.js`): Has full Node.js access
2. **Preload Script** (`preload.js`): Exposes safe APIs via contextBridge
3. **Renderer Process** (web content): No direct Node.js access

## Adding New Features

### 1. Define IPC Handlers in main.js

First, add your IPC handlers in `main.js`. Always validate inputs and handle errors:

```javascript
// Example: Adding file system watcher
const { watch } = require('fs');

ipcMain.handle('fs:watch-directory', async (event, dirPath) => {
  try {
    // Validate path is within allowed directories
    const normalizedPath = path.normalize(dirPath);
    if (!normalizedPath.startsWith(process.cwd())) {
      throw new Error('Access denied: Path outside allowed directory');
    }

    // Set up watcher
    const watcher = watch(normalizedPath, (eventType, filename) => {
      // Send updates to renderer
      event.sender.send('fs:file-changed', { eventType, filename });
    });

    return true;
  } catch (error) {
    throw new Error(`Failed to watch directory: ${error.message}`);
  }
});
```

### 2. Expose API in preload.js

Add your feature to the appropriate namespace in `preload.js`:

```javascript
const API = {
  // Existing namespaces...

  // Add new namespace or extend existing one
  fs: {
    // Existing methods...
    watchDirectory: (path) => ipcRenderer.invoke('fs:watch-directory', path),
    onFileChanged: (callback) => {
      const validatedCallback = (event, data) => callback(data);
      ipcRenderer.on('fs:file-changed', validatedCallback);
      return () => {
        ipcRenderer.removeListener('fs:file-changed', validatedCallback);
      };
    }
  }
};

contextBridge.exposeInMainWorld('electronAPI', API);
```

### 3. Use in Renderer Process

Access the feature through the exposed API in your renderer code:

```javascript
// Example usage in renderer process
const watchDir = async (path) => {
  try {
    await window.electronAPI.fs.watchDirectory(path);
    window.electronAPI.fs.onFileChanged(({ eventType, filename }) => {
      console.log(`File ${filename} ${eventType}`);
    });
  } catch (error) {
    console.error('Failed to watch directory:', error);
  }
};
```

## Security Best Practices

1. **Input Validation**
   - Always validate inputs in the main process
   - Normalize and check file paths
   - Validate data types and formats

2. **IPC Channel Naming**
   - Use namespaced channel names (e.g., 'fs:watch-directory')
   - Add new channels to the whitelist in preload.js

3. **Error Handling**
   - Catch and handle errors in both main and renderer processes
   - Return meaningful error messages
   - Don't expose sensitive system information in errors

4. **Permissions**
   - Only expose necessary functionality
   - Use principle of least privilege
   - Consider adding permission checks for sensitive operations

## Adding New Node.js Modules

When adding new Node.js modules:

1. Install the module:
```bash
npm install your-module --save
```

2. Create a secure wrapper in main process:
```javascript
// main.js
const yourModule = require('your-module');

ipcMain.handle('module:operation', async (event, ...args) => {
  // Validate args
  // Perform operation securely
  // Return safe result
});
```

3. Expose via preload:
```javascript
// preload.js
module: {
  operation: (...args) => ipcRenderer.invoke('module:operation', ...args)
}
```

## Organizing Features

Group related features into namespaces:

- `system`: OS-related operations
- `fs`: File system operations
- `net`: Network operations
- `security`: Security-related utilities
- `storage`: Data persistence
- etc.

## Testing New Features

1. Test input validation
2. Test error handling
3. Test edge cases
4. Verify security constraints
5. Test in both development and packaged modes

## Example: Adding System Information Features

Here's a complete example adding CPU usage monitoring:

```javascript
// main.js
const os = require('os');
let cpuInterval;

ipcMain.handle('system:start-cpu-monitor', (event, intervalMs) => {
  // Validate interval
  const safeInterval = Math.max(1000, Math.min(intervalMs, 10000));
  
  cpuInterval = setInterval(() => {
    const cpus = os.cpus().map(cpu => ({
      user: cpu.times.user,
      system: cpu.times.system,
      idle: cpu.times.idle
    }));
    
    event.sender.send('system:cpu-update', cpus);
  }, safeInterval);
  
  return true;
});

ipcMain.handle('system:stop-cpu-monitor', () => {
  if (cpuInterval) {
    clearInterval(cpuInterval);
    cpuInterval = null;
  }
  return true;
});

// preload.js
system: {
  // Existing methods...
  startCpuMonitor: (interval) => ipcRenderer.invoke('system:start-cpu-monitor', interval),
  stopCpuMonitor: () => ipcRenderer.invoke('system:stop-cpu-monitor'),
  onCpuUpdate: (callback) => {
    const validatedCallback = (event, data) => callback(data);
    ipcRenderer.on('system:cpu-update', validatedCallback);
    return () => {
      ipcRenderer.removeListener('system:cpu-update', validatedCallback);
    };
  }
}
```

Remember to always consider security implications when adding new features and follow the principle of least privilege.
