import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { createDashboardWindow, createOverlayWindow } from "./window";
import { registerIPCHandlers, registerGlobalShortcuts } from "./ipc-handlers";
import path from "path";
import fs from "fs";

function loadEnvFile() {
  const candidates = [
    path.join(app.getAppPath(), ".env"),
    path.join(__dirname, "..", "..", ".env"),
    path.join(process.resourcesPath, ".env"),
  ];

  for (const envPath of candidates) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, "utf-8");
      const lines = content.split(/\r?\n/);
      let loaded = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Strip surrounding quotes
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
          loaded++;
        }
      }
      console.log(`[env] Loaded ${loaded} variables from: ${envPath}`);
      return;
    } catch (err) {
      console.warn(`[env] Failed to read ${envPath}:`, err);
    }
  }
  console.warn("[env] No .env file found in any candidate path");
}
loadEnvFile();

if (process.env.NODE_ENV === "test") {
  // Expose require for Playwright's electronApp.evaluate which lacks require() and import()
  (global as any).__TEST_REQUIRE__ = require;
}

// Enable Web Speech API in Electron
app.commandLine.appendSwitch("enable-speech-dispatcher");

let dashboardWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

import { nlpServerManager } from "./nlp/server-manager";

// Initialize app
app.whenReady().then(() => {
  // Register IPC handlers before creating window
  registerIPCHandlers();

  // Start standalone spaCy NLP server in background
  nlpServerManager.ensureStarted().catch((err) => {
    console.warn("[spaCy] Server startup warning:", err);
  });

  // ── Window switching IPC ──
  ipcMain.handle("window:switch-interview", async () => {
    try {
      // Create overlay if it doesn't exist
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        overlayWindow = createOverlayWindow();
        registerGlobalShortcuts(overlayWindow);
      } else {
        overlayWindow.show();
      }
      // Hide dashboard
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.hide();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("window:switch-dashboard", async () => {
    try {
      // Show or create dashboard
      if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        dashboardWindow = createDashboardWindow();
      } else {
        dashboardWindow.show();
        dashboardWindow.focus();
      }
      // Close overlay
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
        overlayWindow = null;
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Start with Dashboard window
  dashboardWindow = createDashboardWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      dashboardWindow = createDashboardWindow();
    }
  });
});

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
  dashboardWindow = null;
  overlayWindow = null;
});

// Unregister shortcuts on quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Handle app closing — kill background processes
app.on("before-quit", async () => {
  try {
    nlpServerManager.stopServer();
    const { getTranscriber } = await import("./whisper/transcriber");
    const transcriber = getTranscriber();
    await transcriber.dispose();
  } catch {
    // Ignore cleanup errors during shutdown
  }
});
