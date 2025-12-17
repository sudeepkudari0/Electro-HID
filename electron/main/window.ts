import { BrowserWindow, app } from 'electron';
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
        show: false, // Don't show until ready
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // Required for some native modules
        },
    });

    // Use app.isPackaged for more reliable production detection
    const isPackaged = app.isPackaged;
    const isDev = !isPackaged && process.env.NODE_ENV !== 'production';

    console.log('Is Packaged:', isPackaged);
    console.log('Is Dev:', isDev);
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

    // Show window when ready to prevent blank/invisible window
    mainWindow.once('ready-to-show', () => {
        console.log('Window ready to show');
        mainWindow.show();
    });

    // Load the app
    if (isDev) {
        console.log('Loading dev URL: http://localhost:5173');
        mainWindow.loadURL('http://localhost:5173');
        // Open DevTools in development for debugging
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        // In production, the path is relative to the app.asar or app folder
        const indexPath = path.join(__dirname, '../../dist/index.html');
        console.log('Loading production file:', indexPath);
        mainWindow.loadFile(indexPath);

        // For debugging packaged app - remove this after testing
        // Uncomment the next line if you need to debug the packaged app
        // mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // Log when content finishes loading
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Content finished loading');
    });

    // Log any load failures
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.on('closed', () => {
        // Dereference handled by caller
    });

    return mainWindow;
}
