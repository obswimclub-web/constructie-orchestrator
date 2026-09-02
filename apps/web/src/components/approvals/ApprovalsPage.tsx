import { useState } from 'react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchApprovals } from '../../data/api';
import { CheckSquare, ShieldCheck, XCircle, Search, Loader2 } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function ApprovalsPage() {
  const { data: approvals, loading, error, isStale, isDegraded, mutate } = useFetch(fetchApprovals);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const handleDecision = async (id: string, decision: unknown) => {
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
                title={approval.title} 
                action={<span className="text-sm text-slate-500">{approval.requestedAt}</span>} 
              />
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-6">
                    <div>
                      <p className="text-sm font-medium text-slate-500 mb-1">Work Package</p>
                      <p className="text-lg font-bold text-slate-900">{approval.workPackage}</p>
                    </div>
                    
                    <div className="flex flex-wrap gap-4">
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg min-w-[120px]">
                        <p className="text-xs text-slate-500 font-medium mb-1">Qualification</p>
                        <Badge variant={approval.qualificationStatus === 'PASS' ? 'success' : 'danger'}>{approval.qualificationStatus}</Badge>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg min-w-[120px]">
                        <p className="text-xs text-slate-500 font-medium mb-1">Reviewer</p>
                        <Badge variant={approval.reviewerStatus === 'PASS' ? 'success' : 'danger'}>{approval.reviewerStatus}</Badge>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg min-w-[120px]">
                        <p className="text-xs text-slate-500 font-medium mb-1">Security</p>
                        <Badge variant={approval.securityStatus === 'PASS' ? 'success' : 'danger'}>{approval.securityStatus}</Badge>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg min-w-[120px]">
                        <p className="text-xs text-slate-500 font-medium mb-1">Candidate Files</p>
                        <span className="font-semibold text-slate-900">{approval.candidateFiles} paths</span>
                      </div>
                    </div>
                  </div>

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
                </div>

              </CardContent>
            </Card>
          ))}
        </div>
      </DataState>
    </div>
  );
}
