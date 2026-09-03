import { useState } from 'react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchApprovals, decideApproval } from '../../data/api';
import { CheckSquare, ShieldCheck, XCircle, Search, Loader2, Clock, User, Link } from 'lucide-react';
import { DataState } from '../ui/DataState';
import type { Approval } from '../../types';

function ApprovalStatusBadge({ status }: { status: Approval['status'] }) {
  const variants: Record<Approval['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    USED: 'neutral',
    EXPIRED: 'danger',
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}

export function ApprovalsPage() {
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
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Owner Approvals</h2>
          <p className="text-slate-500">Centralized approval queue for governance gates</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search approvals..."
            className="pl-9 pr-4 py-2 bg-white border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-md text-sm outline-none transition-all w-64 shadow-sm"
          />
        </div>
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!approvals || approvals.length === 0}
        emptyMessage="All caught up. No pending approvals required."
        isStale={isStale}
        isDegraded={isDegraded}
      >
        <div className="grid grid-cols-1 gap-6">
          {approvals?.map(approval => (
            <Card key={approval.id} className="border-amber-200 shadow-md">
              <CardHeader
                title={`${approval.gateKind} AUTHORIZATION REQUIRED`}
                action={<ApprovalStatusBadge status={approval.status} />}
              />
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-4">

                    {/* Gate Kind & Target */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Gate Kind</p>
                        <p className="font-bold text-slate-900">{approval.gateKind}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Work Item</p>
                        <p className="font-mono text-sm text-slate-700">{approval.workItemId || '—'}</p>
                      </div>
                    </div>

                    {/* Scope */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Exact Scope</p>
                      <pre className="bg-slate-50 border border-slate-100 rounded p-2 text-xs font-mono overflow-x-auto text-slate-800">
                        {JSON.stringify(approval.scope, null, 2)}
                      </pre>
                    </div>

                    {/* Evidence Refs */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Evidence References</p>
                      {approval.evidenceRefs.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">No evidence refs attached</p>
                      ) : (
                        <ul className="space-y-1">
                          {approval.evidenceRefs.map((ref, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <Link className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                              <span className="text-slate-700">{ref.claim}</span>
                              <span className="text-slate-400 font-mono text-xs">[{ref.sourceRef}]</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Metadata Row */}
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        Requested by <strong>{approval.requestedBy}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(approval.requestedAt).toLocaleString()}
                      </span>
                      {approval.expiresAt && (
                        <span className="flex items-center gap-1 text-amber-600">
                          <Clock className="w-3 h-3" />
                          Expires {new Date(approval.expiresAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Post-Action Verification (if any) */}
                    {approval.postActionVerification && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Post-Action Verification</p>
                        <div className={`p-2 rounded text-sm border ${approval.postActionVerification.result === 'PASS' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                          {approval.postActionVerification.result} — {approval.postActionVerification.details || ''}
                          {approval.postActionVerification.sha && <span className="font-mono ml-2">[{approval.postActionVerification.sha.slice(0, 8)}]</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {approval.status === 'PENDING' && (
                    <div className="w-full md:w-64 flex flex-col gap-3 justify-center">
                      <button
                        disabled={processing[approval.id]}
                        onClick={() => handleDecision(approval.id, 'APPROVED')}
                        className={`w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-colors ${processing[approval.id] ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {processing[approval.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />} Authorize
                      </button>
                      <button
                        disabled={processing[approval.id]}
                        onClick={() => handleDecision(approval.id, 'REJECTED')}
                        className={`w-full py-2.5 bg-white hover:bg-slate-50 text-red-600 border border-slate-200 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-colors ${processing[approval.id] ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {processing[approval.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Reject
                      </button>
                      <button className="w-full py-2.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                        <ShieldCheck className="w-4 h-4" /> View Evidence Pack
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DataState>
    </div>
  );
}
