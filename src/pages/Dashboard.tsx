import { useState } from 'react';
import { useNavigationStore, type AppModule } from '../state/navigation-store';
import { CareerHub } from './CareerHub/CareerHub';
import { SettingsPanel } from '../components/SettingsPanel/SettingsPanel';
import { InterviewPrepLanding } from './InterviewPrep/InterviewPrepLanding';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Dashboard() {
  const { activeModule, setActiveModule } = useNavigationStore();
  const [isCollapsed, setIsCollapsed] = useState(false);



  const NAV_ITEMS: { id: AppModule; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Overview', icon: '🏠' },
    { id: 'career-hub', label: 'Career Hub', icon: '💼' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 font-sans overflow-hidden select-none relative">
      {/* Sidebar */}
      <div 
        className={`flex flex-col bg-[#09090b] border-r border-white/5 transition-all duration-300 ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Draggable title bar area in sidebar */}
        <div className="h-9 w-full flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />
        <div className={`mb-10 flex items-center justify-between transition-all duration-300 ${isCollapsed ? 'flex-col gap-4 px-2' : 'px-6'}`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            {!isCollapsed && (
              <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">Synapse AI</h1>
            )}
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex-1 space-y-1.5 transition-all duration-300 ${isCollapsed ? 'px-2' : 'px-4'}`}>
          {!isCollapsed && <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">Menu</div>}
          
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                isCollapsed ? 'justify-center' : ''
              } ${
                activeModule === item.id 
                  ? 'bg-indigo-500/15 text-indigo-300 font-medium' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <span className="text-lg">{item.icon}</span>
              {!isCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          ))}
          
          <div className={isCollapsed ? "mt-4 mb-2" : "mt-8 mb-4"}>
             {!isCollapsed && <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">Tools</div>}
             <button
                onClick={() => setActiveModule('interview-prep')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-300 group ${
                  isCollapsed ? 'justify-center' : ''
                }`}
                title={isCollapsed ? "Interview Prep" : undefined}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">🎙️</span>
                  {!isCollapsed && <span className="text-sm">Interview Prep</span>}
                </div>
                {!isCollapsed && <span className="opacity-0 group-hover:opacity-100 transition-opacity text-indigo-400">↗</span>}
              </button>
          </div>
        </nav>

        <div className="p-4 border-t border-white/5">
          {!isCollapsed ? (
            <div className="text-[11px] text-center text-slate-600 font-medium transition-all duration-300">
              Version 2.0.0
            </div>
          ) : (
            <div className="text-[10px] text-center text-slate-600 font-semibold transition-all duration-300">
              v2.0
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-[#0f1117] rounded-tl-2xl border-t border-l border-white/5 relative overflow-hidden select-text">
        <div className="absolute inset-0 overflow-auto">
          {activeModule === 'dashboard' && <OverviewPanel />}
          {activeModule === 'career-hub' && <CareerHub />}
          {activeModule === 'interview-prep' && <InterviewPrepLanding />}
          {activeModule === 'settings' && (
            <div className="p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
              <SettingsPanel onClose={() => setActiveModule('dashboard')} onSettingsChanged={() => {}} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewPanel() {
  const { setActiveModule } = useNavigationStore();

  return (
    <div className="p-10 max-w-5xl mx-auto animate-in fade-in duration-700">
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-slate-100 tracking-tight mb-2">Welcome Back</h2>
        <p className="text-slate-400">Here's a quick overview of your career workspace.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Career Hub Card */}
        <div 
          onClick={() => setActiveModule('career-hub')}
          className="group cursor-pointer relative overflow-hidden rounded-3xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/10 p-8 hover:border-indigo-500/30 transition-all duration-500 hover:shadow-[0_0_40px_rgba(99,102,241,0.1)]"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
             <span className="text-8xl">💼</span>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-500 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-slate-200 mb-3">Career Hub</h3>
          <p className="text-slate-400 text-sm leading-relaxed mb-6 max-w-[280px]">
            Manage job applications, tailor your resumes with AI, generate cover letters, and track your progress in one place.
          </p>
          <div className="text-indigo-400 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
            Enter Workspace <span>→</span>
          </div>
        </div>

        {/* Interview Practice Card */}
        <div 
          onClick={() => setActiveModule('interview-prep')}
          className="group cursor-pointer relative overflow-hidden rounded-3xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/10 p-8 hover:border-purple-500/30 transition-all duration-500 hover:shadow-[0_0_40px_rgba(168,85,247,0.1)]"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
             <span className="text-8xl">🎙️</span>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center mb-6 shadow-lg shadow-purple-500/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-slate-200 mb-3">Interview Prep</h3>
          <p className="text-slate-400 text-sm leading-relaxed mb-6 max-w-[280px]">
            Review past mock interviews, track your performance scores, and start a new real-time practice session.
          </p>
          <div className="text-purple-400 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
            Open Dashboard <span>→</span>
          </div>
        </div>
      </div>
    </div>
  );
}
