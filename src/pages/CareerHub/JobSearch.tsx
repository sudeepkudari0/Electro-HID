import { useState, useEffect } from 'react';
import { useJobStore, useCareerProfileStore } from '../../career/state/career-store';
import { useNavigationStore } from '../../state/navigation-store';
import type { Job } from '../../career/core/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { MultiSelect } from '../../components/ui/MultiSelect';

const JOB_BOARDS = [
  { id: 'linkedin', name: 'LinkedIn', icon: '💼' },
  { id: 'indeed', name: 'Indeed', icon: '🔍' },
  { id: 'glassdoor', name: 'Glassdoor', icon: '🚪' },
  { id: 'zip_recruiter', name: 'ZipRecruiter', icon: '⚡' },
  { id: 'naukri', name: 'Naukri', icon: '🇮🇳' },
];

const JOB_TYPES = [
  { value: '', label: 'Any Type' },
  { value: 'fulltime', label: 'Full Time' },
  { value: 'parttime', label: 'Part Time' },
  { value: 'internship', label: 'Internship' },
  { value: 'contract', label: 'Contract' },
];

const HOURS_OLD_OPTIONS = [
  { value: 24, label: 'Past 24 hours' },
  { value: 72, label: 'Past 3 days' },
  { value: 168, label: 'Past week' },
  { value: 720, label: 'Past month' },
];

const COUNTRIES = [
  { value: 'usa', label: '🇺🇸 USA' },
  { value: 'india', label: '🇮🇳 India' },
  { value: 'uk', label: '🇬🇧 UK' },
  { value: 'canada', label: '🇨🇦 Canada' },
  { value: 'germany', label: '🇩🇪 Germany' },
  { value: 'australia', label: '🇦🇺 Australia' },
  { value: 'singapore', label: '🇸🇬 Singapore' },
  { value: 'france', label: '🇫🇷 France' },
  { value: 'netherlands', label: '🇳🇱 Netherlands' },
  { value: 'japan', label: '🇯🇵 Japan' },
  { value: 'united arab emirates', label: '🇦🇪 UAE' },
];

const IT_JOBS = [
  'Software Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Engineer',
  'DevOps Engineer',
  'Site Reliability Engineer (SRE)',
  'Mobile Developer',
  'Machine Learning Engineer',
  'Data Scientist',
  'Data Engineer',
  'Cloud Architect',
  'Cybersecurity Analyst',
  'UI/UX Designer',
  'Product Manager',
  'QA Automation Engineer',
  'Database Administrator',
  'System Administrator'
];



interface SearchableDropdownProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  disabled?: boolean;
}

function SearchableDropdown({
  label,
  placeholder,
  value,
  onChange,
  options,
  disabled
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const filteredOptions = options.filter(opt =>
    opt.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div className="js-input-wrapper" style={{ position: 'relative', zIndex: isOpen ? 50 : 1 }}>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="js-input-modern"
          style={{ width: '100%', paddingRight: '40px' }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setFocusedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIsOpen(true);
              setFocusedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIsOpen(true);
              setFocusedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
              if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
                e.preventDefault();
                onChange(filteredOptions[focusedIndex]);
                setIsOpen(false);
              }
            } else if (e.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          disabled={disabled}
        />
        {/* Toggle Dropdown Button */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent input from blurring
            if (!disabled) setIsOpen(!isOpen);
          }}
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: disabled ? 'none' : 'auto'
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* Floating suggestion list */}
        {isOpen && filteredOptions.length > 0 && (
          <div className="js-suggestions" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 99 }}>
            {filteredOptions.map((opt, idx) => (
              <button
                key={opt}
                type="button"
                className="js-suggestion"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent input blur so click handler succeeds
                  onChange(opt);
                  setIsOpen(false);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: focusedIndex === idx ? 'rgba(99, 102, 241, 0.15)' : 'none',
                  color: focusedIndex === idx ? '#e2e8f0' : '#94a3b8',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function JobSearch() {
  const { jobs: savedJobs, addJob } = useJobStore();
  const { profile } = useCareerProfileStore();
  
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  
  const [query, setQuery] = useState('');
  const [selectedBoards, setSelectedBoards] = useState<string[]>(['linkedin', 'indeed']);
  const [isRemote, setIsRemote] = useState(false);
  const [maxResults, setMaxResults] = useState(15);
  const [jobType, setJobType] = useState('');
  const [hoursOld, setHoursOld] = useState(72);
  const [easyApply, setEasyApply] = useState(false);
  const [distance, setDistance] = useState(50);
  const [country, setCountry] = useState('usa');
  const [linkedinFetchDesc, setLinkedinFetchDesc] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const [pythonStatus, setPythonStatus] = useState<{ checked: boolean; pythonAvailable: boolean; venvReady: boolean }>({
    checked: false,
    pythonAvailable: false,
    venvReady: false
  });
  const [blockedCompanies, setBlockedCompanies] = useState<string[]>([]);

  useEffect(() => {
    if ((window as any).electronAPI?.careerHub?.checkJobspy) {
      (window as any).electronAPI.careerHub.checkJobspy().then((res: any) => {
        if (res.success) {
          setPythonStatus({
            checked: true,
            pythonAvailable: res.pythonAvailable,
            venvReady: res.venvReady
          });
        } else {
          setPythonStatus(prev => ({ ...prev, checked: true }));
        }
      }).catch(() => {
        setPythonStatus(prev => ({ ...prev, checked: true }));
      });
    }

    if ((window as any).electronAPI?.careerHub?.loadBlockedCompanies) {
      (window as any).electronAPI.careerHub.loadBlockedCompanies().then((res: any) => {
        if (res.success && res.companies) {
          setBlockedCompanies(res.companies);
        }
      }).catch(() => {});
    }
  }, []);



  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setSetupStatus(null);
    
    // Check python status again before search starts to ensure it hasn't changed
    if ((window as any).electronAPI?.careerHub?.checkJobspy) {
      try {
        const res = await (window as any).electronAPI.careerHub.checkJobspy();
        if (res.success) {
          setPythonStatus({
            checked: true,
            pythonAvailable: res.pythonAvailable,
            venvReady: res.venvReady
          });
        }
      } catch (e) {}
    }

    // Set up status handler
    const removeListener = (window as any).electronAPI?.careerHub?.onSetupStatus?.((status: string) => {
      if (status === 'creating_venv') {
        setSetupStatus('Creating Python virtual environment...');
      } else if (status === 'installing_requirements') {
        setSetupStatus('Installing scraper dependencies (jobspy, pandas)...');
      } else if (status === 'running') {
        setSetupStatus('Executing JobSpy scraper...');
      }
    });

    try {
      // Use country display name as location for the scraper
      const countryLabel = COUNTRIES.find(c => c.value === country)?.label?.replace(/^[^\w]*/, '').trim() || country;
      
      // Calculate results parameter for the python-jobspy scraper
      // We add the count of blocked companies so that we can filter them out and still have enough
      const resultsToRequest = maxResults + blockedCompanies.length;

      const response = await (window as any).electronAPI.careerHub.runJobspy({
        query,
        location: countryLabel,
        sites: selectedBoards.join(','),
        remote: isRemote,
        results: resultsToRequest,
        hours: hoursOld,
        jobType: jobType || undefined,
        easyApply: easyApply || undefined,
        distance,
        country,
        linkedinFetchDescription: linkedinFetchDesc || undefined,
      });

      if (response.success) {
        const allFetchedJobs = response.data || [];
        const nonBlockedJobs = allFetchedJobs.filter((job: any) => {
          const compName = (job.company || '').trim().toLowerCase();
          return !blockedCompanies.some(blocked => blocked.trim().toLowerCase() === compName);
        });
        
        // Slice to exactly maxResults
        const finalJobsList = nonBlockedJobs.slice(0, maxResults);
        setResults(finalJobsList);
        
        // update setup status so it doesn't show in UI anymore, and update venv status
        setPythonStatus(prev => ({ ...prev, venvReady: true }));
      } else {
        setError(response.error || 'Unknown error occurred during search.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to communicate with scraper engine.');
    } finally {
      setLoading(false);
      setSetupStatus(null);
      if (removeListener) removeListener();
    }
  };

  const handleSaveJob = (job: any) => {
    const applyUrl = job.job_url || job.job_url_direct || '';
    const newJob: Job = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      url: applyUrl,
      title: job.title || 'Untitled Role',
      company: job.company || 'Unknown Company',
      location: job.location || 'Remote',
      description: job.description || '',
      isRemote: job.is_remote || false,
      source: job.site || 'JobSpy',
      dateFound: new Date().toISOString(),
      status: 'saved',
      notes: '',
      updatedAt: new Date().toISOString(),
      fitScore: undefined,
    };

    addJob(newJob);
    // Persist
    (window as any).electronAPI?.careerHub?.saveJobs?.([...savedJobs, newJob]);
  };

  const isSaved = (job: any) => {
    const url = job.job_url || job.job_url_direct;
    return savedJobs.some((j) => j.url === url);
  };

  const handleBlockCompany = async (companyName: string) => {
    if (!companyName) return;
    const trimmedName = companyName.trim();
    if (!trimmedName) return;
    
    // Check if already blocked (case-insensitive)
    const alreadyBlocked = blockedCompanies.some(
      blocked => blocked.toLowerCase() === trimmedName.toLowerCase()
    );
    
    if (alreadyBlocked) return;
    
    const newBlockedList = [...blockedCompanies, trimmedName];
    setBlockedCompanies(newBlockedList);
    
    // Save to disk
    if ((window as any).electronAPI?.careerHub?.saveBlockedCompanies) {
      await (window as any).electronAPI.careerHub.saveBlockedCompanies(newBlockedList);
    }
    
    // Immediately filter out from current results in state
    setResults(prevResults => 
      prevResults.filter(job => (job.company || '').trim().toLowerCase() !== trimmedName.toLowerCase())
    );
  };

  const handleSaveSelected = () => {
    results.forEach((job, idx) => {
      const jobId = job.id || job.job_url || job.title || String(idx);
      if (selectedJobIds.has(jobId) && !isSaved(job)) {
        handleSaveJob(job);
      }
    });
  };

  const handleOpenSelected = () => {
    const jobsToOpen = results.filter((job, idx) => {
      const jobId = job.id || job.job_url || job.title || String(idx);
      return selectedJobIds.has(jobId) && (job.job_url || job.job_url_direct);
    }).map(job => ({
      id: job.id || job.job_url || job.title,
      url: job.job_url || job.job_url_direct,
      title: job.title,
      company: job.company
    }));

    if (jobsToOpen.length > 0) {
      if ((window as any).electronAPI?.careerHub?.runAutofillSession) {
        (window as any).electronAPI.careerHub.runAutofillSession({
          jobs: jobsToOpen,
          profile: profile
        }, (status: any) => console.log('Autofill status:', status));
      } else {
        jobsToOpen.forEach(j => window.open(j.url, '_blank'));
      }
    }
  };

  return (
    <div className="js-dashboard" style={{ paddingBottom: '60px' }}>
      {pythonStatus.checked && !pythonStatus.pythonAvailable && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          color: '#f87171',
          fontSize: '14px',
          lineHeight: '1.5'
        }}>
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Python 3 Not Found</h4>
            <p style={{ margin: 0, color: '#fca5a5' }}>
              Synapse AI uses <strong>python-jobspy</strong> to scrape job boards offline. 
              To enable this feature, please install Python 3.9+ on your system and restart the app.
              Once Python is installed, Synapse AI will automatically configure the required packages on your first search.
            </p>
          </div>
        </div>
      )}

      {pythonStatus.checked && pythonStatus.pythonAvailable && !pythonStatus.venvReady && (
        <div style={{
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          color: '#a5b4fc',
          fontSize: '13px'
        }}>
          <span style={{ fontSize: '18px' }}>ℹ️</span>
          <div>
            Synapse AI will automatically initialize the local Python scraping environment (via <code>pip install python-jobspy pandas</code>) on your first search.
          </div>
        </div>
      )}

      {/* Search Configuration */}
      <div className="js-glass-panel">
        <div className="js-header">
          <h2 className="js-header-title">✨ Automated Job Fetcher</h2>
          <p className="js-header-subtitle">
            Directly scrapes live job boards and brings the results into Synapse AI.
          </p>
        </div>

        <div className="js-search-form">
          <SearchableDropdown
            label="Job Title / Keywords"
            placeholder="e.g. Software Engineer, React"
            value={query}
            onChange={setQuery}
            options={IT_JOBS}
            disabled={loading}
          />

          <div className="js-input-wrapper">
            <label>Country / Region</label>
            <Select value={country} onValueChange={setCountry} disabled={loading}>
              <SelectTrigger className="js-input-modern" style={{ width: '100%' }}>
                <SelectValue placeholder="Select Country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="js-boards-grid">
            <MultiSelect
              options={JOB_BOARDS}
              selected={selectedBoards}
              onChange={setSelectedBoards}
              placeholder="Select Job Boards"
              disabled={loading}
            />
            
            <button
              className={`js-board-btn ${isRemote ? 'active' : ''}`}
              onClick={() => setIsRemote(!isRemote)}
              disabled={loading}
              style={{ background: isRemote ? 'rgba(34, 197, 94, 0.15)' : '', borderColor: isRemote ? 'rgba(34, 197, 94, 0.5)' : '', color: isRemote ? '#4ade80' : '' }}
            >
              🏠 Remote Only
            </button>
            
            <Select
              value={String(maxResults)}
              onValueChange={(val) => setMaxResults(Number(val))}
              disabled={loading}
            >
              <SelectTrigger className="js-board-btn h-10 w-full justify-between text-slate-300 font-medium">
                <SelectValue placeholder="Max Results" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 Results</SelectItem>
                <SelectItem value="30">30 Results</SelectItem>
                <SelectItem value="50">50 Results</SelectItem>
              </SelectContent>
            </Select>

            <button
              type="button"
              className={`js-board-btn`}
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={loading}
              style={{ color: showAdvanced ? '#a5b4fc' : '#64748b', borderColor: showAdvanced ? 'rgba(99, 102, 241, 0.3)' : undefined, height: '40px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', marginRight: '6px' }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
              Filters
            </button>
          </div>

          {/* Advanced Filters - full width row */}
          {showAdvanced && (
            <div className="js-boards-grid" style={{ gap: '8px' }}>
              <Select
                value={jobType || 'any'}
                onValueChange={(val) => setJobType(val === 'any' ? '' : val)}
                disabled={loading}
              >
                <SelectTrigger className="js-board-btn h-10 w-full justify-between text-slate-300 font-medium">
                  <SelectValue placeholder="Job Type" />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TYPES.map((jt) => (
                    <SelectItem key={jt.value} value={jt.value || 'any'}>
                      {jt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={String(hoursOld)}
                onValueChange={(val) => setHoursOld(Number(val))}
                disabled={loading}
              >
                <SelectTrigger className="js-board-btn h-10 w-full justify-between text-slate-300 font-medium">
                  <SelectValue placeholder="Age of Listing" />
                </SelectTrigger>
                <SelectContent>
                  {HOURS_OLD_OPTIONS.map((h) => (
                    <SelectItem key={h.value} value={String(h.value)}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>


              <Select
                value={String(distance)}
                onValueChange={(val) => setDistance(Number(val))}
                disabled={loading}
              >
                <SelectTrigger className="js-board-btn h-10 w-full justify-between text-slate-300 font-medium">
                  <SelectValue placeholder="Distance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">📏 10 mi</SelectItem>
                  <SelectItem value="25">📏 25 mi</SelectItem>
                  <SelectItem value="50">📏 50 mi</SelectItem>
                  <SelectItem value="100">📏 100 mi</SelectItem>
                </SelectContent>
              </Select>

              <button type="button" disabled={loading}
                className={`js-board-btn ${easyApply ? 'active' : ''}`}
                onClick={() => setEasyApply(!easyApply)}
                style={{ height: '40px' }}
              >
                ⚡ Easy Apply
              </button>

              {selectedBoards.includes('linkedin') && (
                <button type="button" disabled={loading}
                  className={`js-board-btn ${linkedinFetchDesc ? 'active' : ''}`}
                  onClick={() => setLinkedinFetchDesc(!linkedinFetchDesc)}
                  style={{
                    height: '40px',
                    ...(linkedinFetchDesc ? { background: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.5)', color: '#38bdf8' } : {})
                  }}
                >
                  📄 Full Desc
                </button>
              )}
            </div>
          )}

          <div className="js-search-action">
            <button 
              className="js-btn-primary" 
              onClick={handleSearch}
              disabled={loading || !query.trim() || selectedBoards.length === 0}
            >
              {loading ? 'Searching...' : '🚀 Fetch Jobs'}
            </button>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="js-error-card">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="js-glass-panel js-loading-state">
          <div className="js-spinner-ring"></div>
          <div className="js-loading-text">
            {setupStatus === 'creating_venv' && "Setting up Python Environment (creating venv)... This happens only once."}
            {setupStatus === 'installing_requirements' && "Installing dependencies (python-jobspy, pandas, beautifulsoup4, tls-client)... This may take up to 2-3 minutes on first run."}
            {setupStatus === 'searching' && `Scraping ${selectedBoards.length} boards... this takes a few seconds.`}
            {!setupStatus && `Fetching jobs...`}
          </div>
        </div>
      )}

      {/* Results Grid */}
      {!loading && results.length > 0 && (
        <div className="js-glass-panel">
          <div className="js-results-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="js-results-title" style={{ margin: 0 }}>Found {results.length} Jobs</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="js-btn-primary" 
                disabled={selectedJobIds.size === 0}
                onClick={handleSaveSelected}
                style={{ padding: '6px 12px', fontSize: '13px', opacity: selectedJobIds.size === 0 ? 0.5 : 1 }}
              >
                + Save Selected ({selectedJobIds.size})
              </button>
              <button 
                className="js-btn-view"
                disabled={selectedJobIds.size === 0}
                onClick={handleOpenSelected}
                style={{ padding: '6px 12px', fontSize: '13px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', opacity: selectedJobIds.size === 0 ? 0.5 : 1 }}
              >
                🌐 Open Selected in Browser
              </button>
            </div>
          </div>
          
          <div className="js-results-table-container" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#94a3b8', fontSize: '13px' }}>
                  <th style={{ padding: '12px 8px', width: '40px' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedJobIds.size === results.length && results.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedJobIds(new Set(results.map((r, idx) => r.id || r.job_url || r.title || String(idx))));
                        } else {
                          setSelectedJobIds(new Set());
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th style={{ padding: '12px 8px' }}>Job Info</th>
                  <th style={{ padding: '12px 8px' }}>Meta</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((job, idx) => {
                  const jobId = job.id || job.job_url || job.title || String(idx);
                  const isSelected = selectedJobIds.has(jobId);
                  const alreadySaved = isSaved(job);
                  const applyUrl = job.job_url || job.job_url_direct;

                  return (
                    <tr key={jobId} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', transition: 'background 0.2s', background: isSelected ? 'rgba(99, 102, 241, 0.05)' : 'transparent' }}>
                      <td style={{ padding: '12px 8px', verticalAlign: 'top' }}>
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={(e) => {
                            const newSet = new Set(selectedJobIds);
                            if (e.target.checked) newSet.add(jobId);
                            else newSet.delete(jobId);
                            setSelectedJobIds(newSet);
                          }}
                          style={{ cursor: 'pointer', marginTop: '4px' }}
                        />
                      </td>
                      <td style={{ padding: '12px 8px', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span className="js-result-site-badge" style={{ margin: 0, padding: '2px 6px', fontSize: '10px' }}>{job.site}</span>
                          <h4 className="js-result-title" style={{ margin: 0, fontSize: '15px' }} title={job.title}>{job.title}</h4>
                        </div>
                        <div className="js-result-company" style={{ margin: 0, fontSize: '13px', color: '#cbd5e1' }}>🏢 {job.company}</div>
                        
                        {job.skills && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                            {job.skills.split(',').slice(0, 5).map((skill: string, si: number) => (
                              <span key={si} style={{
                                fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                                background: 'rgba(99, 102, 241, 0.1)', color: '#a5b4fc',
                                border: '1px solid rgba(99, 102, 241, 0.15)',
                              }}>
                                {skill.trim()}
                              </span>
                            ))}
                            {job.skills.split(',').length > 5 && (
                              <span style={{ fontSize: '10px', color: '#64748b', padding: '2px 4px' }}>
                                +{job.skills.split(',').length - 5} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', verticalAlign: 'top', maxWidth: '250px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {job.location && <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0 }}>📍 {job.location}</span>}
                          {job.is_remote && <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0, color: '#4ade80', borderColor: 'rgba(74, 222, 128, 0.3)' }}>🏠 Remote</span>}
                          {job.job_type && <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0, color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.3)' }}>💼 {job.job_type}</span>}
                          {job.job_level && <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0, color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}>📊 {job.job_level}</span>}
                          {job.experience_range && <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0, color: '#fb923c', borderColor: 'rgba(251, 146, 60, 0.3)' }}>🧑‍💻 {job.experience_range}</span>}
                          {(job.min_amount || job.max_amount) && (
                            <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0, color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.3)' }}>
                              💰 {job.currency || '$'}{job.min_amount ? Math.round(job.min_amount).toLocaleString() : ''} 
                              {job.max_amount ? ` - ${Math.round(job.max_amount).toLocaleString()}` : ''}
                            </span>
                          )}
                          {job.date_posted && <span className="js-result-tag" style={{ padding: '2px 6px', fontSize: '11px', margin: 0, color: '#94a3b8', borderColor: 'rgba(148, 163, 184, 0.2)' }}>📅 {job.date_posted}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', verticalAlign: 'top', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '6px' }}>
                          {applyUrl && (
                            <button 
                              className="js-btn-view"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => {
                                if ((window as any).electronAPI?.careerHub?.runAutofillSession) {
                                  (window as any).electronAPI.careerHub.runAutofillSession({
                                    jobs: [{
                                      id: job.id,
                                      url: applyUrl,
                                      title: job.title,
                                      company: job.company
                                    }],
                                    profile: profile
                                  }, (status: any) => console.log('Autofill status:', status));
                                } else if ((window as any).electronAPI?.openExternal) {
                                  (window as any).electronAPI.openExternal(applyUrl);
                                } else {
                                  window.open(applyUrl, '_blank');
                                }
                              }}
                            >
                              🌐 View
                            </button>
                          )}
                          
                          {alreadySaved ? (
                            <button className="js-btn-saved" style={{ padding: '4px 8px', fontSize: '12px' }} disabled>
                              ✓ Saved
                            </button>
                          ) : (
                            <button className="js-btn-save" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleSaveJob(job)}>
                              + Save
                            </button>
                          )}

                          <button
                            className="js-btn-prep"
                            onClick={() => {
                              const prepJob = {
                                role: job.title || '',
                                company: job.company || '',
                                jobDescription: job.description || ''
                              };
                              localStorage.setItem('prepJob', JSON.stringify(prepJob));
                              useNavigationStore.getState().setActiveModule('interview');
                            }}
                            style={{
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                              color: '#a5b4fc',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                          >
                            🎙️ Prep
                          </button>

                          <button
                            className="js-btn-block"
                            onClick={() => handleBlockCompany(job.company)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.1)',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              color: '#f87171',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                            title="Block company"
                          >
                            🚫
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
