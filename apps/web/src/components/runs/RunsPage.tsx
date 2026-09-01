import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { mockRunDetails } from '../../data/mock';
import { PlayCircle, ShieldCheck, Clock, CheckSquare } from 'lucide-react';

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

export function RunsPage() {
  return (
    <div className="max-w-[1600px] mx-auto pb-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Execution Runs</h2>
        <div className="flex gap-2">
          <button className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors">
            Filter
          </button>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
            Start New Run
          </button>
        </div>
      </div>

      <Card>
        <CardContent noPadding className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-medium">
              <tr>
                <th className="px-6 py-4">Run / Title</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Current Agent</th>
                <th className="px-6 py-4">Reviewer</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4">Evidence</th>
                <th className="px-6 py-4">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mockRunDetails.map(run => (
                <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-blue-500" />
                      {run.title}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 ml-6">{run.id} • Started {run.startedAt}</div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={getStatusVariant(run.status)}>{run.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-slate-700">{run.currentAgent}</td>
                  <td className="px-6 py-4 text-slate-700">{run.reviewer}</td>
                  <td className="px-6 py-4 text-slate-600 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {run.duration}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={run.evidenceState === 'SECURED' ? 'success' : run.evidenceState === 'FAILED' ? 'danger' : 'neutral'}>
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> {run.evidenceState}
                      </span>
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={run.approvalState === 'APPROVED' ? 'success' : run.approvalState === 'PENDING' ? 'warning' : 'neutral'}>
                      <span className="flex items-center gap-1">
                        <CheckSquare className="w-3 h-3" /> {run.approvalState}
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
