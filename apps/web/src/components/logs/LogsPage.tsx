import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchLogs } from '../../data/api';
import { Terminal, Filter, Download } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function LogsPage() {
  const { data: logs, loading, error, isStale, isDegraded } = useFetch(fetchLogs);

  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6 h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Execution Logs</h2>
          <p className="text-slate-500">Raw execution telemetry and streams</p>
        </div>
        <div className="flex gap-2">
          <button className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filter
          </button>
          <button className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden bg-slate-900 border-slate-800">
        <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex items-center gap-2 shrink-0">
          <Terminal className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-mono text-slate-400">orchestrator.log</span>
        </div>
        <CardContent noPadding className="flex-1 overflow-y-auto p-4 font-mono text-sm relative">
          <DataState 
            loading={loading} 
            error={error} 
            empty={!logs || logs.length === 0} 
            emptyMessage="No logs recorded."
            isStale={isStale}
            isDegraded={isDegraded}
          >
            <div className="flex flex-col gap-1">
              {logs?.map(log => (
                <div key={log.id} className="flex items-start gap-4 hover:bg-slate-800/50 px-2 py-1 rounded transition-colors group">
                  <span className="text-slate-500 shrink-0 w-48">{log.timestamp}</span>
                  <span className="text-blue-400 shrink-0 w-24 font-bold">[{log.actor}]</span>
                  <Badge variant={log.status === 'SUCCESS' ? 'success' : log.status === 'ERROR' ? 'danger' : 'info'}>
                    {log.operation}
                  </Badge>
                  <span className="text-slate-300 ml-2">{log.message}</span>
                </div>
              ))}
            </div>
          </DataState>
        </CardContent>
      </Card>
    </div>
  );
}
