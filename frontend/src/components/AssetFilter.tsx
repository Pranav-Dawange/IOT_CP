import React from 'react';
import { Filter, Search, X } from 'lucide-react';
import { AssetLine, AssetStatusType } from '../types';

interface AssetFilterProps {
  selectedLine: string;
  selectedStatus: string;
  searchTerm: string;
  onSelectLine: (line: string) => void;
  onSelectStatus: (status: string) => void;
  onSearchChange: (search: string) => void;
  onResetFilters: () => void;
  totalMatching: number;
}

const LINES: { label: string; value: string }[] = [
  { label: 'All Lines', value: 'all' },
  { label: 'Line A (01–05)', value: 'lineA' },
  { label: 'Line B (06–10)', value: 'lineB' },
  { label: 'Line C (11–15)', value: 'lineC' },
  { label: 'Line D (16–20)', value: 'lineD' },
];

const STATUSES: { label: string; value: string }[] = [
  { label: 'All Statuses', value: 'all' },
  { label: 'Online', value: 'ONLINE' },
  { label: 'Disconnected', value: 'DISCONNECTED' },
  { label: 'Exhausted', value: 'EXHAUSTED' },
];

export const AssetFilter: React.FC<AssetFilterProps> = ({
  selectedLine,
  selectedStatus,
  searchTerm,
  onSelectLine,
  onSelectStatus,
  onSearchChange,
  onResetFilters,
  totalMatching,
}) => {
  const hasActiveFilters = selectedLine !== 'all' || selectedStatus !== 'all' || searchTerm.trim() !== '';

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {/* Line filter pills */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
          <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
          {LINES.map((line) => (
            <button
              key={line.value}
              onClick={() => onSelectLine(line.value)}
              className={`px-2.5 py-1 rounded transition-colors font-medium ${
                selectedLine === line.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {line.label}
            </button>
          ))}
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
          {STATUSES.map((status) => (
            <button
              key={status.value}
              onClick={() => onSelectStatus(status.value)}
              className={`px-2.5 py-1 rounded transition-colors font-medium ${
                selectedStatus === status.value
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1 md:w-56">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search asset or type..."
            className="w-full bg-slate-950 border border-slate-800 rounded-md pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Reset button if filtered */}
        {hasActiveFilters && (
          <button
            onClick={onResetFilters}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Reset filters"
          >
            <X className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}

        <span className="text-slate-400 font-mono whitespace-nowrap pl-1">
          {totalMatching} {totalMatching === 1 ? 'asset' : 'assets'}
        </span>
      </div>
    </div>
  );
};
