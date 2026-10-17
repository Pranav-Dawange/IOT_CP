"""
PyTorch GRU Classifier for Industrial Machine Failure Prediction.

Experiment C Architecture:
- Input shape:     (batch_size, sequence_length=30, input_size=5)
- GRU layers:      Configurable hidden_size (64), num_layers (2), dropout (0.2), bidirectional (False)
- Representation:  Final timestep hidden representation
- Output:          Single raw logit (batch_size, 1)

ARCHITECTURAL NOTES:
1. Sigmoid is intentionally NOT applied inside this model. The model outputs raw logits.
   This allows training with nn.BCEWithLogitsLoss, which combines a Sigmoid layer
   and binary cross-entropy loss using the log-sum-exp trick for superior numerical stability.
2. The final representation extracts the operational state at timestep t (after observing
   the previous 30 sensor measurements).
3. Gated Recurrent Unit (GRU) merges the forget and input gates into a single update gate,
   and merges cell state and hidden state, yielding a more compact recurrent representation
   than LSTM while retaining temporal dependency modeling.
"""

from typing import Tuple

import torch
import torch.nn as nn


class GRUClassifier(nn.Module):
    """
    Configurable GRU classifier for sequential binary failure prediction.

    Default hyperparameters:
        input_size: 5 (Air temp, Process temp, Rotational speed, Torque, Tool wear)
        hidden_size: 64
        num_layers: 2
        dropout: 0.2
        bidirectional: False
    """

    def __init__(
        self,
        input_size: int = 5,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.2,
        bidirectional: bool = False,
    ):
        super().__init__()
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.dropout_rate = dropout
        self.bidirectional = bidirectional

        # In PyTorch, GRU dropout is applied between stacked GRU layers (num_layers > 1)
        gru_dropout = dropout if num_layers > 1 else 0.0

        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=gru_dropout,
            batch_first=True,
            bidirectional=bidirectional,
        )

        # Output projection dimension depends on bidirectionality
        fc_in_features = hidden_size * 2 if bidirectional else hidden_size

        self.dropout_layer = nn.Dropout(p=dropout)
        self.fc = nn.Linear(in_features=fc_in_features, out_features=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass through GRU classifier.

        Args:
            x: Input tensor of shape (batch_size, sequence_length, input_size).
               Default expected shape: (batch_size, 30, 5).

        Returns:
            logits: Raw unactivated logits of shape (batch_size, 1).
                    NOTE: Raw logits are required by nn.BCEWithLogitsLoss.
                    To obtain failure probabilities during inference, apply torch.sigmoid(logits).
        """
        # x shape: (batch_size, seq_len, input_size)
        out, h_n = self.gru(x)

        # Extract final timestep hidden representation
        if not self.bidirectional:
            # Last timestep of the sequence: out[:, -1, :] shape: (batch_size, hidden_size)
            final_repr = out[:, -1, :]
        else:
            # Concatenate the final forward hidden state and final backward hidden state
            # h_n shape: (num_layers * 2, batch_size, hidden_size)
            # h_n[-2] is the last layer forward, h_n[-1] is the last layer backward
            final_repr = torch.cat([h_n[-2], h_n[-1]], dim=-1)

        # Apply dropout regularization prior to classification head
        dropped = self.dropout_layer(final_repr)

        # Project to single scalar logit per sample: shape (batch_size, 1)
        logits = self.fc(dropped)
        return logits
