import { BrowserWindow, app, screen } from "electron";
import path from "path";

// In CommonJS, __dirname is available natively
declare const __dirname: string;

function resolveIcon(): string | undefined {
  const possibleIconPaths = [
    path.join(app.getAppPath(), "build", "icon.ico"),
    path.join(process.resourcesPath, "icon.ico"),
    path.join(__dirname, "../../build/icon.ico"),
  ];
  return possibleIconPaths.find((p) => {
    try {
      return require("fs").existsSync(p);
    } catch {
      return false;
    }
  });
}

function getAppUrl(hash?: string): string {
  const isPackaged = app.isPackaged;
  const isDev = !isPackaged && process.env.NODE_ENV !== "production";
  if (isDev) {
    return `http://localhost:5173${hash ? `#${hash}` : ""}`;
  }
  return ""; // file loading handled separately
}

function loadWindow(win: BrowserWindow, hash?: string): void {
  const isPackaged = app.isPackaged;
  const isDev = !isPackaged && process.env.NODE_ENV !== "production";
  if (isDev) {
    win.loadURL(getAppUrl(hash));
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "../../dist/index.html");
    win.loadFile(indexPath, hash ? { hash } : undefined);
  }
}

/**
 * Dashboard Window — Normal opaque window for Dashboard & Career Hub.
 * This is the FIRST window the user sees on app launch.
 */
export function createDashboardWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;
  const w = Math.min(1100, screenWidth - 100);
  const h = Math.min(750, screenHeight - 60);

  const dashWindow = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 600,
    minHeight: 500,
    center: true,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: "#0f1117",
    show: false,
    focusable: true,
    icon: resolveIcon(),
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "linux"
        ? false
        : {
            color: "#09090b",
            symbolColor: "#94a3b8",
            height: 36,
          },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dashWindow.once("ready-to-show", () => {
    dashWindow.show();
  });

  dashWindow.on("maximize", () => {
    dashWindow.webContents.send("window:state-changed", { isMaximized: true });
  });

  dashWindow.on("unmaximize", () => {
    dashWindow.webContents.send("window:state-changed", { isMaximized: false });
  });

  loadWindow(dashWindow, "dashboard");

  dashWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      console.error("Dashboard failed to load:", errorCode, errorDescription);
    },
  );

  return dashWindow;
}

/**
 * Overlay Window — Interview Assistant window.
 *
 * macOS / Windows:
 *   Full-screen transparent overlay with click-through (setIgnoreMouseEvents + forward).
 *   The widget floats inside the overlay using CSS positioning.
 *
 * Linux:
 *   Compact, non-transparent, always-on-top window.
 *   The { forward: true } option for setIgnoreMouseEvents is NOT supported on Linux,
 *   making the full-screen overlay approach impossible. Instead, the window matches
 *   the widget bounds and is dynamically resized via IPC as the widget changes.
 */
export function createOverlayWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  const isLinux = process.platform === "linux";
  const isTest = process.env.NODE_ENV === "test";

  const overlayWindow = new BrowserWindow({
    width: isLinux ? 860 : screenWidth,
    height: isLinux ? 48 : screenHeight,
    x: isLinux ? screenWidth - 876 : 0,
    y: isLinux ? 16 : 0,
    frame: false,
    transparent: isLinux ? false : !isTest,
    alwaysOnTop: true,
    skipTaskbar: isLinux ? false : !isTest,
    resizable: isLinux,
    backgroundColor: isLinux ? "#0c0e14" : (isTest ? "#1a1a1a" : "#00000000"),
    show: false,
    focusable: true,
    hasShadow: isLinux,
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Grant media permissions for audio capture
  overlayWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(permission === "media");
    },
  );

  overlayWindow.once("ready-to-show", () => {
    overlayWindow.show();

    if (!isLinux) {
      // macOS/Windows: enable click-through with event forwarding
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    setTimeout(() => {
      if (!overlayWindow.isDestroyed()) {
        overlayWindow.setContentProtection(false);
        overlayWindow.setContentProtection(true);
      }
    }, 100);
  });

  loadWindow(overlayWindow, "interview");

  overlayWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      console.error("Overlay failed to load:", errorCode, errorDescription);
    },
  );

  return overlayWindow;
}

// Keep backward compat — old code calls createMainWindow
export const createMainWindow = createOverlayWindow;
