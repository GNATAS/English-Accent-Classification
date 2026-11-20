"""Audio -> 384-d log-Mel statistics vector. Mirrors pipeline/01 (mel_one) and pipeline/02 (mel_stats_pool) exactly."""
import io

import librosa
import numpy as np

SR, DURATION = 16_000, 6.0
N_MELS, N_FFT, HOP = 128, 1024, 256


def load_audio(data: bytes) -> tuple[np.ndarray, int]:
    """mono, 16 kHz, trim silence, centre-crop / zero-pad to DURATION seconds."""
    y, _ = librosa.load(io.BytesIO(data), sr=SR, mono=True)
    if len(y):
        y, _ = librosa.effects.trim(y, top_db=30)
    if len(y) < SR * 0.5:
        raise ValueError("Audio is too short or silent (need at least 0.5 s of speech).")
    n = int(SR * DURATION)
    if len(y) >= n:
        s = (len(y) - n) // 2
        return y[s:s + n], n
    return np.pad(y, (0, n - len(y))), len(y)


def log_mel(y: np.ndarray) -> np.ndarray:
    m = librosa.feature.melspectrogram(y=y, sr=SR, n_fft=N_FFT, hop_length=HOP, n_mels=N_MELS, fmin=20, fmax=8000)
    return librosa.power_to_db(m, ref=1.0, top_db=80.0).astype(np.float16)  # [n_mels, T]


def mel_stats(mel: np.ndarray) -> np.ndarray:
    """mean / std / delta-std over valid (non-padded) frames -> [3 * n_mels]."""
    x = mel.astype(np.float32)[None]                       # [1, F, T]
    valid = np.ptp(x, axis=1) > 1e-3                       # padded frames are flat
    valid[valid.sum(1) < 2] = True
    w = valid[:, None, :].astype(np.float32)
    n = w.sum(-1)
    mean = (x * w).sum(-1) / n
    std = np.sqrt((((x - mean[..., None]) ** 2) * w).sum(-1) / n)
    d = np.diff(x, axis=-1)
    wd = w[..., 1:] * w[..., :-1]
    nd = np.maximum(wd.sum(-1), 1)
    dmu = (d * wd).sum(-1) / nd
    dstd = np.sqrt((((d - dmu[..., None]) ** 2) * wd).sum(-1) / nd)
    return np.concatenate([mean, std, dstd], 1).astype(np.float32)[0]


def extract(data: bytes) -> np.ndarray:
    y, _ = load_audio(data)
    return mel_stats(log_mel(y))
