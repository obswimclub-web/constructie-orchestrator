import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, FolderKanban, Briefcase, Network, 
  Bot, PlayCircle, CheckSquare, ShieldAlert, 
  History, AlertOctagon, Activity, Settings 
} from 'lucide-react';
import { clsx } from 'clsx';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/workspace', label: 'Workspace', icon: Briefcase },
  { path: '/task-graph', label: 'Task Graph', icon: Network },
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/runs', label: 'Runs', icon: PlayCircle },
  { path: '/reviewer-findings', label: 'Reviewer Findings', icon: ShieldAlert },
  { path: '/approvals', label: 'Owner Approvals', icon: CheckSquare, badge: 1 },
  { path: '/evidence', label: 'Evidence', icon: History },
  { path: '/incidents', label: 'Incidents', icon: AlertOctagon },
  { path: '/logs', label: 'Logs', icon: Activity },
  { path: '/settings', label: 'Settings / Providers', icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0">
      <div className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => clsx(
              'flex items-center justify-between px-3 py-2 rounded-md transition-colors text-sm font-medium',
              isActive ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className="w-4 h-4" />
              {item.label}
            </div>
            {item.badge && (
              <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
