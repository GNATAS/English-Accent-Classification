"""Accent Finder backend. Run: uvicorn app:app --port 8000   (from backend/)"""
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

from accent.features import extract
from accent.model import AccentClassifier

ROOT = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("MODEL_DIR", ROOT / "models"))
MAX_BYTES = 10 * 1024 * 1024

app = FastAPI(title="Accent Finder")
clf = AccentClassifier(MODEL_DIR)


@app.get("/api/health")
def health():
    return {"ok": True, "classes": clf.classes, "ensemble": len(clf.models), "tau": clf.tau}


@app.post("/api/predict")
async def predict(request: Request):
    data = await request.body()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413 if data else 400, "Send a WAV body of up to 10 MB.")
    try:
        feats = extract(data)
    except Exception as e:
        raise HTTPException(422, f"Could not read audio: {e}")
    return {"probs": clf.predict(feats)}


app.mount("/", StaticFiles(directory=ROOT.parent / "frontend", html=True), name="frontend")
