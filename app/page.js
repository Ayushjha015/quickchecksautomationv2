'use client';
import { useState, useEffect, useRef } from 'react';
import { Settings, CheckCircle2, XCircle, Globe, RefreshCw } from 'lucide-react';

export default function Home() {
  const [time, setTime] = useState('--:--:--');
  const [dateStr, setDateStr] = useState('Loading...');
  
  const [status, setStatus] = useState('ready'); // ready, loading, error, success
  const [statusMsg, setStatusMsg] = useState('Ready to mark attendance');
  const [result, setResult] = useState(null);
  const [steps, setSteps] = useState([]);
  const startTimeRef = useRef(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    emailAddress: '',
    emailPassword: '',
    quikchexEmail: '',
    quikchexPassword: '',
    companyId: '',
    employeeId: ''
  });

  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [hasCachedSession, setHasCachedSession] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Clock
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false }));
      setDateStr(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);

    // Fetch initial config
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.config) setConfig(data.config);
      });

    // Check if cookies are cached on backend
    fetch('/api/cookies')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.cookies && data.cookies.length > 0) {
          setHasCachedSession(true);
        }
      })
      .catch(err => console.error("Error checking cookies cache:", err));

    // Listen for extension messaging
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'PONG_QUIKCHEX_EXTENSION') {
        setExtensionInstalled(true);
      }
      if (event.data && event.data.type === 'SYNC_COOKIES_RESPONSE') {
        setIsSyncing(false);
        if (event.data.success) {
          setStatusMsg('Session synced to browser!');
          setTimeout(() => setStatusMsg('Ready to mark attendance'), 3000);
        } else {
          alert('Failed to sync cookies to browser: ' + event.data.error);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Continuous ping to detect when extension gets enabled
    const pingInterval = setInterval(() => {
      window.postMessage({ type: 'PING_QUIKCHEX_EXTENSION' }, '*');
    }, 500);

    return () => {
      clearInterval(interval);
      clearInterval(pingInterval);
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const syncCookiesToBrowser = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/cookies');
      const data = await res.json();
      if (data.success && data.cookies && data.cookies.length > 0) {
        window.postMessage({ type: 'SYNC_COOKIES', cookies: data.cookies }, '*');
      } else {
        setIsSyncing(false);
        alert('No login session found. Please mark attendance first to authenticate.');
      }
    } catch (error) {
      setIsSyncing(false);
      alert('Error fetching session cookies: ' + error.message);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.key === 'm' || event.key === 'M') && status !== 'loading' && !showSettings) {
        markAttendance();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [status, showSettings]);

  const markAttendance = async () => {
    setStatus('loading');
    setStatusMsg('Processing your request...');
    setResult(null);
    setSteps([]);
    startTimeRef.current = Date.now();

    try {
      const res = await fetch('/api/attendance');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // keep the last incomplete part

          for (const part of parts) {
            if (part.startsWith('data: ')) {
              const dataStr = part.replace('data: ', '');
              let data;
              try {
                data = JSON.parse(dataStr);
              } catch (e) {
                console.error("Error parsing SSE JSON:", e);
                continue;
              }
              
              if (data.type === 'progress') {
                setSteps(prev => [...prev, data.message]);
              } else if (data.type === 'success') {
                const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
                setStatus('ready');
                setStatusMsg('Attendance marked successfully!');

                let syncMessage = '';
                if (data.result.cookies && data.result.cookies.length > 0) {
                  setHasCachedSession(true);
                  if (extensionInstalled) {
                    window.postMessage({ type: 'SYNC_COOKIES', cookies: data.result.cookies }, '*');
                    syncMessage = '<br><span style="color: var(--success-start); font-size: 0.85rem;">🔄 Browser session synced! You are now logged in on secure.quikchex.in.</span>';
                  } else {
                    syncMessage = '<br><span style="color: var(--warning-start); font-size: 0.85rem;">⚠️ Session cached. Install the Chrome extension to sync login session to your browser.</span>';
                  }
                }

                setResult({
                  type: 'success',
                  title: 'Success!',
                  elapsed,
                  details: `
                    ${data.result.check_in ? `<strong class="result-time">Check In:</strong> ${data.result.check_in}<br>` : ''}
                    ${data.result.check_out ? `<strong class="result-time">Check Out:</strong> ${data.result.check_out}` : ''}
                    ${!data.result.check_in && !data.result.check_out ? 'Your attendance has been recorded.' : ''}
                    ${syncMessage}
                  `
                });
              } else if (data.type === 'error') {
                throw new Error(data.detail);
              }
            }
          }
        }
      }
    } catch (error) {
      const elapsed = startTimeRef.current ? ((Date.now() - startTimeRef.current) / 1000).toFixed(1) : null;
      setStatus('error');
      setStatusMsg('Failed to mark attendance');
      setResult({
        type: 'error',
        title: 'Something went wrong',
        elapsed,
        details: `<strong>Error:</strong> ${error.message}<br><br>Please try again or check your settings.`
      });
    }
  };

  const handleSaveSettings = async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setShowSettings(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <div className="container">
        <div className="card">
          <div className="header">
            <button className="settings-btn" onClick={() => setShowSettings(true)} title="Settings">
              <Settings size={24} />
            </button>
            <div className="logo">⏰</div>
            <h1>Attendance Tracker</h1>
            <p className="subtitle">Quick & Automated Check-In System</p>
          </div>

          <div className="time-display">
            <div className="current-time">{time}</div>
            <div className="current-date">{dateStr}</div>
          </div>

          <div className="status-indicator">
            <div className={`status-dot ${status}`}></div>
            <div className="status-text">{statusMsg}</div>
          </div>

          <button 
            className={`btn-primary ${status === 'loading' ? 'loading' : ''}`}
            onClick={markAttendance}
            disabled={status === 'loading'}
          >
            <div className="btn-content">
              <div className="spinner" style={{ display: status === 'loading' ? 'block' : 'none' }}></div>
              <span className="btn-text" style={{ display: status === 'loading' ? 'none' : 'block' }}>
                Mark Attendance
              </span>
            </div>
          </button>

          {(steps.length > 0 || status === 'loading') && (
            <div className="timeline">
              {steps.map((step, idx) => (
                <div key={idx} className="timeline-item">
                  <div className="timeline-dot completed">
                    <CheckCircle2 size={12} color="#fff" />
                  </div>
                  <div className="timeline-content">{step}</div>
                </div>
              ))}
              {status === 'loading' && (
                <div className="timeline-item">
                  <div className="timeline-dot active">
                     <div className="spinner-small"></div>
                  </div>
                  <div className="timeline-content active-text">Working...</div>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className={`result show ${result.type}`}>
              <div className="result-title">
                <span className="result-icon">
                  {result.type === 'success' ? <CheckCircle2 color="var(--success-start)"/> : <XCircle color="var(--error-start)"/>}
                </span>
                <span>{result.title}</span>
              </div>
              <div className="result-details" dangerouslySetInnerHTML={{ __html: result.details }}></div>
              {result.elapsed && (
                <div className="result-elapsed">⏱ Completed in {result.elapsed}s</div>
              )}
            </div>
          )}

          {/* Extension Status Card */}
          <div className="ext-sync-card">
            <div className="ext-sync-header">
              <span className="ext-sync-title">
                <Globe size={18} /> Browser Cookie Sync
              </span>
              <span className={`ext-badge ${extensionInstalled ? 'active' : 'inactive'}`}>
                {extensionInstalled ? 'Active' : 'Not Loaded'}
              </span>
            </div>
            <div className="ext-sync-body">
              {extensionInstalled ? (
                <>
                  <p>Helper extension active. QuikChex login session is automatically synchronized with your browser.</p>
                  {hasCachedSession && (
                    <button 
                      className="btn-sync" 
                      onClick={syncCookiesToBrowser}
                      disabled={isSyncing}
                    >
                      <RefreshCw size={14} className={isSyncing ? 'spinner-small' : ''} />
                      {isSyncing ? 'Syncing...' : 'Sync Session to Browser'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p>To access QuikChex in your browser without logging in again, load the helper extension:</p>
                  <ol className="ext-sync-steps">
                    <li>Navigate to <code>chrome://extensions/</code> in your browser.</li>
                    <li>Enable <strong>Developer mode</strong> (toggle top-right).</li>
                    <li>Click <strong>Load unpacked</strong> and select the <code>chrome-extension/</code> folder in this project's root.</li>
                  </ol>
                </>
              )}
            </div>
          </div>

          <div className="footer">
            <p>Powered by <a href="#" className="footer-link">QuickChecks Automation</a></p>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Configuration</h2>
            <div className="form-group">
              <label>IMAP Email (Your Email)</label>
              <input type="email" value={config.emailAddress} onChange={e => setConfig({...config, emailAddress: e.target.value})} />
            </div>
            <div className="form-group">
              <label>IMAP App Password</label>
              <input type="password" value={config.emailPassword} onChange={e => setConfig({...config, emailPassword: e.target.value})} />
            </div>
            <div className="form-group">
              <label>QuikChex Email</label>
              <input type="email" value={config.quikchexEmail} onChange={e => setConfig({...config, quikchexEmail: e.target.value})} />
            </div>
            <div className="form-group">
              <label>QuikChex Password</label>
              <input type="password" value={config.quikchexPassword} onChange={e => setConfig({...config, quikchexPassword: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Company ID</label>
              <input type="text" value={config.companyId} onChange={e => setConfig({...config, companyId: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Employee ID</label>
              <input type="text" value={config.employeeId} onChange={e => setConfig({...config, employeeId: e.target.value})} />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn-save" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
