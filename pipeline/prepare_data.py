"""Stage-1 data pipeline: Common Voice accent (cleaned/downsampled) -> features.

Steps (run in order, each is resumable):
  python prepare_data.py split   --meta meta.csv --audio-root clips/ --out data/
  python prepare_data.py mel     --out data/
  python prepare_data.py whisper --out data/ --model openai/whisper-small

Outputs in --out:
  splits.csv        path, label, label_id, split (train/val/test; speaker-disjoint if client_id exists)
  labels.json       accent <-> id
  mel.npy           float16 [N, n_mels, T]   log-mel (dB), raw (normalise with mel_stats.json)
  mel_stats.json    mean/std computed on TRAIN only
  whisper_seq.npy   float16 [N, T', D]       encoder frames, avg-pooled (for BiLSTM/CNN/Attention)
  whisper_pool.npy  float32 [N, D]           mean over valid frames (for MLP)
Row i of every .npy == row i of splits.csv.
"""
import argparse, json
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

SR = 16_000
PATH_COLS = ["path", "filename", "file", "audio_path", "clip"]
LABEL_COLS = ["accent", "accents", "label"]


# ----------------------------------------------------------------- audio
def load_audio(path, duration):
    """mono, 16 kHz, centre-crop / zero-pad to exactly `duration` seconds. Returns (wave, valid_samples)."""
    import librosa
    y, _ = librosa.load(path, sr=SR, mono=True)
    if len(y):
        y, _ = librosa.effects.trim(y, top_db=30)
    n = int(SR * duration)
    if len(y) >= n:
        s = (len(y) - n) // 2
        return y[s:s + n], n
    valid = len(y)
    return np.pad(y, (0, n - valid)), valid


# ----------------------------------------------------------------- split
def cmd_split(a):
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(a.meta)
    pcol = a.path_col or next(c for c in PATH_COLS if c in df.columns)
    lcol = a.label_col or next(c for c in LABEL_COLS if c in df.columns)
    df = df.dropna(subset=[pcol, lcol]).copy()

    root = Path(a.audio_root)
    def resolve(p):
        q = root / p
        if not q.suffix:
            q = q.with_suffix(a.ext)
        return str(q)
    df["path"] = df[pcol].map(resolve)
    df = df[df["path"].map(lambda p: Path(p).exists())]
    print(f"{len(df)} clips found on disk")

    if a.min_per_class:
        vc = df[lcol].value_counts()
        df = df[df[lcol].isin(vc[vc >= a.min_per_class].index)]
    classes = sorted(df[lcol].unique())
    lab2id = {c: i for i, c in enumerate(classes)}
    df["label"] = df[lcol]
    df["label_id"] = df[lcol].map(lab2id)

    # 80/10/10, stratified, speaker-disjoint when client_id is available
    from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
    has_groups = "client_id" in df.columns
    y = df["label_id"].values
    if has_groups:
        folds = list(StratifiedGroupKFold(10, shuffle=True, random_state=a.seed).split(df, y, df["client_id"]))
    else:
        folds = list(StratifiedKFold(10, shuffle=True, random_state=a.seed).split(df, y))
    df["split"] = "train"
    df.iloc[folds[0][1], df.columns.get_loc("split")] = "val"
    df.iloc[folds[1][1], df.columns.get_loc("split")] = "test"

    keep = ["path", "label", "label_id", "split"] + (["client_id"] if has_groups else [])
    df[keep].reset_index(drop=True).to_csv(out / "splits.csv", index=False)
    json.dump(lab2id, open(out / "labels.json", "w"), indent=2)
    print(df.groupby(["split", "label"]).size().unstack(0))


# ----------------------------------------------------------------- mel
def _mel(path, a):
    import librosa
    y, _ = load_audio(path, a.duration)
    m = librosa.feature.melspectrogram(y=y, sr=SR, n_fft=1024, hop_length=a.hop,
                                       n_mels=a.n_mels, fmin=20, fmax=8000)
    return librosa.power_to_db(m, ref=1.0, top_db=80.0).astype(np.float16)

def cmd_mel(a):
    from joblib import Parallel, delayed
    out = Path(a.out); df = pd.read_csv(out / "splits.csv")
    feats = Parallel(n_jobs=a.jobs)(delayed(_mel)(p, a) for p in tqdm(df["path"], desc="mel"))
    X = np.stack(feats)                                   # [N, n_mels, T]
    np.save(out / "mel.npy", X)
    tr = X[(df["split"] == "train").values].astype(np.float32)
    json.dump({"mean": float(tr.mean()), "std": float(tr.std())}, open(out / "mel_stats.json", "w"))
    print("mel", X.shape)


# ----------------------------------------------------------------- whisper
def cmd_whisper(a):
    import torch
    from transformers import WhisperFeatureExtractor, WhisperModel
    out = Path(a.out); df = pd.read_csv(out / "splits.csv")
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    fe = WhisperFeatureExtractor.from_pretrained(a.model)
    enc = WhisperModel.from_pretrained(a.model).encoder.to(dev).eval()
    if dev == "cuda":
        enc.half()
    frames = int(a.duration * 50)                         # encoder emits 50 frames/s
    frames -= frames % a.pool
    seqs, pools = [], []
    paths = df["path"].tolist()
    for i in tqdm(range(0, len(paths), a.batch), desc="whisper"):
        wavs, valids = zip(*[load_audio(p, a.duration) for p in paths[i:i + a.batch]])
        x = fe(list(wavs), sampling_rate=SR, return_tensors="pt").input_features.to(dev)  # padded to 30 s
        if dev == "cuda":
            x = x.half()
        with torch.no_grad():
            h = enc(x).last_hidden_state[:, :frames].float()      # [B, frames, D]
        for j, v in enumerate(valids):
            nv = max(1, min(frames, int(v / SR * 50)))
            pools.append(h[j, :nv].mean(0).cpu().numpy())
        B, _, D = h.shape
        seqs.append(h.view(B, frames // a.pool, a.pool, D).mean(2).cpu().numpy().astype(np.float16))
    seq = np.concatenate(seqs)
    np.save(out / "whisper_seq.npy", seq)
    np.save(out / "whisper_pool.npy", np.stack(pools).astype(np.float32))
    print("whisper_seq", seq.shape)


# ----------------------------------------------------------------- torch datasets
def make_datasets(out, feature, normalise=True):
    """feature in {'mel','whisper_seq','whisper_pool'} -> {'train','val','test'} torch Datasets.
    mel items are [1, n_mels, T] (CNN); use x.squeeze(0).T -> [T, n_mels] for BiLSTM/Attention."""
    import torch
    from torch.utils.data import Dataset
    out = Path(out); df = pd.read_csv(out / "splits.csv")
    X = np.load(out / f"{feature}.npy", mmap_mode="r")
    st = json.load(open(out / "mel_stats.json")) if feature == "mel" and normalise else None
    y = df["label_id"].values

    class DS(Dataset):
        def __init__(s, idx): s.idx = idx
        def __len__(s): return len(s.idx)
        def __getitem__(s, k):
            i = s.idx[k]; x = np.asarray(X[i], dtype=np.float32)
            if st:
                x = (x - st["mean"]) / (st["std"] + 1e-6)
            if feature == "mel":
                x = x[None]
            return torch.from_numpy(x), int(y[i])
    return {s: DS(np.where(df["split"] == s)[0]) for s in ("train", "val", "test")}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    def common(s):
        s.add_argument("--out", default="data")
        s.add_argument("--duration", type=float, default=6.0)
    s = sub.add_parser("split"); common(s)
    s.add_argument("--meta", required=True); s.add_argument("--audio-root", required=True)
    s.add_argument("--path-col"); s.add_argument("--label-col"); s.add_argument("--ext", default=".mp3")
    s.add_argument("--min-per-class", type=int, default=0); s.add_argument("--seed", type=int, default=42)
    s = sub.add_parser("mel"); common(s)
    s.add_argument("--n-mels", type=int, default=128); s.add_argument("--hop", type=int, default=256)
    s.add_argument("--jobs", type=int, default=-1)
    s = sub.add_parser("whisper"); common(s)
    s.add_argument("--model", default="openai/whisper-small"); s.add_argument("--batch", type=int, default=16)
    s.add_argument("--pool", type=int, default=4, help="avg-pool factor over time (50 fps -> 12.5 fps)")
    a = p.parse_args()
    {"split": cmd_split, "mel": cmd_mel, "whisper": cmd_whisper}[a.cmd](a)
