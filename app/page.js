'use client';
import { useState, useEffect, useRef } from 'react';
import { Settings, CheckCircle2, XCircle } from 'lucide-react';

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

    return () => clearInterval(interval);
  }, []);

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
                setResult({
                  type: 'success',
                  title: 'Success!',
                  elapsed,
                  details: `
                    ${data.result.check_in ? `<strong class="result-time">Check In:</strong> ${data.result.check_in}<br>` : ''}
                    ${data.result.check_out ? `<strong class="result-time">Check Out:</strong> ${data.result.check_out}` : ''}
                    ${!data.result.check_in && !data.result.check_out ? 'Your attendance has been recorded.' : ''}
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
