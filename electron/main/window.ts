import { BrowserWindow } from 'electron';
import path from 'path';

// In CommonJS, __dirname is available natively
declare const __dirname: string;

export function createMainWindow(): BrowserWindow {
    const mainWindow = new BrowserWindow({
        width: 700,
        height: 300,
        x: 100,
        y: 100,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // Required for some native modules
        },
    });

    console.log('Preload path:', path.join(__dirname, '../preload/index.cjs'));
    console.log('__dirname:', __dirname);

    // Enable content protection (excludes from screen capture on Windows)
    // mainWindow.setContentProtection(true);

    // Grant media permissions for audio capture
    mainWindow.webContents.session.setPermissionRequestHandler(
        (webContents, permission, callback) => {
            if (permission === 'media') {
                callback(true);
            } else {
                callback(false);
            }
        }
    );

    // Load the app
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // Open DevTools in development for debugging
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        // Dereference handled by caller
    });

    return mainWindow;
}
