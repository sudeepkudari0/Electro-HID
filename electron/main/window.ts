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
      process.platform === "darwin"
        ? {
            color: "#0f1117",
            symbolColor: "#94a3b8",
            height: 36,
          }
        : false,
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
 * Overlay Window — Full-screen transparent overlay for Interview Assistant.
 * Created ONLY when the user selects Interview Assistant from the Dashboard.
 */
export function createOverlayWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  const overlayWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    x: 0,
    y: 0,
    frame: false,
    transparent: process.env.NODE_ENV !== "test",
    alwaysOnTop: true,
    skipTaskbar: process.env.NODE_ENV !== "test",
    resizable: false,
    backgroundColor: process.env.NODE_ENV === "test" ? "#1a1a1a" : "#00000000",
    show: false,
    focusable: true,
    hasShadow: false,
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
    // Enable click-through — transparent areas pass clicks to underlying apps
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

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
