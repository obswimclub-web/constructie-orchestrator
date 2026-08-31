import { Card, CardHeader, CardContent } from '../ui/Card';
import { ArrowRight, CheckCircle2, Circle, ShieldAlert, Zap } from 'lucide-react';
import { clsx } from 'clsx';

type NodeState = 'COMPLETED' | 'CURRENT' | 'WAITING' | 'OWNER_AUTHORITY_GATE' | 'REVIEW';

interface GraphNode {
  id: string;
  label: string;
  state: NodeState;
  autonomous?: boolean;
}

const nodes: GraphNode[] = [
  { id: '1', label: 'Owner Goal', state: 'COMPLETED' },
  { id: '2', label: 'Orchestrator', state: 'COMPLETED', autonomous: true },
  { id: '3', label: 'Agent Execution', state: 'COMPLETED', autonomous: true },
  { id: '4', label: 'Reviewer / Judge', state: 'COMPLETED', autonomous: true },
  { id: '5', label: 'Repair / Retry', state: 'COMPLETED', autonomous: true },
  { id: '6', label: 'Owner Gate', state: 'OWNER_AUTHORITY_GATE' },
  { id: '7', label: 'Commit', state: 'WAITING', autonomous: true },
  { id: '8', label: 'Push', state: 'WAITING' },
  { id: '9', label: 'Verify', state: 'WAITING', autonomous: true },
  { id: '10', label: 'Closure', state: 'WAITING' },
];

function NodeIcon({ state }: { state: NodeState; autonomous?: boolean }) {
  if (state === 'COMPLETED') return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  if (state === 'OWNER_AUTHORITY_GATE') return <ShieldAlert className="w-5 h-5 text-amber-500" />;
  if (state === 'CURRENT') return <Zap className="w-5 h-5 text-blue-500 fill-blue-500" />;
  if (state === 'REVIEW') return <ShieldAlert className="w-5 h-5 text-purple-500" />;
  return <Circle className="w-5 h-5 text-slate-300" />;
}

export function TaskGraph() {
  return (
    <Card className="h-full">
      <CardHeader title="Task Graph Workflow" subtitle="Canonical execution flow" />
      <CardContent className="flex items-center overflow-x-auto py-8 px-6">
        <div className="flex items-center min-w-max">
          {nodes.map((node, i) => (
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
              
              {i < nodes.length - 1 && (
                <div className="mx-2 text-slate-300">
                  <ArrowRight className={clsx("w-6 h-6", nodes[i].state === 'COMPLETED' ? "text-green-400" : "text-slate-200")} />
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
