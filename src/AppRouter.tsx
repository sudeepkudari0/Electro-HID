/**
 * AppRouter — Top-level router for Synapse AI
 * Uses URL hash to determine which module to render.
 * - #dashboard → Dashboard (launcher)
 * - #interview → Interview Assistant (existing App in overlay window)
 * - #career-hub → Career Hub (in dashboard window)
 *
 * The Electron main process loads each window with the appropriate hash.
 * Dashboard module clicks trigger IPC to switch between windows.
 */

import { useEffect, useState } from 'react';
import { useNavigationStore, type AppModule } from './state/navigation-store';
import { Dashboard } from './pages/Dashboard';

import { useJobStore } from './career/state/career-store';
import App from './App';

function getModuleFromHash(): AppModule {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'interview') return 'interview';
  if (hash === 'interview-prep') return 'interview-prep';
  if (hash === 'career-hub') return 'career-hub';
  return 'dashboard';
}

export function AppRouter() {
  const { activeModule, setActiveModule } = useNavigationStore();
  const [initialized, setInitialized] = useState(false);

  // On mount, read the hash set by Electron
  useEffect(() => {
    const fromHash = getModuleFromHash();
    setActiveModule(fromHash);
    setInitialized(true);

    // Load persisted jobs
    (async () => {
      try {
        const result = await (window as any).electronAPI?.careerHub?.loadJobs?.();
        if (result?.success && result.jobs?.length) {
          useJobStore.getState().setJobs(result.jobs);
        }
      } catch {
        // First launch — no saved jobs
      }
    })();
  }, []);

  // When activeModule changes via navigation store (from UI clicks),
  // trigger Electron IPC for module switches that need different windows
  useEffect(() => {
    if (!initialized) return;

    if (activeModule === 'interview') {
      // Tell Electron to open overlay window + hide dashboard
      (window as any).electronAPI?.switchToInterview?.();
    }
    // career-hub stays in the same dashboard window, just update hash
    if (activeModule === 'career-hub') {
      window.location.hash = 'career-hub';
    }
    if (activeModule === 'interview-prep') {
      window.location.hash = 'interview-prep';
    }
    if (activeModule === 'dashboard') {
      window.location.hash = 'dashboard';
    }
  }, [activeModule, initialized]);

  if (!initialized) return null;

  if (activeModule === 'interview') {
    return <App />;
  }

  // Dashboard acts as the Main Shell for 'dashboard', 'career-hub', and 'settings'
  return <Dashboard />;
}
