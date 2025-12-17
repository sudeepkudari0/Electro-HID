import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIPCHandlers } from './ipc-handlers';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Enable Web Speech API in Electron (even though we're not using it, good for compatibility)
app.commandLine.appendSwitch('enable-speech-dispatcher');

let mainWindow: BrowserWindow | null = null;

// Initialize app
app.whenReady().then(() => {
    console.log('App is ready, initializing...');

    // Register IPC handlers before creating window
    registerIPCHandlers();

    // Create main window
    mainWindow = createMainWindow();

    console.log('Main window created');

    app.on('activate', () => {
        // On macOS, recreate window when dock icon is clicked
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createMainWindow();
        }
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
    mainWindow = null;
});

// Handle app closing
app.on('before-quit', () => {
    console.log('App is quitting...');
    // Cleanup if needed;
});
