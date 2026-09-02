import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchWorkItems } from '../../data/api';
import { DataState } from '../ui/DataState';

function getStatusVariant(status: string) {
  switch (status) {
    case 'RUNNING': return 'info';
    case 'REVIEW': return 'governance';
    case 'REPAIR': return 'warning';
    case 'WAITING': return 'neutral';
    case 'COMPLETE': return 'success';
    default: return 'neutral';
  }
}

export function ProjectWorkspace() {
  const { data: runs, loading, error, isStale, isDegraded } = useFetch(fetchWorkItems);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader title="Project Workspace" subtitle="Constructie Orchestrator" />
      <CardContent noPadding className="flex-1 overflow-y-auto relative">
        <DataState 
          loading={loading} 
          error={error} 
          empty={!runs || runs.length === 0} 
          emptyMessage="No runs available."
          isStale={isStale}
          isDegraded={isDegraded}
        >
          <div className="flex flex-col">
            {runs?.map((run, i) => (
              <div key={run.id} className="flex items-start p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <div className="flex flex-col items-center mr-4 mt-1">
                  <div className={`w-3 h-3 rounded-full ${run.status === 'RUNNING' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`}></div>
                  {i !== (runs?.length || 0) - 1 && <div className="w-px h-12 bg-slate-200 mt-2"></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-slate-800 truncate">{run.title}</h4>
                    <Badge variant={getStatusVariant(run.status)}>{run.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">Started {run.startedAt}</p>
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </CardContent>
    </Card>
  );
}
