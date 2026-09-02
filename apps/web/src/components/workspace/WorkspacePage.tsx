import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchWorkspaceState } from '../../data/api';
import { Target, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function WorkspacePage() {
  const { data: state, loading, error, isStale, isDegraded } = useFetch(fetchWorkspaceState);

  return (
    <DataState loading={loading} error={error} empty={!state} isStale={isStale} isDegraded={isDegraded}>
      {state && (
        <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{state.header?.name}</h2>
              <p className="text-slate-500">{state.header?.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-600">Active Package:</span>
              <Badge variant="info">{state.activeWorkPackage}</Badge>
            </div>
          </div>

          <Card className="border-blue-200 shadow-sm">
            <CardContent className="p-6 bg-blue-50/30">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 rounded-lg text-blue-700 mt-1">
                  <Target className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wider mb-1">Current Objective</h3>
                  <p className="text-lg font-semibold text-slate-900">{state.objective?.title}</p>
                  <p className="text-slate-600 mt-1">{state.objective?.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader title="Execution Timeline" />
              <CardContent>
                <div className="flex flex-col">
                  {state.timeline?.map((item: { id: string; status: string; title: string; description: string; timestamp: string; duration?: string; logs?: string; time?: string; type?: string; }, i: number) => (
                    <div key={item.id} className="flex gap-4 mb-6 last:mb-0">
                      <div className="flex flex-col items-center">
                        {item.status === 'DONE' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                        {item.status === 'ACTIVE' && <div className="w-5 h-5 rounded-full bg-blue-500 ring-4 ring-blue-100 animate-pulse" />}
                        {item.status === 'PENDING' && <Circle className="w-5 h-5 text-slate-300" />}
                        {item.status === 'FAILED' && <AlertCircle className="w-5 h-5 text-red-500" />}
                        
                        {i !== state.timeline.length - 1 && (
                          <div className={`w-0.5 h-full mt-2 ${item.status === 'DONE' ? 'bg-green-200' : 'bg-slate-200'}`} />
                        )}
                      </div>
                      <div className="pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-500 w-12">{item.time}</span>
                          <span className={`font-medium ${item.status === 'ACTIVE' ? 'text-blue-700' : 'text-slate-900'}`}>
                            {item.title}
                          </span>
                        </div>
                        <div className="mt-1">
                          <Badge variant={item.type === 'GATE' ? 'warning' : item.type === 'REVIEW' ? 'governance' : 'neutral'}>
                            {item.type}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader title="Quick Links" />
                <CardContent className="p-4 flex flex-col gap-2">
                  <button className="text-left px-4 py-2 hover:bg-slate-50 rounded-md text-sm font-medium text-slate-700 border border-slate-100">
                    View Evidence Pack
                  </button>
                  <button className="text-left px-4 py-2 hover:bg-slate-50 rounded-md text-sm font-medium text-slate-700 border border-slate-100">
                    View Qualification Logs
                  </button>
                  <button className="text-left px-4 py-2 hover:bg-slate-50 rounded-md text-sm font-medium text-slate-700 border border-slate-100">
                    Agent Assignments
                  </button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </DataState>
  );
}
