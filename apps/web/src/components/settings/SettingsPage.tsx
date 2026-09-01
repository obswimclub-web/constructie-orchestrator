import { useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ShieldCheck, Key, Settings as SettingsIcon } from 'lucide-react';

const SETTINGS_SECTIONS = [
  'Providers', 'Models', 'Repositories', 'Environments', 
  'Governance', 'Security', 'Notifications', 'Railway', 
  'GitHub', 'Agent Configuration'
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('Providers');

  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col md:flex-row gap-8">
      <div className="w-full md:w-64 shrink-0">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
          <p className="text-slate-500 text-sm">Platform configuration</p>
        </div>
        <nav className="flex flex-col gap-1">
          {SETTINGS_SECTIONS.map(section => (
            <button
              key={section}
              onClick={() => setActiveTab(section)}
              className={`text-left px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === section 
                  ? 'bg-blue-50 text-blue-700 font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {section}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1">
        <Card className="min-h-[500px]">
          <div className="border-b border-slate-100 px-6 py-5">
            <h3 className="text-lg font-bold text-slate-900">{activeTab}</h3>
            <p className="text-sm text-slate-500 mt-1">Configure {activeTab.toLowerCase()} settings and parameters.</p>
          </div>
          
          <CardContent className="p-6">
            {activeTab === 'Security' || activeTab === 'GitHub' || activeTab === 'Railway' ? (
              <div className="max-w-2xl">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                  <h4 className="text-amber-800 font-bold flex items-center gap-2 text-sm mb-1">
                    <ShieldCheck className="w-4 h-4" /> Secret Management
                  </h4>
                  <p className="text-amber-700 text-sm">
                    Credentials and tokens are never stored in the UI. They are securely injected into the runtime environment via Railway variables. Update secrets via CLI or Railway Dashboard.
                  </p>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 border border-slate-200 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900 flex items-center gap-2">
                        {activeTab === 'GitHub' ? <Key className="w-4 h-4" /> : <Key className="w-4 h-4" />} 
                        API Token
                      </p>
                      <p className="text-sm text-slate-500 font-mono mt-1">ghp_***REDACTED***</p>
                    </div>
                    <Badge variant="success">Active</Badge>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-20 text-slate-400">
                <SettingsIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <h4 className="text-lg font-medium text-slate-600">Configuration panel for {activeTab}</h4>
                <p className="text-sm mt-1">Settings schema will be loaded dynamically.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
