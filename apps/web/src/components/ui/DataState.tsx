import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

export function DataState({ 
  loading, error, empty, isStale = false, isDegraded = false, children, emptyMessage = "No data available" 
}: { 
  loading: boolean, error: Error | null, empty: boolean, isStale?: boolean, isDegraded?: boolean, children: React.ReactNode, emptyMessage?: string 
}) {
  if (loading) {
    return (
      <div className="flex justify-center items-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700 flex flex-col items-center justify-center text-center">
        <AlertTriangle className="w-8 h-8 mb-2 text-red-500" />
        <p className="font-semibold">Failed to load data</p>
        <p className="text-sm mt-1">{error.message}</p>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="p-12 text-center text-slate-500 bg-slate-50 border border-slate-200 rounded-lg border-dashed">
        <p>{emptyMessage}</p>
      </div>
    );
  }
  
  return (
    <div className="relative w-full h-full">
      {(isStale || isDegraded) && (
        <div className="absolute top-0 right-0 -mt-2 -mr-2 flex gap-2 z-10">
          {isStale && (
            <div className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full flex items-center gap-1 shadow-sm border border-yellow-200">
              <Clock className="w-3 h-3" /> Stale
            </div>
          )}
          {isDegraded && (
            <div className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded-full flex items-center gap-1 shadow-sm border border-orange-200">
              <AlertTriangle className="w-3 h-3" /> Degraded
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
