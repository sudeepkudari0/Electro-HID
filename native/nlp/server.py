import sys
import argparse
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import spacy

app = FastAPI(title="Synapse spaCy NLP Service")

# Allow CORS for Electron renderer
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

nlp = None

@app.on_event("startup")
def initialize_model():
    global nlp
    try:
        nlp = spacy.load("en_core_web_sm")
        print("[spaCy NLP Server] Loaded en_core_web_sm model successfully.")
    except Exception as e:
        print(f"[spaCy NLP Server] ERROR: Failed to load spaCy model: {e}", file=sys.stderr)
        print("[spaCy NLP Server] Please ensure en_core_web_sm is installed: python -m spacy download en_core_web_sm", file=sys.stderr)

class TextRequest(BaseModel):
    text: str

@app.post("/nlp/check-completeness")
async def check_completeness(req: TextRequest):
    if not nlp:
        raise HTTPException(status_code=503, detail="NLP model not loaded")
    
    text = req.text.strip()
    if not text:
        return {"is_complete": False, "reason": "empty"}
        
    doc = nlp(text)
    
    # 1. Check for root token
    roots = [token for token in doc if token.head == token]
    if not roots:
        return {"is_complete": False, "reason": "no root"}
        
    # 2. Check for verb / auxiliary presence
    has_verb = any(token.pos_ in ["VERB", "AUX"] for token in doc)
    if not has_verb:
        return {"is_complete": False, "reason": "no verb"}
        
    # 3. Check for trailing preposition or subordinating conjunction
    last_token = doc[-1]
    if last_token.pos_ in ["ADP", "SCONJ"] and last_token.dep_ in ["prep", "mark"]:
        return {"is_complete": False, "reason": "trailing preposition"}
        
    return {"is_complete": True, "reason": "plausibly complete"}

@app.get("/")
def health():
    return {"status": "ok", "service": "spacy-nlp-server", "loaded": nlp is not None}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', type=str, default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8179)
    args, unknown = parser.parse_known_args() 

    print(f"[spaCy NLP Server] Starting server on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
