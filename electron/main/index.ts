import * as electron from 'electron';
import { createMainWindow } from './window';
import { registerIPCHandlers } from './ipc-handlers';

// Enable Web Speech API in Electron (even though we're not using it, good for compatibility)
electron.app.commandLine.appendSwitch('enable-speech-dispatcher');

let mainWindow: electron.BrowserWindow | null = null;

// Initialize app
electron.app.whenReady().then(() => {
    console.log('App is ready, initializing...');

    // Register IPC handlers before creating window
    registerIPCHandlers();

    // Create main window
    mainWindow = createMainWindow();

    console.log('Main window created');

    electron.app.on('activate', () => {
        // On macOS, recreate window when dock icon is clicked
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createMainWindow();
        }
    });
});

// Quit when all windows are closed
electron.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron.app.quit();
    }
    mainWindow = null;
});

// Handle app closing
electron.app.on('before-quit', () => {
    console.log('App is quitting...');
    // Cleanup if needed
});
