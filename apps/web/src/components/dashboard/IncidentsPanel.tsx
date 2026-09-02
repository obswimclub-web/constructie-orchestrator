import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchIncidents } from '../../data/api';
import { DataState } from '../ui/DataState';

export function IncidentsPanel() {
  const { data: incidents, loading, error, isStale, isDegraded } = useFetch(fetchIncidents);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader title="Incidents" />
      <CardContent className="flex-1 overflow-y-auto relative">
        <DataState 
          loading={loading} 
          error={error} 
          empty={!incidents || incidents.length === 0}
          emptyMessage="No critical incidents"
          isStale={isStale}
          isDegraded={isDegraded}
        >
          <div className="flex flex-col gap-3">
            {incidents?.map(inc => (
              <div key={inc.id} className="p-3 bg-red-50 border border-red-100 rounded-md">
                <div className="flex justify-between items-start">
                  <Badge variant="danger">{inc.severity}</Badge>
                  <span className="text-xs text-slate-500">{inc.age}</span>
                </div>
                <h4 className="font-bold text-red-900 mt-2 text-sm">{inc.title}</h4>
                <div className="mt-2 text-xs font-medium text-red-700 flex justify-between">
                  <span>Run: {inc.runId}</span>
                  <span>{inc.status}</span>
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </CardContent>
    </Card>
  );
}
