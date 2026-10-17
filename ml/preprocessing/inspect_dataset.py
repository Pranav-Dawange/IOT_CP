"""
Dataset Inspection Script for AI4I 2020 Predictive Maintenance Dataset.

Task 2: Inspects raw data and reports:
- Shape
- Column names
- Data types (dtypes)
- Missing values
- Duplicate rows
- Unique values
- Descriptive statistics (numerical & categorical)
- Target class distribution (Machine failure)
- Analysis of potential leakage columns
"""

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd


def inspect_dataset(df: pd.DataFrame, verbose: bool = True) -> Dict[str, Any]:
    """
    Perform comprehensive dataset inspection on the provided DataFrame.

    Args:
        df: Input pandas DataFrame.
        verbose: Whether to print formatted inspection report to stdout.

    Returns:
        Dict containing structured inspection metrics.
    """
    total_rows, total_cols = df.shape
    duplicate_count = int(df.duplicated().sum())

    # Column dtypes and null checks
    missing_counts = df.isnull().sum()
    missing_pct = (missing_counts / total_rows) * 100.0
    unique_counts = df.nunique()

    col_summary = pd.DataFrame({
        "Column": df.columns,
        "Dtype": [str(t) for t in df.dtypes],
        "Missing Count": missing_counts.values,
        "Missing %": missing_pct.values,
        "Unique Count": unique_counts.values,
    })

    # Descriptive statistics
    num_cols = df.select_dtypes(include=["number"]).columns.tolist()
    cat_cols = df.select_dtypes(exclude=["number"]).columns.tolist()

    num_stats = df[num_cols].describe().T if num_cols else pd.DataFrame()
    if not num_stats.empty:
        num_stats["skew"] = df[num_cols].skew()

    # Target class distribution if target exists
    target_summary = {}
    if "Machine failure" in df.columns:
        counts = df["Machine failure"].value_counts().to_dict()
        pcts = (df["Machine failure"].value_counts(normalize=True) * 100.0).to_dict()
        n_neg = counts.get(0, 0)
        n_pos = counts.get(1, 0)
        ratio = (n_neg / n_pos) if n_pos > 0 else float("inf")
        target_summary = {
            "counts": counts,
            "percentages": pcts,
            "negative_count (0)": n_neg,
            "positive_count (1)": n_pos,
            "imbalance_ratio": ratio,
        }

    # Leakage columns audit
    leakage_cols = ["TWF", "HDF", "PWF", "OSF", "RNF"]
    leakage_present = [c for c in leakage_cols if c in df.columns]
    leakage_summary = {}
    if leakage_present:
        for c in leakage_present:
            leakage_summary[c] = int(df[c].sum())
        leakage_summary["any_mode_active"] = int(
            (df[leakage_present].sum(axis=1) > 0).sum()
        )

    results: Dict[str, Any] = {
        "shape": (total_rows, total_cols),
        "total_rows": total_rows,
        "total_cols": total_cols,
        "column_names": list(df.columns),
        "duplicate_rows": duplicate_count,
        "column_summary": col_summary.to_dict(orient="records"),
        "numeric_statistics": num_stats.to_dict(orient="index") if not num_stats.empty else {},
        "target_distribution": target_summary,
        "leakage_columns_audit": leakage_summary,
    }

    if verbose:
        _print_inspection_report(results, col_summary, num_stats, df)

    return results


def _print_inspection_report(
    results: Dict[str, Any],
    col_summary: pd.DataFrame,
    num_stats: pd.DataFrame,
    df: pd.DataFrame,
) -> None:
    """Print clean formatted inspection findings to console."""
    print("=" * 80)
    print("AI4I 2020 DATASET INSPECTION REPORT")
    print("=" * 80)
    print(f"Shape: {results['total_rows']:,} rows, {results['total_cols']} columns")
    print(f"Duplicate Rows: {results['duplicate_rows']}")
    print("-" * 80)

    print("COLUMN SUMMARY & NULL VALUES:")
    print(col_summary.to_string(index=False))
    print("-" * 80)

    if not num_stats.empty:
        print("NUMERICAL DESCRIPTIVE STATISTICS:")
        display_stats = num_stats[["mean", "std", "min", "25%", "50%", "75%", "max", "skew"]]
        print(display_stats.to_string())
        print("-" * 80)

    if "target_distribution" in results and results["target_distribution"]:
        t_dist = results["target_distribution"]
        print("TARGET CLASS DISTRIBUTION ('Machine failure'):")
        print(f"  Class 0 (Normal):  {t_dist['negative_count (0)']:,} samples ({t_dist['percentages'].get(0, 0.0):.2f}%)")
        print(f"  Class 1 (Failure): {t_dist['positive_count (1)']:,} samples ({t_dist['percentages'].get(1, 0.0):.2f}%)")
        print(f"  Class Imbalance Ratio: {t_dist['imbalance_ratio']:.2f} : 1")
        print("-" * 80)

    if results.get("leakage_columns_audit"):
        print("DIAGNOSTIC FAILURE MODE AUDIT (Target Leakage Risk):")
        for k, v in results["leakage_columns_audit"].items():
            print(f"  {k}: {v:,} occurrences")
        print("  NOTE: These columns must be EXCLUDED from LSTM model inputs.")
        print("=" * 80)


def run_inspection(file_path: str, save_report_path: Optional[str] = None) -> Dict[str, Any]:
    """Load CSV from file_path and run inspection."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"Dataset file not found at: {file_path}")

    print(f"Loading raw dataset from: {path.resolve()}")
    df = pd.read_csv(path)
    results = inspect_dataset(df, verbose=True)

    if save_report_path:
        out_path = Path(save_report_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Save a summary JSON
        import json
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, default=str)
        print(f"Inspection summary saved to: {out_path.resolve()}")

    return results


def main():
    parser = argparse.ArgumentParser(description="Inspect AI4I 2020 Predictive Maintenance Dataset")
    parser.add_argument(
        "--data_path",
        type=str,
        default="data/raw/ai4i2020.csv",
        help="Path to raw CSV file (default: data/raw/ai4i2020.csv)",
    )
    parser.add_argument(
        "--save_report",
        type=str,
        default=None,
        help="Optional path to save JSON inspection report",
    )
    args = parser.parse_args()

    try:
        run_inspection(args.data_path, args.save_report)
    except Exception as e:
        print(f"Error during inspection: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
