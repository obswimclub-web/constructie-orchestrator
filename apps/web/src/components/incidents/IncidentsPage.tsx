import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchIncidents } from '../../data/api';
import { AlertTriangle, Activity } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function IncidentsPage() {
  const { data: incidents, loading, error, isStale, isDegraded } = useFetch(fetchIncidents);

  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Incidents</h2>
          <p className="text-slate-500">Security and operational incident tracker</p>
        </div>
      </div>

      <DataState 
        loading={loading} 
        error={error} 
        empty={!incidents || incidents.length === 0} 
        emptyMessage="No active incidents."
        isStale={isStale}
        isDegraded={isDegraded}
      >
        <div className="flex flex-col gap-4">
          {incidents?.map(inc => (
            <Card key={inc.id} className="border-red-200 shadow-sm">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                      <h3 className="text-lg font-bold text-slate-900">{inc.title}</h3>
                      <Badge variant="danger">{inc.severity}</Badge>
                      <Badge variant="neutral">{inc.status}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 mb-4">Run context: <span className="font-mono bg-slate-50 p-1 rounded border border-slate-100">{inc.runId}</span></p>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                    <Activity className="w-4 h-4" />
                    Detected {inc.age}
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
