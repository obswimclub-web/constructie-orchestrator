import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { mockIncidents } from '../../data/mock';
import { ShieldCheck } from 'lucide-react';

export function IncidentsPanel() {
  return (
    <Card className="h-full">
      <CardHeader title="Incidents" />
      <CardContent className={mockIncidents.length === 0 ? "flex items-center justify-center h-48" : ""}>
        {mockIncidents.length === 0 ? (
          <div className="flex flex-col items-center text-slate-400">
            <ShieldCheck className="w-12 h-12 mb-3 text-green-500 opacity-80" />
            <p className="text-sm font-medium text-slate-600">No critical incidents</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {mockIncidents.map(inc => (
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
        )}
      </CardContent>
    </Card>
  );
}
