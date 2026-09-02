import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchAgents } from '../../data/api';
import { Bot, Cpu, Activity, Signal } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function AgentsPage() {
  const { data: agents, loading, error, isStale, isDegraded } = useFetch(fetchAgents);

  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Agent Fleet</h2>
        <button className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors">
          Configure Providers
        </button>
      </div>

      <DataState 
        loading={loading} 
        error={error} 
        empty={!agents || agents.length === 0} 
        emptyMessage="No agents available"
        isStale={isStale}
        isDegraded={isDegraded}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {agents?.map(agent => (
            <Card key={agent.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Bot className="w-6 h-6 text-slate-700" />
                  </div>
                  <Badge variant={agent.status === 'RUNNING' || agent.status === 'REVIEWING' ? 'info' : agent.status === 'ONLINE' ? 'success' : 'neutral'}>
                    {agent.status}
                  </Badge>
                </div>
                
                <h3 className="text-lg font-bold text-slate-900">{agent.name}</h3>
                <p className="text-sm text-slate-500 mb-4">{agent.role}</p>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5"><Cpu className="w-4 h-4" /> Provider</span>
                    <span className="font-medium text-slate-900">{agent.provider}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5"><Signal className="w-4 h-4" /> Latency</span>
                    <span className="font-medium text-slate-900">{agent.latencyMs}ms</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5"><Activity className="w-4 h-4" /> Task</span>
                    <span className="font-medium text-slate-900 truncate max-w-[100px]" title={agent.currentTask}>{agent.currentTask || 'Idle'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DataState>
    </div>
  );
}
