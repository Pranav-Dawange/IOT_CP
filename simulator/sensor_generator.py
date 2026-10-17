"""
Sensor Data Generator with Explicit Fault Injection for Phase 4 Simulator.

Responsibilities:
1. Loads raw AI4I observations from data/raw/ai4i2020.csv for a specific asset slice [source_row_start, source_row_end].
2. Strictly preserves chronological row order within the slice.
3. Extracts ONLY the five raw ML sensor features:
   - Air temperature [K]
   - Process temperature [K]
   - Rotational speed [rpm]
   - Torque [Nm]
   - Tool wear [min]
4. NEVER includes ground truth failure labels (Machine failure, TWF, HDF, PWF, OSF, RNF) or metadata identifiers.
5. Provides valid telemetry generation with optional realistic sensor noise.
6. Provides an EXPLICIT, isolated fault injection path that deliberately generates
   missing-field, wrong-type, null-value, or corrupted-json messages without silent repair.
"""

import json
import random
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

from simulator.models import (
    FaultInjectionConfig,
    MalformedType,
    PROHIBITED_LEAKAGE_COLUMNS,
    RAW_SENSOR_FEATURE_NAMES,
    TelemetryPayload,
)

DEFAULT_RAW_CSV_PATH = Path("data/raw/ai4i2020.csv")


class SensorDataGenerator:
    """
    Manages reading and emitting sensor observations from an assigned AI4I source slice.
    """

    def __init__(
        self,
        asset_id: str,
        source_row_start: int,
        source_row_end: int,
        csv_path: Optional[Path] = None,
        fault_config: Optional[FaultInjectionConfig] = None,
    ):
        self.asset_id = asset_id
        self.source_row_start = source_row_start
        self.source_row_end = source_row_end
        self.slice_length = source_row_end - source_row_start + 1
        self.fault_config = fault_config or FaultInjectionConfig()
        self.csv_path = csv_path or (Path(__file__).parent.parent / DEFAULT_RAW_CSV_PATH)

        self._load_slice()

    def _load_slice(self) -> None:
        """Load and extract the 5 raw sensor features for this asset's assigned slice."""
        if not self.csv_path.is_file():
            raise FileNotFoundError(f"Raw AI4I CSV not found at: {self.csv_path.resolve()}")

        # Read only required slice rows
        df_full = pd.read_csv(self.csv_path)

        if self.source_row_end >= len(df_full):
            raise IndexError(
                f"source_row_end {self.source_row_end} exceeds dataset length {len(df_full)}"
            )

        df_slice = df_full.iloc[self.source_row_start : self.source_row_end + 1].copy()

        # Verify all 5 features exist
        for feat in RAW_SENSOR_FEATURE_NAMES:
            if feat not in df_slice.columns:
                raise KeyError(f"Required sensor feature '{feat}' missing from raw CSV!")

        # Extract strictly the 5 raw sensor columns as float array
        self.raw_sensor_data = df_slice[RAW_SENSOR_FEATURE_NAMES].to_numpy(dtype=np.float64)

        # Ground truth isolation guarantee: retain row indices for debug/verification,
        # but keep them completely isolated from the emitted telemetry payloads
        self.global_row_indices = df_slice.index.to_numpy()

    def is_exhausted(self, local_cursor: int) -> bool:
        """Check if local cursor has consumed all assigned rows in this slice."""
        return local_cursor >= self.slice_length

    def get_global_row_index(self, local_cursor: int) -> int:
        """Calculate global CSV row index from local cursor."""
        return self.source_row_start + local_cursor

    def generate_valid_reading(
        self,
        local_cursor: int,
        sequence_number: int,
        timestamp: str,
    ) -> TelemetryPayload:
        """
        Generate a valid TelemetryPayload from the raw observation at local_cursor.
        Applies subtle Gaussian measurement noise if configured.
        """
        if self.is_exhausted(local_cursor):
            raise IndexError(
                f"Asset '{self.asset_id}' has exhausted its source slice (local_cursor={local_cursor}, max={self.slice_length})"
            )

        row_vals = self.raw_sensor_data[local_cursor].copy()

        # Apply subtle sensor noise if enabled
        if self.fault_config.noise_enabled:
            row_vals[0] += random.gauss(0.0, self.fault_config.temperature_noise_std)  # Air temp
            row_vals[1] += random.gauss(0.0, self.fault_config.temperature_noise_std)  # Process temp
            row_vals[2] += random.gauss(0.0, self.fault_config.speed_noise_std)        # Rotational speed
            row_vals[3] += random.gauss(0.0, self.fault_config.torque_noise_std)       # Torque
            row_vals[4] += random.gauss(0.0, self.fault_config.tool_wear_noise_std)    # Tool wear

            # Keep rotational speed and torque physically non-negative
            row_vals[2] = max(0.0, row_vals[2])
            row_vals[3] = max(0.0, row_vals[3])

        return TelemetryPayload(
            asset_id=self.asset_id,
            timestamp=timestamp,
            sequence_number=sequence_number,
            air_temperature=round(float(row_vals[0]), 2),
            process_temperature=round(float(row_vals[1]), 2),
            rotational_speed=round(float(row_vals[2]), 1),
            torque=round(float(row_vals[3]), 2),
            tool_wear=round(float(row_vals[4]), 1),
        )

    def generate_malformed_reading(
        self,
        local_cursor: int,
        sequence_number: int,
        timestamp: str,
        specific_fault: Optional[MalformedType] = None,
    ) -> Union[Dict[str, Any], str, bytes]:
        """
        Explicit fault-injection path.
        Deliberately produces missing-field, wrong-type, null-value, or corrupted-json messages.
        Never silently repairs or normalizes malformed telemetry.
        """
        fault_type = specific_fault or self.fault_config.malformed_type
        if fault_type == "random":
            fault_type = random.choice(["missing_field", "wrong_type", "null_value", "corrupted_json"])

        valid_payload = self.generate_valid_reading(local_cursor, sequence_number, timestamp)
        data = valid_payload.to_dict()

        if fault_type == "missing_field":
            # Deliberately remove a mandatory sensor field
            field_to_remove = random.choice(["torque", "rotational_speed", "air_temperature"])
            data.pop(field_to_remove, None)
            data["_fault_injected"] = f"missing_{field_to_remove}"
            return data

        elif fault_type == "wrong_type":
            # Deliberately emit string or invalid type for a numeric sensor
            target_field = random.choice(["torque", "process_temperature"])
            data[target_field] = "SENSOR_INVALID_VALUE"
            data["_fault_injected"] = f"wrong_type_{target_field}"
            return data

        elif fault_type == "null_value":
            # Deliberately inject None/null into a numeric field
            target_field = random.choice(["rotational_speed", "tool_wear"])
            data[target_field] = None
            data["_fault_injected"] = f"null_{target_field}"
            return data

        elif fault_type == "corrupted_json":
            # Deliberately emit raw corrupted bytes/string that fails JSON parser
            corrupted_str = (
                f'{{"asset_id": "{self.asset_id}", "sequence_number": {sequence_number}, '
                f'"air_temperature": 300.1, "torque": [UNPARSED_CORRUPTED_TOKEN'
            )
            return corrupted_str.encode("utf-8")

        else:
            raise ValueError(f"Unknown fault_type '{fault_type}'")
