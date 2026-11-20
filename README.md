# English Accent Classification

Classifies a short speech clip into one of 9 English accents (us, england, indian, australia, canada,
scotland, ireland, newzealand, african) using Common Voice data.

    pipeline/   Kaggle notebooks: 01 feature extraction, 02 MLP baselines (+ prepare_data.py)
    backend/    FastAPI server: audio -> log-Mel stats -> 5-seed MLP ensemble
    frontend/   Single-page demo (record / upload, spectrogram, ranked probabilities)

## Run the demo locally

1. The Mel-MLP checkpoints are already in `backend/models/` (`tau` is set in `config.json`).
2. ```
   cd backend
   pip install -r requirements.txt
   uvicorn app:app --port 8000
   ```
3. Open http://localhost:8000

`GET /api/health` shows the loaded classes and ensemble size; `POST /api/predict` takes a WAV body and returns `{"probs": {...}}`.

## Results (test, 9 classes, 5-seed ensemble + logit adjustment)

| features | macro-F1 | acc |
|---|---|---|
| log-Mel stats | 0.843 | 0.803 |
| Whisper + Mel | 0.785 | 0.814 |
| Whisper | 0.635 | 0.715 |

Caveat: Mel scores suspiciously high on some classes, which may mean speaker or channel leakage across splits
(the dataset has no `client_id` to check).
