import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchProjects } from '../../data/api';
import { GitBranch, Box, Activity, ShieldAlert } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function ProjectsPage() {
  const { data: projects, loading, error, isStale, isDegraded } = useFetch(fetchProjects);

  return (
    <div className="max-w-[1600px] mx-auto pb-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Projects</h2>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
          New Project
        </button>
      </div>

      <DataState 
        loading={loading} 
        error={error} 
        empty={!projects || projects.length === 0} 
        emptyMessage="No projects found."
        isStale={isStale}
        isDegraded={isDegraded}
      >
        <div className="grid grid-cols-1 gap-4">
          {projects?.map(project => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-slate-900">{project.name}</h3>
                      <Badge variant={project.status === 'ACTIVE' ? 'success' : 'warning'}>{project.status}</Badge>
                      <Badge variant={project.health === 'HEALTHY' ? 'success' : 'danger'}>
                        {project.health}
                      </Badge>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Box className="w-4 h-4" />
                        {project.repository}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <GitBranch className="w-4 h-4" />
                        {project.branch}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap md:flex-nowrap items-center gap-6 bg-slate-50 p-4 rounded-lg border border-slate-100">
                    <div>
                      <p className="text-xs text-slate-500 font-medium mb-1">Current Work Package</p>
                      <p className="text-sm font-semibold text-slate-900">{project.currentWorkPackage || 'None'}</p>
                    </div>
                    
                    <div className="h-10 w-px bg-slate-200 hidden md:block"></div>
                    
                    <div>
                      <p className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" /> Approvals
                      </p>
                      <p className="text-sm font-semibold text-slate-900">{project.openApprovals}</p>
                    </div>

                    <div className="h-10 w-px bg-slate-200 hidden md:block"></div>
                    
                    <div>
                      <p className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5" /> Incidents
                      </p>
                      <p className="text-sm font-semibold text-slate-900">{project.openIncidents}</p>
                    </div>
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
