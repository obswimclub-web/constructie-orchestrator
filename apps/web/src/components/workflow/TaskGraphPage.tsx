import { TaskGraph } from './TaskGraph';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Network, Activity, Settings2 } from 'lucide-react';

export function TaskGraphPage() {
  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Workflow Task Graph</h2>
          <p className="text-slate-500">Interactive node-based workflow visualization</p>
        </div>
        <div className="flex gap-2">
          <button className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Settings2 className="w-4 h-4" /> Layout
          </button>
        </div>
      </div>

      <div className="h-[400px]">
        <TaskGraph />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Node Details" subtitle="Select a node in the graph to view details" action={<Network className="w-5 h-5 text-slate-400" />} />
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
            <Network className="w-12 h-12 mb-3 text-slate-200" />
            <p>Interactive details panel</p>
            <p className="text-sm">Click any node above to inspect its state, inputs, and outputs.</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader title="Execution Trace" action={<Activity className="w-5 h-5 text-slate-400" />} />
          <CardContent className="py-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">Autonomous Execution Mode</span>
                <span className="text-blue-600 font-bold">OVERNIGHT</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">Repair Loops Detected</span>
                <span className="text-slate-900">0</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">Independent Verifications</span>
                <span className="text-slate-900">2</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">Pending Owner Gates</span>
                <span className="text-amber-600 font-bold">1</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
