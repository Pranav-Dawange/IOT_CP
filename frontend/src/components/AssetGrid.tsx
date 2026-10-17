import React from 'react';
import { Cpu, RefreshCw, SearchX } from 'lucide-react';
import { Asset } from '../types';
import { AssetCard } from './AssetCard';

interface AssetGridProps {
  assets: Asset[];
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  isLoading: boolean;
  onResetFilters?: () => void;
}

export const AssetGrid: React.FC<AssetGridProps> = ({
  assets,
  selectedAssetId,
  onSelectAsset,
  isLoading,
  onResetFilters,
}) => {
  if (isLoading && assets.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-slate-200">Loading Industrial Assets...</h3>
        <p className="text-xs text-slate-400 mt-1">
          Querying backend device registry and TimescaleDB status tables.
        </p>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center">
        <SearchX className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-slate-200">No Industrial Assets Match Filters</h3>
        <p className="text-xs text-slate-400 mt-1">
          Try selecting "All Lines" or "All Statuses", or clear your search query.
        </p>
        {onResetFilters && (
          <button
            onClick={onResetFilters}
            className="mt-4 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
          >
            Reset Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {assets.map((asset) => (
        <AssetCard
          key={asset.asset_id}
          asset={asset}
          isSelected={asset.asset_id === selectedAssetId}
          onSelect={onSelectAsset}
        />
      ))}
    </div>
  );
};
