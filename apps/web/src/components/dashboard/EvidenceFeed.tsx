import { Card, CardHeader, CardContent } from '../ui/Card';
import { useFetch } from '../../data/hooks';
import { fetchEvidence } from '../../data/api';
import { DataState } from '../ui/DataState';

function getStatusColor(status: string) {
  switch (status) {
    case 'SUCCESS': return 'text-green-600 bg-green-100';
    case 'WARNING': return 'text-amber-600 bg-amber-100';
    case 'ERROR': return 'text-red-600 bg-red-100';
    case 'INFO': return 'text-blue-600 bg-blue-100';
    default: return 'text-slate-600 bg-slate-100';
  }
}

export function EvidenceFeed() {
  const { data: evidence, loading, error, isStale, isDegraded } = useFetch(fetchEvidence);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader title="Evidence & Activity" />
      <CardContent noPadding className="flex-1 overflow-y-auto relative">
        <DataState 
          loading={loading} 
          error={error} 
          empty={!evidence || evidence.length === 0} 
          emptyMessage="No activity"
          isStale={isStale}
          isDegraded={isDegraded}
        >
          <ul className="divide-y divide-slate-100">
            {evidence?.map((ev) => (
              <li key={ev.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${getStatusColor(ev.status).split(' ')[1].replace('bg-', 'bg-').replace('-100', '-500')}`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                      <span className="text-sm font-semibold text-slate-900 truncate">{ev.actor}</span>
                      <span className="text-xs text-slate-500 whitespace-nowrap ml-2">{ev.timestamp}</span>
                    </div>
                    <div className="text-xs font-medium text-slate-500 mb-1">{ev.type}</div>
                    <p className="text-sm text-slate-700">{ev.description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </DataState>
      </CardContent>
    </Card>
  );
}
