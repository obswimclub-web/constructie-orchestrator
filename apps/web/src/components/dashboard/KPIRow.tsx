import { Card } from '../ui/Card';
import { useFetch } from '../../data/hooks';
import { fetchDashboardStats } from '../../data/api';
import { DataState } from '../ui/DataState';

export function KPIRow() {
  const { data: stats, loading, error, isStale, isDegraded } = useFetch(fetchDashboardStats);

  const kpis = stats ? [
    { label: 'Active Runs', value: stats.activeRuns, highlight: true },
    { label: 'Agents Online', value: `${stats.agentsOnline} / ${stats.totalAgents}` },
    { label: 'Pending Approvals', value: stats.pendingApprovals, highlight: stats.pendingApprovals > 0, highlightColor: 'text-amber-500' },
    { label: 'Open Incidents', value: stats.openIncidents, highlight: stats.openIncidents > 0, highlightColor: 'text-red-500' },
    { label: 'Qualification Status', value: stats.qualificationStatus, highlight: true, highlightColor: 'text-green-500' },
    { label: 'Governance State', value: stats.governanceState, highlight: true, highlightColor: 'text-purple-600' },
  ] : [];

  return (
    <DataState loading={loading} error={error} empty={!stats} isStale={isStale} isDegraded={isDegraded}>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="p-4 flex flex-col justify-center text-center items-center">
            <span className="text-sm text-slate-500 font-medium mb-1">{kpi.label}</span>
            <span className={`text-2xl font-bold ${kpi.highlight ? (kpi.highlightColor || 'text-blue-600') : 'text-slate-900'}`}>
              {kpi.value}
            </span>
          </Card>
        ))}
      </div>
    </DataState>
  );
}
