import { useState, useEffect } from 'react';
import { loginWithBootstrap } from './data/api';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './components/dashboard/Dashboard';
import { ProjectsPage } from './components/projects/ProjectsPage';
import { WorkspacePage } from './components/workspace/WorkspacePage';
import { RunsPage } from './components/runs/RunsPage';
import { TaskGraphPage } from './components/workflow/TaskGraphPage';
import { AgentsPage } from './components/agents/AgentsPage';
import { ReviewerFindingsPage } from './components/agents/ReviewerFindingsPage';
import { ApprovalsPage } from './components/approvals/ApprovalsPage';
import { EvidencePage } from './components/evidence/EvidencePage';
import { IncidentsPage } from './components/incidents/IncidentsPage';
import { LogsPage } from './components/logs/LogsPage';
import { SettingsPage } from './components/settings/SettingsPage';


function LoginBootstrap({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await loginWithBootstrap(key);
      setKey('');
      onLogin();
    } catch {
      setError('Invalid bootstrap key');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999 }}>
      <form onSubmit={handleSubmit} style={{ background: '#1e1e1e', padding: '2rem', borderRadius: '8px', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1rem', color: '#fff' }}>
        <h2>Owner Authentication</h2>
        {error && <div style={{ color: '#ff4444' }}>{error}</div>}
        <div>
          <label htmlFor="bootstrap-key" style={{ display: 'block', marginBottom: '0.5rem' }}>Bootstrap Key</label>
          <input id="bootstrap-key" 
            type="password" 
            value={key} 
            onChange={e => setKey(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', background: '#2d2d2d', border: '1px solid #444', color: '#fff' }}
          />
        </div>
        <button type="submit" disabled={loading} style={{ background: '#0066cc', color: '#fff', border: 'none', padding: '0.5rem', cursor: 'pointer' }}>
          {loading ? 'Authenticating...' : 'Authenticate'}
        </button>
      </form>
    </div>
  );
}

import { checkSession } from './data/api';

function App() {
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking');
  
  useEffect(() => {
    checkSession().then(res => { setAuthState(res.authenticated ? 'authenticated' : 'unauthenticated');
    }).catch(() => { setAuthState('unauthenticated');
    });
    
    const handleAuth = () => setAuthState('unauthenticated');
    window.addEventListener('co-auth-unauthorized', handleAuth);
    return () => window.removeEventListener('co-auth-unauthorized', handleAuth);
  }, []);

  if (authState === 'checking') {
    return <div style={{ padding: '2rem' }}>Loading authentication state...</div>;
  }
  return (
    <>
      {authState === 'unauthenticated' && <LoginBootstrap onLogin={() => { setAuthState('authenticated'); window.location.reload(); }} />}
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="task-graph" element={<TaskGraphPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="reviewer-findings" element={<ReviewerFindingsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
    </>
  );
}

export default App;
