import { useState } from 'react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchApprovals, decideApproval } from '../../data/api';
import { DataState } from '../ui/DataState';
import { Loader2, Clock, Link } from 'lucide-react';
import type { Approval } from '../../types';

function statusVariant(status: Approval['status']): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'PENDING') return 'warning';
  if (status === 'APPROVED' || status === 'USED') return 'success';
  return 'danger';
}

export function OwnerApprovals() {
  const { data: approvals, loading, error, isStale, isDegraded, mutate } = useFetch(fetchApprovals);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const handleDecision = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setProcessing(p => ({ ...p, [id]: true }));
    try {
      const updated = await decideApproval(id, decision);
      if (approvals) {
        mutate(approvals.map(a => a.id === id ? updated : a).filter(a => a.status === 'PENDING'));
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
                    <h4 className="font-bold text-amber-900">{approval.gateKind}</h4>
                    <p className="text-xs text-amber-700 mt-0.5 font-mono">{approval.workItemId || 'No work item'}</p>
                  </div>
                  <Badge variant={statusVariant(approval.status)}>{approval.status}</Badge>
                </div>

                {/* Scope summary */}
                <div className="text-xs text-amber-800 bg-amber-100 rounded p-2 font-mono break-all">
                  {JSON.stringify(approval.scope)}
                </div>

                {/* Evidence refs */}
                {approval.evidenceRefs.length > 0 && (
                  <div className="space-y-1">
                    {approval.evidenceRefs.map((ref, i) => (
                      <p key={i} className="text-xs text-amber-700 flex items-center gap-1">
                        <Link className="w-3 h-3 shrink-0" />
                        {ref.claim}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-amber-600">
                  <Clock className="w-3 h-3" />
                  {new Date(approval.requestedAt).toLocaleString()}
                  {approval.expiresAt && (
                    <span className="ml-2 text-red-500">Expires {new Date(approval.expiresAt).toLocaleString()}</span>
                  )}
                </div>

                {/* Post-action verification */}
                {approval.postActionVerification && (
                  <div className={`text-xs rounded p-1.5 border ${approval.postActionVerification.result === 'PASS' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    Verified: {approval.postActionVerification.result} at {approval.postActionVerification.verifiedAt}
                  </div>
                )}

                {approval.status === 'PENDING' && (
                  <div className="flex gap-2 mt-1">
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
                      Evidence
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DataState>
      </CardContent>
    </Card>
  );
}
