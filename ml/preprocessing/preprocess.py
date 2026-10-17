"""
Preprocessing and Scaling Pipeline for AI4I 2020 Predictive Maintenance.

Phase 1 Infrastructure:
- Loads raw CSV.
- Selects the 5 verified sensor features.
- Selects 'Machine failure' as binary target.
- Preserves original row ordering (crucial for sequential/LSTM modeling).
- Validates data completeness, dtypes, and physical range boundaries.
- Performs temporal (non-shuffled) train/validation/test splitting.
- Reusable FeatureScaler utility that fits ONLY on training data and
  supports transformation for validation, test, and live inference.
- Saves processed data splits and scaler artifacts without training models.
"""

import argparse
import json
import os
import pickle
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler, StandardScaler

# Canonical feature definitions
RAW_FEATURE_COLUMNS: List[str] = [
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]

ENGINEERED_FEATURE_COLUMNS: List[str] = [
    "temperature_difference",
    "angular_velocity",
    "mechanical_power_proxy",
    "tool_wear_torque_interaction",
    "temperature_torque_interaction",
]

# Backward compatible canonical features
FEATURE_COLUMNS: List[str] = list(RAW_FEATURE_COLUMNS)
ALL_EXPERIMENT_B_COLUMNS: List[str] = RAW_FEATURE_COLUMNS + ENGINEERED_FEATURE_COLUMNS


def compute_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute explainable physical interaction features from the 5 verified sensor features.
    Strictly zero leakage: no target, no failure modes, no row IDs.

    1. temperature_difference: process_temperature - air_temperature
    2. angular_velocity: rotational_speed * 2*pi / 60
    3. mechanical_power_proxy: angular_velocity * torque
    4. tool_wear_torque_interaction: tool_wear * torque
    5. temperature_torque_interaction: temperature_difference * torque
    """
    temp_diff = df["Process temperature [K]"] - df["Air temperature [K]"]
    omega = df["Rotational speed [rpm]"] * (2.0 * np.pi / 60.0)
    power = omega * df["Torque [Nm]"]
    wear_torque = df["Tool wear [min]"] * df["Torque [Nm]"]
    temp_torque = temp_diff * df["Torque [Nm]"]

    engineered_df = pd.DataFrame({
        "temperature_difference": temp_diff,
        "angular_velocity": omega,
        "mechanical_power_proxy": power,
        "tool_wear_torque_interaction": wear_torque,
        "temperature_torque_interaction": temp_torque,
    }, index=df.index)

    return engineered_df

TARGET_COLUMN: str = "Machine failure"

# Diagnostic failure modes and metadata to explicitly exclude
EXCLUDED_COLUMNS: List[str] = [
    "UDI",
    "Product ID",
    "Type",
    "TWF",
    "HDF",
    "PWF",
    "OSF",
    "RNF",
]

# Physical sensor boundaries for sanity verification
PHYSICAL_BOUNDS: Dict[str, Tuple[float, float]] = {
    "Air temperature [K]": (200.0, 400.0),       # Ambient room/factory Kelvin
    "Process temperature [K]": (200.0, 400.0),   # Process Kelvin
    "Rotational speed [rpm]": (500.0, 5000.0),   # Spindle RPM
    "Torque [Nm]": (0.0, 200.0),                 # Motor torque in Nm
    "Tool wear [min]": (0.0, 1000.0),            # Tool wear in minutes
}


class DataValidationError(ValueError):
    """Raised when data validation fails."""
    pass


class DataValidator:
    """Validates raw and extracted data integrity and physical boundary constraints."""

    @staticmethod
    def validate_raw_dataframe(df: pd.DataFrame) -> None:
        """
        Validate that raw dataframe contains required features and target,
        and contains no missing values.
        """
        if not isinstance(df, pd.DataFrame):
            raise DataValidationError(f"Expected pandas DataFrame, got {type(df)}")

        # Check required columns
        missing_feats = [col for col in FEATURE_COLUMNS if col not in df.columns]
        if missing_feats:
            raise DataValidationError(f"Missing required sensor feature columns: {missing_feats}")

        if TARGET_COLUMN not in df.columns:
            raise DataValidationError(f"Missing required target column: '{TARGET_COLUMN}'")

        # Check for missing values in features and target
        cols_to_check = FEATURE_COLUMNS + [TARGET_COLUMN]
        null_counts = df[cols_to_check].isnull().sum()
        if null_counts.any():
            failing = null_counts[null_counts > 0].to_dict()
            raise DataValidationError(f"Null/missing values detected in columns: {failing}")

        # Check for infinite values
        inf_counts = np.isinf(df[FEATURE_COLUMNS]).sum()
        if inf_counts.any():
            failing_inf = inf_counts[inf_counts > 0].to_dict()
            raise DataValidationError(f"Infinite values detected in columns: {failing_inf}")

        # Validate target binary domain
        unique_targets = set(df[TARGET_COLUMN].unique())
        if not unique_targets.issubset({0, 1}):
            raise DataValidationError(f"Target '{TARGET_COLUMN}' contains non-binary values: {unique_targets}")

        # Validate physical boundaries
        for col, (low, high) in PHYSICAL_BOUNDS.items():
            out_of_bounds = df[(df[col] < low) | (df[col] > high)]
            if len(out_of_bounds) > 0:
                raise DataValidationError(
                    f"Column '{col}' has {len(out_of_bounds)} values outside physical bounds [{low}, {high}]."
                )

    @staticmethod
    def validate_temporal_order(df: pd.DataFrame) -> None:
        """Verify that UDI or index is monotonically non-decreasing (temporal preservation)."""
        if "UDI" in df.columns:
            if not df["UDI"].is_monotonic_increasing:
                raise DataValidationError("Row ordering violation: 'UDI' is not monotonically increasing!")


class FeatureScaler:
    """
    Reusable feature scaler designed for sequential time series data.

    STRICT SAFETY RULE:
    Does NOT fit on the complete dataset.
    Fits ONLY on training data, then transforms validation, test, and live inference samples.
    """

    def __init__(self, scaler_type: str = "standard", feature_names: Optional[List[str]] = None):
        """
        Args:
            scaler_type: 'standard' for StandardScaler (zero mean, unit variance)
                         or 'minmax' for MinMaxScaler (range [0, 1]).
            feature_names: List of feature names to track. Defaults to FEATURE_COLUMNS.
        """
        self.scaler_type = scaler_type.lower()
        self.feature_names = feature_names or list(FEATURE_COLUMNS)
        self.fitted: bool = False

        if self.scaler_type == "standard":
            self._scaler = StandardScaler()
        elif self.scaler_type == "minmax":
            self._scaler = MinMaxScaler()
        else:
            raise ValueError(f"Unsupported scaler_type '{scaler_type}'. Choose 'standard' or 'minmax'.")

    def fit(self, X: Union[pd.DataFrame, np.ndarray]) -> "FeatureScaler":
        """
        Fit scaler using TRAINING data only.

        Args:
            X: Training features of shape (N_samples, N_features).
        """
        X_arr = self._to_numpy(X)
        self._validate_feature_dim(X_arr)
        self._scaler.fit(X_arr)
        self.fitted = True
        return self

    def transform(self, X: Union[pd.DataFrame, np.ndarray]) -> np.ndarray:
        """
        Transform features using the parameters learned from training data.
        Supports 2D tabular arrays (N, D), 3D sequence tensors (N, T, D),
        or single 1D inference vectors (D,).

        Args:
            X: Input feature array or DataFrame.

        Returns:
            Scaled numpy array of identical shape.
        """
        if not self.fitted:
            raise RuntimeError(
                "FeatureScaler has NOT been fitted yet! "
                "You must fit it using training data only before calling transform()."
            )

        X_arr = np.asarray(X, dtype=np.float64)

        # Single 1D inference sample: shape (D,) -> reshape to (1, D)
        if X_arr.ndim == 1:
            if X_arr.shape[0] != len(self.feature_names):
                raise ValueError(f"Expected {len(self.feature_names)} features, got {X_arr.shape[0]}")
            return self._scaler.transform(X_arr.reshape(1, -1)).flatten()

        # 2D tabular array: shape (N, D)
        elif X_arr.ndim == 2:
            self._validate_feature_dim(X_arr)
            return self._scaler.transform(X_arr)

        # 3D sequence array: shape (N, T, D)
        elif X_arr.ndim == 3:
            N, T, D = X_arr.shape
            if D != len(self.feature_names):
                raise ValueError(f"Expected {len(self.feature_names)} features along axis 2, got {D}")
            reshaped = X_arr.reshape(-1, D)
            transformed = self._scaler.transform(reshaped)
            return transformed.reshape(N, T, D)

        else:
            raise ValueError(f"Unsupported array dimensionality: {X_arr.ndim}")

    def fit_transform(self, X: Union[pd.DataFrame, np.ndarray]) -> np.ndarray:
        """Fit on training data and transform it."""
        return self.fit(X).transform(X)

    def inverse_transform(self, X: np.ndarray) -> np.ndarray:
        """Revert scaled data back to original physical sensor units."""
        if not self.fitted:
            raise RuntimeError("FeatureScaler has not been fitted.")

        X_arr = np.asarray(X, dtype=np.float64)
        if X_arr.ndim == 1:
            return self._scaler.inverse_transform(X_arr.reshape(1, -1)).flatten()
        elif X_arr.ndim == 2:
            return self._scaler.inverse_transform(X_arr)
        elif X_arr.ndim == 3:
            N, T, D = X_arr.shape
            reshaped = X_arr.reshape(-1, D)
            inverted = self._scaler.inverse_transform(reshaped)
            return inverted.reshape(N, T, D)
        else:
            raise ValueError(f"Unsupported array dimensionality: {X_arr.ndim}")

    def save(self, filepath: Union[str, Path]) -> None:
        """Save fitted scaler state and metadata to disk."""
        if not self.fitted:
            raise RuntimeError("Cannot save an unfitted FeatureScaler.")
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump({
                "scaler_type": self.scaler_type,
                "feature_names": self.feature_names,
                "fitted": self.fitted,
                "_scaler": self._scaler,
            }, f)
        print(f"FeatureScaler successfully saved to: {path.resolve()}")

    @classmethod
    def load(cls, filepath: Union[str, Path]) -> "FeatureScaler":
        """Load fitted scaler state and metadata from disk."""
        path = Path(filepath)
        if not path.is_file():
            raise FileNotFoundError(f"Scaler file not found at: {path.resolve()}")
        with open(path, "rb") as f:
            state = pickle.load(f)
        instance = cls(scaler_type=state["scaler_type"], feature_names=state["feature_names"])
        instance._scaler = state["_scaler"]
        instance.fitted = state["fitted"]
        print(f"FeatureScaler successfully loaded from: {path.resolve()}")
        return instance

    def _to_numpy(self, X: Union[pd.DataFrame, np.ndarray]) -> np.ndarray:
        if isinstance(X, pd.DataFrame):
            return X[self.feature_names].to_numpy(dtype=np.float64)
        return np.asarray(X, dtype=np.float64)

    def _validate_feature_dim(self, X_arr: np.ndarray) -> None:
        if X_arr.ndim != 2 or X_arr.shape[1] != len(self.feature_names):
            raise ValueError(
                f"Feature dimension mismatch: expected shape (N, {len(self.feature_names)}), "
                f"got {X_arr.shape}"
            )


class DataPreprocessor:
    """
    Main Preprocessing Pipeline for raw dataset preparation.
    Preserves strict temporal row ordering (no shuffling).
    """

    def __init__(self, raw_csv_path: str = "data/raw/ai4i2020.csv"):
        self.raw_csv_path = Path(raw_csv_path)

    def load_and_validate_raw_data(self) -> pd.DataFrame:
        """Load raw CSV and perform validation."""
        if not self.raw_csv_path.is_file():
            raise FileNotFoundError(f"Raw data file not found at {self.raw_csv_path.resolve()}")

        df = pd.read_csv(self.raw_csv_path)
        DataValidator.validate_raw_dataframe(df)
        DataValidator.validate_temporal_order(df)
        return df

    def extract_features_and_target(
        self, df: pd.DataFrame
    ) -> Tuple[pd.DataFrame, pd.Series]:
        """
        Extract the 5 verified sensor features and the binary failure target.
        Excludes UDI, Product ID, Type, and all diagnostic failure modes (TWF, HDF, PWF, OSF, RNF).
        Preserves original row ordering.
        """
        X = df[FEATURE_COLUMNS].copy()
        y = df[TARGET_COLUMN].copy()
        return X, y

    @staticmethod
    def temporal_split(
        X: pd.DataFrame,
        y: pd.Series,
        train_ratio: float = 0.70,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15,
    ) -> Dict[str, Union[pd.DataFrame, pd.Series]]:
        """
        Perform strict chronological (temporal) train/val/test split.
        PRESERVES ORIGINAL ROW ORDERING WITHOUT RANDOM SHUFFLING.

        Args:
            X: Feature DataFrame of shape (N, 5).
            y: Target Series of shape (N,).
            train_ratio: Proportion of early chronological rows for training.
            val_ratio: Proportion of middle chronological rows for validation.
            test_ratio: Proportion of late chronological rows for testing.

        Returns:
            Dict containing X_train, y_train, X_val, y_val, X_test, y_test.
        """
        if not np.isclose(train_ratio + val_ratio + test_ratio, 1.0):
            raise ValueError("Split ratios must sum to 1.0")

        n_samples = len(X)
        train_end = int(n_samples * train_ratio)
        val_end = int(n_samples * (train_ratio + val_ratio))

        X_train = X.iloc[:train_end].copy()
        y_train = y.iloc[:train_end].copy()

        X_val = X.iloc[train_end:val_end].copy()
        y_val = y.iloc[train_end:val_end].copy()

        X_test = X.iloc[val_end:].copy()
        y_test = y.iloc[val_end:].copy()

        return {
            "X_train": X_train,
            "y_train": y_train,
            "X_val": X_val,
            "y_val": y_val,
            "X_test": X_test,
            "y_test": y_test,
        }

    def run_preprocessing_pipeline(
        self,
        output_dir: str = "data/processed",
        train_ratio: float = 0.70,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15,
        scaler_type: str = "standard",
    ) -> Dict[str, Any]:
        """
        Execute full Phase 1 preprocessing preparation:
        1. Load & validate raw dataset.
        2. Extract features & target (excluding leakage columns).
        3. Perform temporal splitting.
        4. Fit scaler ONLY on X_train.
        5. Transform X_val and X_test using the train-fitted scaler.
        6. Save processed splits and fitted scaler artifact.

        NOTE: DOES NOT TRAIN ANY MODEL.
        """
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)

        print("Step 1: Loading and validating raw data...")
        df_raw = self.load_and_validate_raw_data()

        print("Step 2: Extracting 5 sensor features and target...")
        X, y = self.extract_features_and_target(df_raw)

        print(
            f"Step 3: Performing chronological split ({train_ratio:.0%} train, "
            f"{val_ratio:.0%} val, {test_ratio:.0%} test)..."
        )
        splits = self.temporal_split(X, y, train_ratio, val_ratio, test_ratio)

        print("Step 4: Fitting FeatureScaler on TRAINING data ONLY...")
        scaler = FeatureScaler(scaler_type=scaler_type, feature_names=FEATURE_COLUMNS)
        scaler.fit(splits["X_train"])

        print("Step 5: Transforming validation, test, and training features...")
        X_train_scaled = scaler.transform(splits["X_train"])
        X_val_scaled = scaler.transform(splits["X_val"])
        X_test_scaled = scaler.transform(splits["X_test"])

        print("Step 6: Saving unscaled and scaled datasets...")
        # Save unscaled datasets with preserved temporal order
        splits["X_train"].assign(**{TARGET_COLUMN: splits["y_train"]}).to_csv(
            out_path / "train_unscaled.csv", index=False
        )
        splits["X_val"].assign(**{TARGET_COLUMN: splits["y_val"]}).to_csv(
            out_path / "val_unscaled.csv", index=False
        )
        splits["X_test"].assign(**{TARGET_COLUMN: splits["y_test"]}).to_csv(
            out_path / "test_unscaled.csv", index=False
        )

        # Save scaled datasets as numpy archives for direct sequence creation
        np.savez_compressed(
            out_path / "train_scaled.npz",
            features=X_train_scaled,
            targets=splits["y_train"].to_numpy(),
        )
        np.savez_compressed(
            out_path / "val_scaled.npz",
            features=X_val_scaled,
            targets=splits["y_val"].to_numpy(),
        )
        np.savez_compressed(
            out_path / "test_scaled.npz",
            features=X_test_scaled,
            targets=splits["y_test"].to_numpy(),
        )

        # Save fitted scaler artifact
        scaler_file = out_path / "scaler.pkl"
        scaler.save(scaler_file)

        # Save metadata summary
        metadata = {
            "raw_samples": len(df_raw),
            "features": FEATURE_COLUMNS,
            "target": TARGET_COLUMN,
            "excluded_columns": EXCLUDED_COLUMNS,
            "scaler_type": scaler_type,
            "train_samples": len(splits["X_train"]),
            "train_failures": int(splits["y_train"].sum()),
            "val_samples": len(splits["X_val"]),
            "val_failures": int(splits["y_val"].sum()),
            "test_samples": len(splits["X_test"]),
            "test_failures": int(splits["y_test"].sum()),
            "scaler_path": str(scaler_file.resolve()),
        }

        with open(out_path / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

        print("Preprocessing successfully completed! Artifacts saved to:", out_path.resolve())
        return {
            "splits": splits,
            "scaler": scaler,
            "metadata": metadata,
            "X_train_scaled": X_train_scaled,
            "X_val_scaled": X_val_scaled,
            "X_test_scaled": X_test_scaled,
        }

    def run_experiment_b_preprocessing(
        self,
        output_dir: str = "data/processed",
        scaler_type: str = "standard",
    ) -> Dict[str, Any]:
        """
        Execute Phase 2 Experiment B Preprocessing:
        1. Loads raw 5 features for train, val, and test splits (preserving exact splits).
        2. Computes the 5 explainable engineered interaction features.
        3. Fits FeatureScaler strictly on TRAINING split only (10 features).
        4. Transforms validation and test splits with train-fitted scaler.
        5. Saves separate Experiment B artifacts without touching Experiment A files.
        """
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)

        print("--- EXPERIMENT B: FEATURE ENGINEERING PREPROCESSING ---")
        # Load from unscaled CSVs if available to guarantee 100% split alignment
        train_csv = out_path / "train_unscaled.csv"
        val_csv = out_path / "val_unscaled.csv"
        test_csv = out_path / "test_unscaled.csv"

        if train_csv.is_file() and val_csv.is_file() and test_csv.is_file():
            print("Loading existing chronological split boundaries from CSV...")
            df_train = pd.read_csv(train_csv)
            df_val = pd.read_csv(val_csv)
            df_test = pd.read_csv(test_csv)

            X_train_raw = df_train[RAW_FEATURE_COLUMNS].copy()
            y_train = df_train[TARGET_COLUMN].copy()

            X_val_raw = df_val[RAW_FEATURE_COLUMNS].copy()
            y_val = df_val[TARGET_COLUMN].copy()

            X_test_raw = df_test[RAW_FEATURE_COLUMNS].copy()
            y_test = df_test[TARGET_COLUMN].copy()
        else:
            print("Loading raw CSV and performing temporal split...")
            df_raw = self.load_and_validate_raw_data()
            X, y = self.extract_features_and_target(df_raw)
            splits = self.temporal_split(X, y)
            X_train_raw, y_train = splits["X_train"], splits["y_train"]
            X_val_raw, y_val = splits["X_val"], splits["y_val"]
            X_test_raw, y_test = splits["X_test"], splits["y_test"]

        # Step 2: Compute engineered features for each split
        print("Computing 5 engineered features (10 total features)...")
        eng_train = compute_engineered_features(X_train_raw)
        eng_val = compute_engineered_features(X_val_raw)
        eng_test = compute_engineered_features(X_test_raw)

        X_train_full = pd.concat([X_train_raw, eng_train], axis=1)
        X_val_full = pd.concat([X_val_raw, eng_val], axis=1)
        X_test_full = pd.concat([X_test_raw, eng_test], axis=1)

        # Verification of features
        for split_name, df_check in [("Train", X_train_full), ("Val", X_val_full), ("Test", X_test_full)]:
            if df_check.isnull().any().any():
                raise ValueError(f"NaN values detected in {split_name} engineered features!")
            if np.isinf(df_check.to_numpy()).any():
                raise ValueError(f"Infinite values detected in {split_name} engineered features!")

        print(f"Features created: {list(X_train_full.columns)}")
        print(f"Shapes: Train={X_train_full.shape}, Val={X_val_full.shape}, Test={X_test_full.shape}")

        # Step 3: Fit scaler strictly on TRAINING data only
        print("Fitting Experiment B FeatureScaler on TRAINING data ONLY (10 features)...")
        scaler_b = FeatureScaler(scaler_type=scaler_type, feature_names=ALL_EXPERIMENT_B_COLUMNS)
        scaler_b.fit(X_train_full)

        # Step 4: Transform all splits
        print("Transforming train, validation, and test features with train-fitted scaler...")
        X_train_scaled = scaler_b.transform(X_train_full)
        X_val_scaled = scaler_b.transform(X_val_full)
        X_test_scaled = scaler_b.transform(X_test_full)

        # Step 5: Save separate Experiment B artifacts
        print("Saving Experiment B artifacts (train/val/test_engineered_scaled.npz & scaler_engineered.pkl)...")
        np.savez_compressed(
            out_path / "train_engineered_scaled.npz",
            features=X_train_scaled,
            targets=y_train.to_numpy(),
        )
        np.savez_compressed(
            out_path / "val_engineered_scaled.npz",
            features=X_val_scaled,
            targets=y_val.to_numpy(),
        )
        np.savez_compressed(
            out_path / "test_engineered_scaled.npz",
            features=X_test_scaled,
            targets=y_test.to_numpy(),
        )

        scaler_b_file = out_path / "scaler_engineered.pkl"
        scaler_b.save(scaler_b_file)

        metadata_b = {
            "experiment": "Experiment B (Raw 5 + Engineered 5)",
            "raw_features": RAW_FEATURE_COLUMNS,
            "engineered_features": ENGINEERED_FEATURE_COLUMNS,
            "all_features": ALL_EXPERIMENT_B_COLUMNS,
            "num_features": len(ALL_EXPERIMENT_B_COLUMNS),
            "target": TARGET_COLUMN,
            "scaler_type": scaler_type,
            "train_samples": len(X_train_full),
            "val_samples": len(X_val_full),
            "test_samples": len(X_test_full),
            "scaler_path": str(scaler_b_file.resolve()),
        }

        with open(out_path / "metadata_engineered.json", "w", encoding="utf-8") as f:
            json.dump(metadata_b, f, indent=2)

        print("Experiment B preprocessing completed successfully! Artifacts saved.")
        return {
            "scaler": scaler_b,
            "metadata": metadata_b,
            "X_train_scaled": X_train_scaled,
            "X_val_scaled": X_val_scaled,
            "X_test_scaled": X_test_scaled,
        }


def main():
    parser = argparse.ArgumentParser(description="AI4I 2020 Preprocessing Pipeline")
    parser.add_argument(
        "--raw_csv",
        type=str,
        default="data/raw/ai4i2020.csv",
        help="Path to raw dataset CSV",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="data/processed",
        help="Directory to save processed splits and scaler",
    )
    parser.add_argument(
        "--scaler_type",
        type=str,
        default="standard",
        choices=["standard", "minmax"],
        help="Type of scaling: 'standard' or 'minmax'",
    )
    parser.add_argument(
        "--experiment",
        type=str,
        default="B",
        choices=["A", "B", "all"],
        help="Experiment to preprocess: 'A' (raw 5), 'B' (raw + engineered 10), or 'all'",
    )
    args = parser.parse_args()

    preprocessor = DataPreprocessor(raw_csv_path=args.raw_csv)
    if args.experiment in ["A", "all"]:
        preprocessor.run_preprocessing_pipeline(
            output_dir=args.output_dir,
            scaler_type=args.scaler_type,
        )
    if args.experiment in ["B", "all"]:
        preprocessor.run_experiment_b_preprocessing(
            output_dir=args.output_dir,
            scaler_type=args.scaler_type,
        )


if __name__ == "__main__":
    main()
