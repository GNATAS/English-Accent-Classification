"""Loads the seed-ensemble of Mel-MLP checkpoints saved by pipeline/02_mlp.ipynb and runs inference."""
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


class MLP(nn.Module):  # identical to the notebook's definition so state_dicts load
    def __init__(self, d_in, n_cls, hidden=(512, 256), dropout=0.3):
        super().__init__()
        self.register_buffer("mu", torch.zeros(d_in))
        self.register_buffer("sd", torch.ones(d_in))
        layers, d = [], d_in
        for h in hidden:
            layers += [nn.Linear(d, h), nn.BatchNorm1d(h), nn.GELU(), nn.Dropout(dropout)]
            d = h
        layers.append(nn.Linear(d, n_cls))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net((x - self.mu) / self.sd)


class AccentClassifier:
    def __init__(self, model_dir: Path, feature: str = "mel"):
        files = sorted(Path(model_dir).glob(f"mlp_{feature}_seed*.pt"))
        if not files:
            raise FileNotFoundError(
                f"No checkpoints matching mlp_{feature}_seed*.pt in {model_dir}. See backend/models/README.md.")
        cfg_path = Path(model_dir) / "config.json"
        self.tau = float(json.loads(cfg_path.read_text()).get("tau", 0.0)) if cfg_path.exists() else 0.0
        self.models, self.log_prior = [], None
        for f in files:
            ck = torch.load(f, map_location="cpu", weights_only=False)
            m = MLP(ck["d_in"], len(ck["classes"]), ck["cfg"]["hidden"], ck["cfg"]["dropout"])
            m.load_state_dict(ck["state_dict"])
            self.models.append(m.eval())
            self.classes = list(ck["classes"])
            self.log_prior = np.asarray(ck["log_prior_val"], dtype=np.float32)

    @torch.no_grad()
    def predict(self, feats: np.ndarray) -> dict[str, float]:
        x = torch.as_tensor(feats, dtype=torch.float32)[None]
        p = torch.stack([m(x).softmax(-1)[0] for m in self.models]).mean(0).numpy()
        # logit adjustment for the val/test prior (tau tuned on val; 0 = plain ensemble)
        z = np.log(p + 1e-9) + self.tau * self.log_prior
        z = np.exp(z - z.max())
        z /= z.sum()
        return {c: float(v) for c, v in zip(self.classes, z)}
