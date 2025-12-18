import { BrowserWindow, app, screen } from 'electron';
import path from 'path';

// Overlay dimensions - keep in sync with src/constants/overlay-dimensions.ts
const OVERLAY_WIDTH = 1000;
const OVERLAY_HEIGHT = 80;

// In CommonJS, __dirname is available natively
declare const __dirname: string;

export function createMainWindow(): BrowserWindow {
    // Get primary display dimensions to center the window
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    // Calculate centered x position
    const centeredX = Math.round((screenWidth - OVERLAY_WIDTH) / 2);

    console.log(`Screen width: ${screenWidth}, Overlay width: ${OVERLAY_WIDTH}, Centered X: ${centeredX}`);

    const mainWindow = new BrowserWindow({
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT,
        x: centeredX,
        y: 16,  // Small offset from top
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        backgroundColor: '#00000000',
        show: false,
        focusable: true,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });


    // Use app.isPackaged for more reliable production detection
    const isPackaged = app.isPackaged;
    const isDev = !isPackaged && process.env.NODE_ENV !== 'production';

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
        mainWindow.show();
    });

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // Open DevTools in development for debugging
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        // In production, the path is relative to the app.asar or app folder
        const indexPath = path.join(__dirname, '../../dist/index.html');
        mainWindow.loadFile(indexPath);

        // For debugging packaged app - remove this after testing
        // Uncomment the next line if you need to debug the packaged app
        // mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // Log when content finishes loading (for debugging)
    // mainWindow.webContents.on('did-finish-load', () => {
    //     console.log('Content finished loading');
    // });

    // Log any load failures
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.on('closed', () => {
        // Dereference handled by caller
    });

    return mainWindow;
}
