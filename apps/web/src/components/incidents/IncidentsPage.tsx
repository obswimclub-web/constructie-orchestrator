import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { mockIncidents } from '../../data/mock';
import { AlertTriangle, ShieldCheck, Activity } from 'lucide-react';

export function IncidentsPage() {
  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Incidents</h2>
          <p className="text-slate-500">Security and operational incident tracker</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {mockIncidents.length === 0 ? (
          <Card>
            <CardContent className="py-16 flex flex-col items-center justify-center text-slate-500">
              <ShieldCheck className="w-12 h-12 text-green-500 mb-3 opacity-80" />
              <p className="text-lg font-medium text-slate-900">System Healthy</p>
              <p>No active incidents.</p>
            </CardContent>
          </Card>
        ) : (
          mockIncidents.map(inc => (
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
          ))
        )}
      </div>
    </div>
  );
}
