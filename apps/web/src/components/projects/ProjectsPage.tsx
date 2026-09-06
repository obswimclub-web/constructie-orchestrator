import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchProjects } from '../../data/api';
import { GitBranch, Box, Activity, ShieldAlert } from 'lucide-react';
import { DataState } from '../ui/DataState';
import { useState } from 'react';
import { createProject } from '../../data/api';


export function ProjectsPage() {
  
  const { data: projects, loading, error, isStale, isDegraded, refetch } = useFetch(fetchProjects);
  
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [createError, setCreateError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!name || !slug) {
      setCreateError('Name and Repository Slug are required');
      return;
    }
    setIsSubmitting(true);
    try {
      await createProject(name, slug);
      await refetch();
      setIsCreating(false);
      setName('');
      setSlug('');
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="max-w-[1600px] mx-auto pb-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Projects</h2>
        
        <button onClick={() => setIsCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
          New Project
        </button>
      </div>

      {isCreating && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Create New Project</h3>
            {createError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{createError}</div>}
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Project Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Acme Backend" disabled={isSubmitting} />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-1">Repository Slug</label>
                <input type="text" value={slug} onChange={e => setSlug(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. acme/backend" disabled={isSubmitting} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50" disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


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
