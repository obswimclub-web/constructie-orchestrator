import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './components/dashboard/Dashboard';
import { PlaceholderPage } from './components/layout/PlaceholderPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<PlaceholderPage title="Projects" description="Manage orchestration projects and repository bindings." />} />
        <Route path="workspace" element={<PlaceholderPage title="Workspace" description="Deep dive into the current workspace timeline." />} />
        <Route path="task-graph" element={<PlaceholderPage title="Task Graph" description="Interactive node-based workflow visualization." />} />
        <Route path="agents" element={<PlaceholderPage title="Agents" description="Agent fleet management and configuration." />} />
        <Route path="runs" element={<PlaceholderPage title="Runs" description="Historical and active run execution logs." />} />
        <Route path="reviewer-findings" element={<PlaceholderPage title="Reviewer Findings" description="Detailed findings from independent verification agents." />} />
        <Route path="approvals" element={<PlaceholderPage title="Owner Approvals" description="Centralized approval queue for governance gates." />} />
        <Route path="evidence" element={<PlaceholderPage title="Evidence" description="Forensic artifacts and cryptographically secure attestations." />} />
        <Route path="incidents" element={<PlaceholderPage title="Incidents" description="Security and operational incident tracker." />} />
        <Route path="logs" element={<PlaceholderPage title="Logs" description="Raw execution telemetry and streams." />} />
        <Route path="settings" element={<PlaceholderPage title="Settings / Providers" description="Provider credentials, model configurations, and platform settings." />} />
      </Route>
    </Routes>
  );
}

export default App;
