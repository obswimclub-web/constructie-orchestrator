import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchAgents } from '../../data/api';
import { DataState } from '../ui/DataState';

function getAgentStatusVariant(status: string) {
  switch (status) {
    case 'ONLINE': return 'success';
    case 'RUNNING': return 'info';
    case 'IDLE': return 'neutral';
    case 'REVIEWING': return 'governance';
    default: return 'neutral';
  }
}

export function AgentsPanel() {
  const { data: agents, loading, error, isStale, isDegraded } = useFetch(fetchAgents);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader title="Agents & Providers" />
      <CardContent noPadding className="flex-1 overflow-x-auto relative">
        <DataState 
          loading={loading} 
          error={error} 
          empty={!agents || agents.length === 0} 
          emptyMessage="No agents available"
          isStale={isStale}
          isDegraded={isDegraded}
        >
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-medium">
              <tr>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Current Task</th>
                <th className="px-4 py-3 text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents?.map(agent => (
                <tr key={agent.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{agent.name}</div>
                    <div className="text-xs text-slate-500">{agent.provider}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{agent.role}</td>
                  <td className="px-4 py-3">
                    <Badge variant={getAgentStatusVariant(agent.status)}>{agent.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[150px]">{agent.currentTask || '-'}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{agent.latencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataState>
      </CardContent>
    </Card>
  );
}
