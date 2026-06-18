import { useEffect, useState } from 'react';
import { useNavigationStore } from '../../state/navigation-store';

interface SessionSummary {
  id: string;
  startTime: string;
  duration: number;
  interviewType: string;
  questionCount: number;
  tags?: string[];
}

export function InterviewPrepLanding() {
  const { setActiveModule } = useNavigationStore();

  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSessions() {
      try {
        if (window.electronAPI?.session?.list) {
          const result = await window.electronAPI.session.list();
          if (result.success && result.sessions) {
            setRecentSessions(result.sessions);
          }
        }
      } catch (error) {
        console.error("Failed to load sessions:", error);
      } finally {
        setLoading(false);
      }
    }
    loadSessions();
  }, []);

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0 mins';
    const mins = Math.max(1, Math.round(seconds / 60));
    return `${mins} mins`;
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return 'Unknown Date';
    const date = new Date(isoString);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    
    if (isToday) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="p-10 max-w-6xl mx-auto animate-in fade-in duration-700 min-h-screen text-slate-200">
      
      {/* Header Section */}
      <div className="flex items-center justify-between mb-12">
        <div>
          <h2 className="text-4xl font-extrabold text-white tracking-tight mb-3">Interview Prep</h2>
          <p className="text-slate-400 text-lg">Master your delivery, get real-time feedback, and ace your next interview.</p>
        </div>
      </div>

      {/* Main Hero Card */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-white/10 p-10 mb-12 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl opacity-50 mix-blend-screen pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl opacity-50 mix-blend-screen pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-indigo-300 text-sm font-medium mb-6">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
              Live Practice Engine Ready
            </div>
            <h3 className="text-3xl font-bold text-white mb-4">Start a Mock Interview</h3>
            <p className="text-slate-300 text-base leading-relaxed mb-8 max-w-xl">
              Simulate a real-world technical or behavioral interview. Our AI will listen to your answers in real-time, generate smart follow-up questions, and evaluate your performance.
            </p>
            <button
              onClick={() => setActiveModule('interview')}
              className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-white text-indigo-950 font-bold rounded-2xl overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_40px_rgba(255,255,255,0.3)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-100 to-purple-100 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <span className="relative z-10 text-lg">Start New Practice Session</span>
              <svg className="relative z-10 w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
          
          <div className="hidden lg:flex w-72 h-72 items-center justify-center relative">
             <div className="absolute inset-0 border-2 border-indigo-500/20 rounded-full animate-[spin_10s_linear_infinite]"></div>
             <div className="absolute inset-4 border-2 border-dashed border-purple-500/30 rounded-full animate-[spin_15s_linear_infinite_reverse]"></div>
             <div className="absolute inset-12 border border-white/10 rounded-full backdrop-blur-sm bg-white/5 flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.2)]">
                <span className="text-6xl">🎙️</span>
             </div>
          </div>
        </div>
      </div>

      {/* Recent Sessions */}
      <div>
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          Recent Sessions
          <span className="text-xs px-2 py-1 bg-white/10 text-slate-300 rounded-md font-medium ml-2">Beta</span>
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full py-12 flex justify-center items-center">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : recentSessions.map((session) => (
            <div 
              key={session.id}
              className="bg-[#12141c] border border-white/5 rounded-2xl p-6 hover:border-white/10 hover:bg-[#151821] transition-colors cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20v-6M6 20V10M18 20V4" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200 capitalize">
                      {session.interviewType || 'Mock Interview'}
                    </h4>
                    <p className="text-xs text-slate-500">{formatDate(session.startTime)}</p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-end justify-between mt-6">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Questions</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-slate-200">
                      {session.questionCount || 0}
                    </span>
                  </div>
                </div>
                
                <div className="text-right">
                   <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-xs font-medium text-slate-300">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                     </svg>
                     {formatDuration(session.duration)}
                   </div>
                </div>
              </div>
            </div>
          ))}

          {/* Empty State / Start New Card */}
          <div 
            onClick={() => setActiveModule('interview')}
            className="border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer min-h-[160px]"
          >
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 text-slate-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-300">Start New Session</h4>
          </div>
        </div>
      </div>
    </div>
  );
}
