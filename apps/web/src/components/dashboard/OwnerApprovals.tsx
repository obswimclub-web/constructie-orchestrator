import { useState } from 'react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchApprovals } from '../../data/api';
import { DataState } from '../ui/DataState';
import { Loader2 } from 'lucide-react';

export function OwnerApprovals() {
  const { data: approvals, loading, error, isStale, isDegraded, mutate } = useFetch(fetchApprovals);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const handleDecision = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setProcessing(p => ({ ...p, [id]: true }));
    try {
      console.log("Mutation disabled in P4 candidate", decision);
      if (approvals) {
        mutate(approvals.filter(a => a.id !== id));
      }
    } catch (err) {
      console.error('Failed to submit decision:', err);
    } finally {
      setProcessing(p => ({ ...p, [id]: false }));
    }
  };

  return (
    <Card className="h-full border-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.1)] flex flex-col">
      <CardHeader 
        title="Owner Approvals Required" 
        action={<Badge variant="warning">{approvals?.length || 0} Pending</Badge>}
      />
      <CardContent className="flex-1 overflow-y-auto relative">
        <DataState 
          loading={loading} 
          error={error} 
          empty={!approvals || approvals.length === 0}
          emptyMessage="No pending approvals."
          isStale={isStale}
          isDegraded={isDegraded}
        >
          <div className="flex flex-col gap-4">
            {approvals?.map(approval => (
              <div key={approval.id} className="bg-amber-50 rounded-lg p-4 border border-amber-100 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-amber-900">{approval.title}</h4>
                    <p className="text-sm text-amber-700 mt-1">Package: {approval.workPackage}</p>
                  </div>
                  <span className="text-xs text-amber-600 font-medium">{approval.requestedAt}</span>
                </div>
                
                <div className="flex gap-2">
                  <Badge variant="success">Qual: {approval.qualificationStatus}</Badge>
                  <Badge variant="success">Review: {approval.reviewerStatus}</Badge>
                  <Badge variant="success">Sec: {approval.securityStatus}</Badge>
                  <Badge variant="neutral">{approval.candidateFiles} files</Badge>
                </div>
                
                <div className="flex gap-2 mt-2">
                  <button 
                    disabled={processing[approval.id]} 
                    onClick={() => handleDecision(approval.id, 'APPROVED')}
                    className="px-4 py-1.5 bg-green-600 text-white rounded-md text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {processing[approval.id] && <Loader2 className="w-3 h-3 animate-spin" />} Approve
                  </button>
                  <button 
                    disabled={processing[approval.id]} 
                    onClick={() => handleDecision(approval.id, 'REJECTED')}
                    className="px-4 py-1.5 bg-red-600 text-white rounded-md text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {processing[approval.id] && <Loader2 className="w-3 h-3 animate-spin" />} Reject
                  </button>
                  <button className="px-4 py-1.5 bg-white border border-amber-200 text-amber-800 rounded-md text-sm font-semibold hover:bg-amber-100 transition-colors">
                    View Evidence
                  </button>
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </CardContent>
    </Card>
  );
}
