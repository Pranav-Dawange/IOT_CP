"""
Device Registry and Synthetic Asset Assignment for Phase 4 Simulator.

Enforces the exact synthetic asset assignment scheme from Phases 1–3:
- 10,000 ordered AI4I 2020 rows
- 20 synthetic assets (asset_01 to asset_20)
- Exactly 500 contiguous rows per asset (e.g. asset_01 -> [0..499], asset_02 -> [500..999])
- Strictly preserves original CSV row ordering within each asset's slice.

METHODOLOGICAL NOTE:
Each 500-row slice represents an assigned synthetic trajectory. AI4I does not provide genuine
machine-level chronological histories; line, asset_type, and location are simulation metadata.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

from simulator.models import AssetConfig

# Default distribution across 4 production lines
LINE_DISTRIBUTION = {
    "lineA": ["asset_01", "asset_02", "asset_03", "asset_04", "asset_05"],
    "lineB": ["asset_06", "asset_07", "asset_08", "asset_09", "asset_10"],
    "lineC": ["asset_11", "asset_12", "asset_13", "asset_14", "asset_15"],
    "lineD": ["asset_16", "asset_17", "asset_18", "asset_19", "asset_20"],
}

ASSET_TYPES = ["motor", "pump", "compressor", "spindle_drive"]


def build_default_assets_registry() -> Dict[str, AssetConfig]:
    """
    Construct default registry of 20 synthetic industrial assets mapping 10,000 rows.
    500 contiguous rows per asset.
    """
    registry: Dict[str, AssetConfig] = {}
    rows_per_asset = 500

    for i in range(1, 21):
        asset_id = f"asset_{i:02d}"
        row_start = (i - 1) * rows_per_asset
        row_end = (i * rows_per_asset) - 1

        # Determine line
        assigned_line = "lineA"
        for line_name, asset_list in LINE_DISTRIBUTION.items():
            if asset_id in asset_list:
                assigned_line = line_name
                break

        asset_type = ASSET_TYPES[(i - 1) % len(ASSET_TYPES)]
        cell_num = ((i - 1) % 5) + 1
        location = f"Factory-1-{assigned_line}-Cell-{cell_num:02d}"

        config = AssetConfig(
            asset_id=asset_id,
            asset_type=asset_type,
            line=assigned_line,
            location=location,
            firmware_version=f"1.{(i % 3) + 1}.0",
            sampling_interval_ms=1000,
            source_row_start=row_start,
            source_row_end=row_end,
            enabled=True,
        )
        registry[asset_id] = config

    return registry


class DeviceRegistry:
    """
    Manages loading, validation, and querying of the device registry.
    """

    def __init__(self, registry_file: Optional[Path] = None):
        self.registry_file = registry_file or (Path(__file__).parent / "assets_registry.json")
        self._assets: Dict[str, AssetConfig] = {}
        self.load_or_create()

    def load_or_create(self) -> None:
        """Load registry from JSON file if it exists, otherwise generate default and save."""
        if self.registry_file.is_file():
            self.load_from_json(self.registry_file)
        else:
            self._assets = build_default_assets_registry()
            self.save_to_json(self.registry_file)

    def load_from_json(self, path: Path) -> None:
        """Load asset configurations from JSON file."""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self._assets = {}
        for item in data.get("assets", []):
            cfg = AssetConfig(**item)
            self._assets[cfg.asset_id] = cfg

        self.validate()

    def save_to_json(self, path: Path) -> None:
        """Save current asset configurations to JSON file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": "1.0.0",
            "description": "Synthetic Industrial Device Registry for AI4I 2020 Predictive Maintenance System",
            "total_assets": len(self._assets),
            "assets": [cfg.to_dict() for cfg in self._assets.values()],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def validate(self) -> None:
        """
        Validate registry integrity:
        - Exactly 20 assets
        - All asset IDs follow 'asset_01' .. 'asset_20'
        - Contiguous, non-overlapping slices
        - Exactly covers rows 0 through 9999
        - Each asset has exactly 500 rows
        """
        if len(self._assets) != 20:
            raise ValueError(f"Registry must contain exactly 20 assets, found {len(self._assets)}")

        expected_ids = [f"asset_{i:02d}" for i in range(1, 21)]
        missing_ids = [aid for aid in expected_ids if aid not in self._assets]
        if missing_ids:
            raise ValueError(f"Missing expected asset IDs: {missing_ids}")

        # Check contiguous non-overlapping coverage
        sorted_assets = sorted(self._assets.values(), key=lambda a: a.source_row_start)
        current_expected_start = 0

        for idx, asset in enumerate(sorted_assets):
            if asset.source_row_start != current_expected_start:
                raise ValueError(
                    f"Asset '{asset.asset_id}' starts at row {asset.source_row_start}, "
                    f"expected {current_expected_start}"
                )
            expected_end = current_expected_start + 499
            if asset.source_row_end != expected_end:
                raise ValueError(
                    f"Asset '{asset.asset_id}' ends at row {asset.source_row_end}, "
                    f"expected {expected_end}"
                )
            if asset.total_source_rows != 500:
                raise ValueError(
                    f"Asset '{asset.asset_id}' row count is {asset.total_source_rows}, expected 500"
                )
            current_expected_start = expected_end + 1

        if current_expected_start != 10000:
            raise ValueError(
                f"Registry must cover exactly 10,000 rows (0..9999), ended at {current_expected_start - 1}"
            )

    # Alias for explicit naming
    validate_registry_integrity = validate

    def get_asset(self, asset_id: str) -> AssetConfig:
        if asset_id not in self._assets:
            raise KeyError(f"Asset '{asset_id}' not found in registry.")
        return self._assets[asset_id]

    def get_all_assets(self, enabled_only: bool = True) -> List[AssetConfig]:
        assets = list(self._assets.values())
        if enabled_only:
            assets = [a for a in assets if a.enabled]
        return sorted(assets, key=lambda a: a.asset_id)

    def get_assets_by_line(self, line: str) -> List[AssetConfig]:
        return [a for a in self._assets.values() if a.line == line]
