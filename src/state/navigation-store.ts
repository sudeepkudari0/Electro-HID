/**
 * App Navigation Store
 * Controls which module is active: dashboard, interview, or career-hub
 */

import { create } from 'zustand';

export type AppModule = 'dashboard' | 'interview' | 'interview-prep' | 'career-hub' | 'settings';
export type CareerTab = 'jobs' | 'tracking' | 'tailor' | 'search' | 'apply' | 'wellfound';

interface NavigationStore {
  activeModule: AppModule;
  careerTab: CareerTab;

  setActiveModule: (module: AppModule) => void;
  setCareerTab: (tab: CareerTab) => void;
  goHome: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  activeModule: 'dashboard',
  careerTab: 'jobs',

  setActiveModule: (module) => set({ activeModule: module }),
  setCareerTab: (tab) => set({ careerTab: tab }),
  goHome: () => set({ activeModule: 'dashboard' }),
}));
