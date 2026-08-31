import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { mockApprovals } from '../../data/mock';

export function OwnerApprovals() {
  return (
    <Card className="h-full border-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.1)]">
      <CardHeader 
        title="Owner Approvals Required" 
        action={<Badge variant="warning">{mockApprovals.length} Pending</Badge>}
      />
      <CardContent className="flex flex-col gap-4">
        {mockApprovals.map(approval => (
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
              <button disabled className="px-4 py-1.5 bg-green-600 text-white rounded-md text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50">Approve</button>
              <button disabled className="px-4 py-1.5 bg-red-600 text-white rounded-md text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50">Reject</button>
              <button disabled className="px-4 py-1.5 bg-white border border-amber-200 text-amber-800 rounded-md text-sm font-semibold hover:bg-amber-100 transition-colors disabled:opacity-50">View Evidence</button>
            </div>
          </div>
        ))}
        {mockApprovals.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            No pending approvals.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
