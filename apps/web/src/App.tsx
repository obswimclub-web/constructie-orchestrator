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

function App() {
  return (
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
  );
}

export default App;
