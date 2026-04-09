"""
FastAPI application for the roof-geometry parsing microservice.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models.schemas import RoofParseRequest, RoofParseResponse
from pipeline.orchestrator import RoofParsingPipeline
from pipeline.shading_engine import run_shading_engine
from pipeline.shading_engine.schemas import ShadingRequest, ShadingResponse

app = FastAPI(
    title="Roof Geometry Parser",
    description="Parses LiDAR + imagery into structured roof geometry for the solar CRM.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pipeline = RoofParsingPipeline()

SAMPLES_DIR = Path(__file__).parent / "samples"


@app.get("/health")
async def health():
    return {"status": "ok", "pipeline_version": pipeline.version}


@app.get("/roof/parse/sample")
async def sample_request():
    """Return the sample request JSON for testing."""
    sample_path = SAMPLES_DIR / "sample_request.json"
    if not sample_path.exists():
        raise HTTPException(status_code=404, detail="Sample request file not found")
    with open(sample_path) as f:
        return json.load(f)


@app.post("/roof/parse", response_model=RoofParseResponse)
async def parse_roof(request: RoofParseRequest):
    """Run the full roof parsing pipeline."""
    try:
        result = await pipeline.parse(request)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/roof/shading", response_model=ShadingResponse)
async def shading(request: ShadingRequest):
    """Compute clear-sky annual POA irradiance per roof section."""
    try:
        return run_shading_engine(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
