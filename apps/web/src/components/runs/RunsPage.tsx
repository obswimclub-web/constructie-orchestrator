import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchRunDetails } from '../../data/api';
import { PlayCircle, ShieldCheck, Clock, CheckSquare } from 'lucide-react';
import { DataState } from '../ui/DataState';
import { useState } from 'react';
import { createWorkItem } from '../../data/api';


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
  
  const { data: runs, loading, error, isStale, isDegraded, refetch } = useFetch(fetchRunDetails);
  
  const [isStarting, setIsStarting] = useState(false);
  const [objective, setObjective] = useState('');
  const [startError, setStartError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStartError('');
    if (!objective) {
      setStartError('Objective is required');
      return;
    }
    setIsSubmitting(true);
    try {
      await createWorkItem(objective);
      await refetch();
      setIsStarting(false);
      setObjective('');
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="max-w-[1600px] mx-auto pb-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Execution Runs</h2>
        <div className="flex gap-2">
          <button disabled title="Coming later" className="bg-slate-50 border border-slate-200 text-slate-400 px-4 py-2 rounded-md text-sm font-medium cursor-not-allowed">
            Filter (Coming later)
          </button>
          
          <button onClick={() => setIsStarting(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
            Start New Run
          </button>
        </div>
      </div>

      {isStarting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Start New Run</h3>
            {startError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{startError}</div>}
            <form onSubmit={handleStart}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-1">Objective</label>
                <textarea value={objective} onChange={e => setObjective(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Implement user authentication..." rows={3} disabled={isSubmitting} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsStarting(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50" disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50" disabled={isSubmitting}>
                  {isSubmitting ? 'Starting...' : 'Start Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      <Card>
        <CardContent noPadding className="overflow-x-auto relative min-h-[200px]">
          <DataState 
            loading={loading} 
            error={error} 
            empty={!runs || runs.length === 0} 
            emptyMessage="No execution runs found"
            isStale={isStale}
            isDegraded={isDegraded}
          >
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
                {runs?.map(run => (
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
          </DataState>
        </CardContent>
      </Card>
    </div>
  );
}
