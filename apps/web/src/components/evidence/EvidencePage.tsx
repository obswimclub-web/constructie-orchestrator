import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { mockEvidence } from '../../data/mock';
import { FileKey, ShieldCheck, History } from 'lucide-react';

export function EvidencePage() {
  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Evidence & Artifacts</h2>
          <p className="text-slate-500">Cryptographically secure attestations and logs</p>
        </div>
      </div>

      <Card>
        <CardContent noPadding className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-medium">
              <tr>
                <th className="px-6 py-4">Artifact</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Producer</th>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Trust Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mockEvidence.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      <FileKey className="w-4 h-4 text-slate-400" />
                      {ev.description}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-1">SHA256: d88f9f9e...bb0aa7972</div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant="neutral">{ev.type}</Badge>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-700">{ev.actor}</td>
                  <td className="px-6 py-4 text-slate-500 flex items-center gap-1.5 mt-1">
                    <History className="w-3.5 h-3.5" /> {ev.timestamp}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={ev.status === 'SUCCESS' ? 'success' : ev.status === 'WARNING' ? 'warning' : ev.status === 'ERROR' ? 'danger' : 'info'}>
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> VERIFIED
                      </span>
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
