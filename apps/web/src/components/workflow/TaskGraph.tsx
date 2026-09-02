import { Card, CardHeader, CardContent } from '../ui/Card';
import { ArrowRight, CheckCircle2, Circle, ShieldAlert, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { useFetch } from '../../data/hooks';
import { fetchTaskGraph, GraphNode, NodeState } from '../../data/api';
import { DataState } from '../ui/DataState';





function NodeIcon({ state }: { state: NodeState; autonomous?: boolean }) {
  if (state === 'COMPLETED') return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  if (state === 'OWNER_AUTHORITY_GATE') return <ShieldAlert className="w-5 h-5 text-amber-500" />;
  if (state === 'CURRENT') return <Zap className="w-5 h-5 text-blue-500 fill-blue-500" />;
  if (state === 'REVIEW') return <ShieldAlert className="w-5 h-5 text-purple-500" />;
  return <Circle className="w-5 h-5 text-slate-300" />;
}

export function TaskGraph() {
  const { data: nodes, loading, error, isStale, isDegraded } = useFetch(fetchTaskGraph);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader title="Task Graph Workflow" subtitle="Canonical execution flow" />
      <CardContent className="flex-1 flex items-center overflow-x-auto py-8 px-6 relative">
        <DataState 
          loading={loading} 
          error={error} 
          empty={!nodes || nodes.length === 0} 
          emptyMessage="No task graph available"
          isStale={isStale}
          isDegraded={isDegraded}
        >
          <div className="flex items-center min-w-max">
            {nodes?.map((node: GraphNode, i: number) => (
              <div key={node.id} className="flex items-center">
                <div className={clsx(
                  "flex flex-col items-center justify-center p-3 rounded-lg border-2 w-36 text-center transition-all bg-white relative",
                  node.state === 'COMPLETED' && "border-green-200 shadow-sm",
                  node.state === 'CURRENT' && "border-blue-400 shadow-md scale-105",
                  node.state === 'OWNER_AUTHORITY_GATE' && "border-amber-400 shadow-md ring-4 ring-amber-100",
                  node.state === 'WAITING' && "border-slate-200 border-dashed opacity-70"
                )}>
                  {node.autonomous && (
                    <div className="absolute -top-2.5 bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Auto</div>
                  )}
                  <NodeIcon state={node.state} autonomous={node.autonomous} />
                  <span className={clsx(
                    "mt-2 text-xs font-semibold",
                    node.state === 'COMPLETED' ? "text-slate-700" :
                    node.state === 'OWNER_AUTHORITY_GATE' ? "text-amber-700" :
                    node.state === 'CURRENT' ? "text-blue-700" : "text-slate-500"
                  )}>
                    {node.label}
                  </span>
                </div>
                
                {i < (nodes?.length || 0) - 1 && (
                  <div className="mx-2 text-slate-300">
                    <ArrowRight className={clsx("w-6 h-6", nodes[i].state === 'COMPLETED' ? "text-green-400" : "text-slate-200")} />
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
