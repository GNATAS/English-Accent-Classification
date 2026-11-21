# English Accent Classification

Classifies a short speech clip into one of 9 English accents (us, england, indian, australia, canada,
scotland, ireland, newzealand, african) using Common Voice data.

    pipeline/   Kaggle notebooks: 01 feature extraction, 02 MLP baselines (+ prepare_data.py)
    backend/    FastAPI server: audio -> log-Mel stats -> 5-seed MLP ensemble
    frontend/   Accent Quest: Thai-language practice game (record / upload, playback, 5 lessons)

## Run the demo locally

1. The Mel-MLP checkpoints are already in `backend/models/` (`tau` is set in `config.json`).
2. ```
   cd backend
   pip install -r requirements.txt
   uvicorn app:app --port 8000
   ```
3. Open http://localhost:8000

`GET /api/health` shows the loaded classes and ensemble size; `POST /api/predict` takes a WAV body and returns `{"probs": {...}}`.

## Accent Quest

Choose one of the nine target labels, then practise five short English sentences.
Record up to six seconds or upload an audio file (up to 10 MB; longer clips use the centre six seconds).
Listen back, inspect the model's probabilities, retry, and move to the next lesson.
You pass a lesson and receive 20 XP only when the target is the model's unique top prediction.
A mismatch or a tie awards no XP and does not unlock the next lesson; listen back and retry.
Each lesson awards XP only once. Finish all five lessons for 100 XP per session.
Progress from the earlier participation-only rule is not carried into this version (`accent-quest-v2`).

Progress and the current session's XP are stored in this browser's localStorage; changing target resets the session after confirmation.
Recordings and predictions are not saved. Audio is sent only to the demo backend for inference and is not stored by the app.
Google Fonts is used for typography, with local fallbacks.

**This is a practice game, not a pronunciation assessor.** Model probabilities are not pronunciation scores,
native-speaker similarity, or calibrated measures of improvement. The classifier does not check the words read.
Tips are general written practice suggestions, not audio-derived or accent-specific coaching.
Each geographic label contains variation; `african` is a broad dataset grouping, not one accent.
The model's dataset limitations below still apply.

Microphone recording needs localhost or HTTPS and permission in the browser. Upload is available as a fallback.

Frontend state/validation tests (Node.js, no package installation):

```sh
node --test frontend/game.test.mjs
node --check frontend/app.js
```

## Results (test, 9 classes, 5-seed ensemble + logit adjustment)

| features | macro-F1 | acc |
|---|---|---|
| log-Mel stats | 0.843 | 0.803 |
| Whisper + Mel | 0.785 | 0.814 |
| Whisper | 0.635 | 0.715 |

Caveat: Mel scores suspiciously high on some classes, which may mean speaker or channel leakage across splits
(the dataset has no `client_id` to check).
