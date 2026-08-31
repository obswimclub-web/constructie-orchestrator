import { KPIRow } from './KPIRow';
import { ProjectWorkspace } from './ProjectWorkspace';
import { TaskGraph } from '../workflow/TaskGraph';
import { AgentsPanel } from './AgentsPanel';
import { OwnerApprovals } from './OwnerApprovals';
import { EvidenceFeed } from './EvidenceFeed';
import { IncidentsPanel } from './IncidentsPanel';

export function Dashboard() {
  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-10">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Dashboard</h2>
        <KPIRow />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[400px]">
        <div className="lg:col-span-2 h-full">
          <ProjectWorkspace />
        </div>
        <div className="h-full">
          <OwnerApprovals />
        </div>
      </div>
      
      <div className="h-[200px]">
        <TaskGraph />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 h-[400px]">
        <div className="lg:col-span-2 h-full">
          <AgentsPanel />
        </div>
        <div className="h-full">
          <EvidenceFeed />
        </div>
        <div className="h-full">
          <IncidentsPanel />
        </div>
      </div>
    </div>
  );
}
