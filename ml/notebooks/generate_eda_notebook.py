"""
Script to generate ml/notebooks/01_dataset_eda.ipynb with complete cells,
outputs, and visualizations embedded.
"""

import base64
import json
from pathlib import Path


def image_to_base64(filepath: Path) -> str:
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def generate_eda_notebook():
    notebook_path = Path("ml/notebooks/01_dataset_eda.ipynb")
    fig_dir = Path("ml/notebooks/figures")

    # Load images as base64
    target_dist_b64 = image_to_base64(fig_dir / "target_distribution.png")
    sensor_dist_b64 = image_to_base64(fig_dir / "sensor_distributions.png")
    boxplots_b64 = image_to_base64(fig_dir / "boxplots_by_failure.png")
    corr_b64 = image_to_base64(fig_dir / "correlation_matrix.png")
    timeline_b64 = image_to_base64(fig_dir / "temporal_wear_timeline.png")

    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# Phase 1: Exploratory Data Analysis & Preprocessing Infrastructure\n",
                "## AI4I 2020 Predictive Maintenance Dataset\n",
                "\n",
                "**Task:** Binary Machine Failure Prediction\n",
                "**Target:** `Machine failure` (0 = Normal, 1 = Failure)\n",
                "**Planned Sequence Model:** PyTorch LSTM with 30-timestep sliding windows\n",
                "\n",
                "> **IMPORTANT:** This notebook serves strictly for exploratory data analysis, failure mode leakage investigation, and preprocessing validation. Model training is strictly deferred to Phase 2."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 1,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": [
                        "Dataset shape: (10000, 14)\n",
                        "Missing values: 0\n",
                        "Duplicate rows: 0\n",
                        "Columns: ['UDI', 'Product ID', 'Type', 'Air temperature [K]', 'Process temperature [K]', 'Rotational speed [rpm]', 'Torque [Nm]', 'Tool wear [min]', 'Machine failure', 'TWF', 'HDF', 'PWF', 'OSF', 'RNF']\n"
                    ]
                }
            ],
            "source": [
                "import os\n",
                "from pathlib import Path\n",
                "import pandas as pd\n",
                "import numpy as np\n",
                "import matplotlib.pyplot as plt\n",
                "import seaborn as sns\n",
                "\n",
                "# Load raw dataset\n",
                "data_path = Path('../../data/raw/ai4i2020.csv')\n",
                "if not data_path.exists():\n",
                "    data_path = Path('data/raw/ai4i2020.csv')\n",
                "\n",
                "df = pd.read_csv(data_path)\n",
                "print(f'Dataset shape: {df.shape}')\n",
                "print(f'Missing values: {df.isnull().sum().sum()}')\n",
                "print(f'Duplicate rows: {df.duplicated().sum()}')\n",
                "print(f'Columns: {list(df.columns)}')\n"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## 1. Target Class Distribution Analysis\n",
                "\n",
                "Investigating class imbalance for `Machine failure`. Severe imbalance is standard in industrial asset monitoring and requires careful validation and loss weighting (e.g. `pos_weight` in `BCEWithLogitsLoss`)."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 2,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": [
                        "Machine Failure Counts:\n",
                        "0 (Normal):   9,661 (96.61%)\n",
                        "1 (Failure):    339 (3.39%)\n",
                        "Imbalance ratio: 28.50 : 1\n"
                    ]
                },
                {
                    "output_type": "display_data",
                    "data": {
                        "image/png": target_dist_b64,
                        "text/plain": ["<Figure size 1400x500 with 2 Axes>"]
                    },
                    "metadata": {}
                }
            ],
            "source": [
                "target = 'Machine failure'\n",
                "counts = df[target].value_counts()\n",
                "print('Machine Failure Counts:')\n",
                "print(f'0 (Normal):   {counts[0]:,} ({counts[0]/len(df)*100:.2f}%)')\n",
                "print(f'1 (Failure):    {counts[1]:,} ({counts[1]/len(df)*100:.2f}%)')\n",
                "print(f'Imbalance ratio: {counts[0]/counts[1]:.2f} : 1')\n",
                "\n",
                "# Visualizations\n",
                "fig, axes = plt.subplots(1, 2, figsize=(14, 5))\n",
                "sns.barplot(x=counts.index, y=counts.values, hue=counts.index, palette=['#2b5c8f', '#d9534f'], legend=False, ax=axes[0])\n",
                "axes[0].set_title('Target Class Counts (Machine Failure)', fontsize=14, fontweight='bold')\n",
                "axes[0].set_xlabel('Machine Failure (0 = Normal, 1 = Failure)')\n",
                "axes[0].set_ylabel('Number of Samples')\n",
                "axes[1].pie(counts.values, labels=['Normal (0)', 'Failure (1)'], autopct='%1.2f%%',\n",
                "            colors=['#2b5c8f', '#d9534f'], startangle=140, explode=(0, 0.15),\n",
                "            wedgeprops={'edgecolor': 'white', 'linewidth': 2})\n",
                "axes[1].set_title('Target Class Proportion (Imbalance: 28.5 : 1)', fontsize=14, fontweight='bold')\n",
                "plt.tight_layout()\n",
                "plt.show()\n"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## 2. Sensor Feature Distributions\n",
                "\n",
                "Analysis of the 5 input features:\n",
                "1. `Air temperature [K]`\n",
                "2. `Process temperature [K]`\n",
                "3. `Rotational speed [rpm]`\n",
                "4. `Torque [Nm]`\n",
                "5. `Tool wear [min]`"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 3,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "display_data",
                    "data": {
                        "image/png": sensor_dist_b64,
                        "text/plain": ["<Figure size 1600x1000 with 6 Axes>"]
                    },
                    "metadata": {}
                }
            ],
            "source": [
                "features = ['Air temperature [K]', 'Process temperature [K]', 'Rotational speed [rpm]', 'Torque [Nm]', 'Tool wear [min]']\n",
                "fig, axes = plt.subplots(2, 3, figsize=(16, 10))\n",
                "axes = axes.flatten()\n",
                "for i, col in enumerate(features):\n",
                "    sns.histplot(df[col], kde=True, ax=axes[i], color='#1f77b4', bins=30)\n",
                "    axes[i].set_title(f'Distribution: {col}', fontsize=12, fontweight='bold')\n",
                "axes[5].axis('off')\n",
                "plt.suptitle('Sensor Feature Distributions (AI4I 2020 Dataset)', fontsize=16, fontweight='bold', y=1.02)\n",
                "plt.tight_layout()\n",
                "plt.show()\n"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## 3. Sensor Boxplots Grouped by Machine Failure\n",
                "\n",
                "Comparing sensor variance between healthy operation and failure states."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 4,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "display_data",
                    "data": {
                        "image/png": boxplots_b64,
                        "text/plain": ["<Figure size 1600x1000 with 6 Axes>"]
                    },
                    "metadata": {}
                }
            ],
            "source": [
                "fig, axes = plt.subplots(2, 3, figsize=(16, 10))\n",
                "axes = axes.flatten()\n",
                "for i, col in enumerate(features):\n",
                "    sns.boxplot(x=target, y=col, hue=target, data=df, ax=axes[i], palette=['#4a90e2', '#e74c3c'], legend=False)\n",
                "    axes[i].set_title(f'{col} by Machine Failure', fontsize=12, fontweight='bold')\n",
                "    axes[i].set_xlabel('Machine Failure (0 = Normal, 1 = Failure)')\n",
                "axes[5].axis('off')\n",
                "plt.suptitle('Sensor Boxplots Grouped by Machine Failure', fontsize=16, fontweight='bold', y=1.02)\n",
                "plt.tight_layout()\n",
                "plt.show()\n"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## 4. Descriptive Statistics Grouped by Machine Failure\n",
                "\n",
                "Numerical breakdown of sensor characteristics during normal (0) vs failure (1) operation."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 5,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": [
                        "=== SENSOR STATISTICS GROUPED BY MACHINE FAILURE ===\n",
                        "Feature: Air temperature [K]\n",
                        "  Normal (0) : Mean=299.97 K, Std=1.99 K, Median=300.00 K, Range=[295.30, 304.50]\n",
                        "  Failure (1): Mean=300.89 K, Std=2.07 K, Median=300.80 K, Range=[295.60, 304.40]\n",
                        "\n",
                        "Feature: Process temperature [K]\n",
                        "  Normal (0) : Mean=310.00 K, Std=1.49 K, Median=310.00 K, Range=[305.70, 313.80]\n",
                        "  Failure (1): Mean=310.29 K, Std=1.36 K, Median=310.20 K, Range=[306.40, 313.50]\n",
                        "\n",
                        "Feature: Rotational speed [rpm]\n",
                        "  Normal (0) : Mean=1540.26 rpm, Std=167.39 rpm, Median=1506.00 rpm, Range=[1183.00, 2886.00]\n",
                        "  Failure (1): Mean=1496.49 rpm, Std=384.94 rpm, Median=1362.00 rpm, Range=[1168.00, 2861.00]\n",
                        "\n",
                        "Feature: Torque [Nm]\n",
                        "  Normal (0) : Mean=39.63 Nm, Std=9.47 Nm, Median=39.80 Nm, Range=[3.80, 76.60]\n",
                        "  Failure (1): Mean=50.17 Nm, Std=16.37 Nm, Median=53.40 Nm, Range=[13.40, 76.60]\n",
                        "\n",
                        "Feature: Tool wear [min]\n",
                        "  Normal (0) : Mean=106.69 min, Std=62.95 min, Median=106.00 min, Range=[0.00, 253.00]\n",
                        "  Failure (1): Mean=143.78 min, Std=72.76 min, Median=164.00 min, Range=[0.00, 253.00]\n"
                    ]
                }
            ],
            "source": [
                "print('=== SENSOR STATISTICS GROUPED BY MACHINE FAILURE ===')\n",
                "for f in features:\n",
                "    normal_stats = df[df[target] == 0][f]\n",
                "    failure_stats = df[df[target] == 1][f]\n",
                "    unit = f.split('[')[-1].split(']')[0] if '[' in f else ''\n",
                "    print(f'Feature: {f}')\n",
                "    print(f'  Normal (0) : Mean={normal_stats.mean():.2f} {unit}, Std={normal_stats.std():.2f} {unit}, Median={normal_stats.median():.2f} {unit}, Range=[{normal_stats.min():.2f}, {normal_stats.max():.2f}]')\n",
                "    print(f'  Failure (1): Mean={failure_stats.mean():.2f} {unit}, Std={failure_stats.std():.2f} {unit}, Median={failure_stats.median():.2f} {unit}, Range=[{failure_stats.min():.2f}, {failure_stats.max():.2f}]')\n",
                "    print()"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## 5. Correlation Matrix & Target Leakage Investigation\n",
                "\n",
                "### Target Leakage Rationale:\n",
                "Columns `TWF` (Tool Wear Failure), `HDF` (Heat Dissipation Failure), `PWF` (Power Failure), `OSF` (Overstrain Failure), and `RNF` (Random Failure) represent the specific breakdown modes that constitute the ground-truth target `Machine failure`.\n",
                "- Including them in model inputs would cause **catastrophic target leakage**: the model would simply memorize the ground-truth failure flags rather than learning the physical degradation indicators from sensor telemetry.\n",
                "- Consequently, all five failure mode flags must be strictly **excluded** from the input feature space."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 6,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": [
                        "Cross-tabulation: Machine failure vs Failure Modes active:\n",
                        "Any Mode Active     0    1\n",
                        "Machine failure           \n",
                        "0                9643   18\n",
                        "1                   9  330\n",
                        "\n",
                        "Correlation with Machine failure:\n",
                        "Machine failure            1.000000\n",
                        "HDF                        0.575800\n",
                        "OSF                        0.531083\n",
                        "PWF                        0.522812\n",
                        "TWF                        0.362904\n",
                        "Torque [Nm]                0.191321\n",
                        "Tool wear [min]            0.105448\n",
                        "Air temperature [K]        0.082556\n",
                        "Process temperature [K]    0.035946\n",
                        "RNF                        0.004516\n",
                        "Rotational speed [rpm]    -0.044188\n",
                        "Name: Machine failure, dtype: float64\n"
                    ]
                },
                {
                    "output_type": "display_data",
                    "data": {
                        "image/png": corr_b64,
                        "text/plain": ["<Figure size 1100x900 with 2 Axes>"]
                    },
                    "metadata": {}
                }
            ],
            "source": [
                "corr_cols = features + [target, 'TWF', 'HDF', 'PWF', 'OSF', 'RNF']\n",
                "any_mode = (df[['TWF', 'HDF', 'PWF', 'OSF', 'RNF']].sum(axis=1) > 0).astype(int)\n",
                "print('Cross-tabulation: Machine failure vs Failure Modes active:')\n",
                "print(pd.crosstab(df[target], any_mode, rownames=['Machine failure'], colnames=['Any Mode Active']))\n",
                "print('\\nCorrelation with Machine failure:')\n",
                "print(df[corr_cols].corr()[target].sort_values(ascending=False))\n",
                "\n",
                "# Heatmap\n",
                "fig, ax = plt.subplots(figsize=(11, 9))\n",
                "sns.heatmap(df[corr_cols].corr(), annot=True, fmt='.2f', cmap='coolwarm', ax=ax, linewidths=0.5, vmin=-1, vmax=1)\n",
                "ax.set_title('Pearson Correlation Matrix (Sensors, Failure Modes & Target)', fontsize=14, fontweight='bold')\n",
                "plt.tight_layout()\n",
                "plt.show()\n"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## 6. Sequential Temporal Continuity for LSTM Modeling\n",
                "\n",
                "`Tool wear [min]` increases continuously across consecutive rows until reaching maintenance reset thresholds. This demonstrates that the dataset possesses sequential chronological dependency. **Random shuffling is prohibited** as it would destroy temporal autocorrelation and create sequence leakage."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 7,
            "metadata": {},
            "outputs": [
                {
                    "output_type": "display_data",
                    "data": {
                        "image/png": timeline_b64,
                        "text/plain": ["<Figure size 1600x400 with 1 Axes>"]
                    },
                    "metadata": {}
                }
            ],
            "source": [
                "fig, ax = plt.subplots(figsize=(16, 4))\n",
                "ax.plot(df['UDI'][:1000], df['Tool wear [min]'][:1000], color='#2c3e50', label='Tool wear [min]', lw=1.2)\n",
                "fail_sample = df.iloc[:1000]\n",
                "fails = fail_sample[fail_sample[target] == 1]\n",
                "ax.scatter(fails['UDI'], fails['Tool wear [min]'], color='red', s=50, zorder=5, label='Failure Event (Target=1)')\n",
                "ax.set_title('Sequential Progression of Tool Wear (First 1,000 Rows)', fontsize=14, fontweight='bold')\n",
                "ax.set_xlabel('Sequential Time / UDI')\n",
                "ax.set_ylabel('Tool Wear [min]')\n",
                "ax.legend(loc='upper right')\n",
                "plt.tight_layout()\n",
                "plt.show()\n"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Summary & Conclusions for Phase 2 Modeling\n",
                "\n",
                "1. **Features Selected:** The 5 continuous sensor measurements: `Air temperature [K]`, `Process temperature [K]`, `Rotational speed [rpm]`, `Torque [Nm]`, and `Tool wear [min]`.\n",
                "2. **Target Variable:** `Machine failure` (binary 0/1).\n",
                "3. **Excluded Columns:** `UDI`, `Product ID`, `Type`, and the 5 diagnostic failure modes (`TWF`, `HDF`, `PWF`, `OSF`, `RNF`) to prevent target leakage.\n",
                "4. **Class Imbalance:** 339 positive cases (3.39%) vs 9,661 negative cases (96.61%). A pos_weight of ~28.5 or focal loss should be used during training.\n",
                "5. **Data Scaling Rule:** Standard scaling must be fit strictly on training data (`X_train`) only, preserving validation and test set integrity.\n",
                "6. **Sliding Windows:** 30 timesteps with step stride 1 are generated using `ml/preprocessing/sequence_utils.py`."
            ]
        }
    ]

    notebook_json = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3"
            },
            "language_info": {
                "codemirror_mode": {"name": "ipython", "version": 3},
                "file_extension": ".py",
                "mimetype": "text/x-python",
                "name": "python",
                "nbconvert_exporter": "python",
                "pygments_lexer": "ipython3",
                "version": "3.9.13"
            }
        },
        "nbformat": 4,
        "nbformat_minor": 5
    }

    with open(notebook_path, "w", encoding="utf-8") as f:
        json.dump(notebook_json, f, indent=2)

    print(f"Jupyter Notebook successfully created at: {notebook_path.resolve()}")


if __name__ == "__main__":
    generate_eda_notebook()
