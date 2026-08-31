import { Search, Bell, UserCircle, ShieldCheck, AlertTriangle } from 'lucide-react';

export function Header() {
  return (
    <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="font-semibold text-slate-900 text-lg">Constructie Orchestrator</h1>
        <div className="h-4 w-px bg-slate-300 mx-2"></div>
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 rounded-md border border-amber-200 text-xs font-bold text-amber-700 tracking-wide uppercase">
          <AlertTriangle className="w-3.5 h-3.5" />
          Mock Data Environment
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
          <ShieldCheck className="w-4 h-4" />
          T0 Trusted Baseline
        </div>
        
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Global Search..." 
            className="pl-9 pr-4 py-1.5 bg-slate-100 border-transparent focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-md text-sm outline-none transition-all w-64"
          />
        </div>
        
        <button className="text-slate-500 hover:text-slate-700 relative">
          <Bell className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full"></span>
        </button>
        
        <button className="text-slate-500 hover:text-slate-700 flex items-center gap-2">
          <UserCircle className="w-6 h-6" />
          <span className="text-sm font-medium text-slate-700">Owner</span>
        </button>
      </div>
    </header>
  );
}
