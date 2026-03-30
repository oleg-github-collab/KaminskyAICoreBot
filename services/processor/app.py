"""Python Processor Microservice — FastAPI application.

Provides accurate document counting, DeepL SDK integration, and GPT-5.4-nano AI services.
Authenticated via INTERNAL_API_KEY bearer token.
"""

import io
import os
import logging
import base64

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

import counter
import deepl_service
import ai_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="KI Processor", docs_url=None, redoc_url=None)

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


def verify_auth(authorization: str = Header(default="")):
    if not INTERNAL_API_KEY:
        return  # Dev mode: no auth required
    expected = f"Bearer {INTERNAL_API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "processor"}


# ─── Document Counting ───────────────────────────────────────────────────────

@app.post("/count")
async def count_document(
    file: UploadFile = File(...),
    authorization: str = Header(default=""),
):
    verify_auth(authorization)
    file_bytes = await file.read()
    filename = file.filename or "unknown"
    result = counter.count_file(file_bytes, filename)
    return result


# ─── DeepL Text Translation ─────────────────────────────────────────────────

@app.post("/deepl/translate-text")
async def deepl_translate_text(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    result = deepl_service.translate_text(
        text=body["text"],
        source_lang=body.get("source_lang", ""),
        target_lang=body["target_lang"],
        formality=body.get("formality", "default"),
        context=body.get("context", ""),
        glossary_id=body.get("glossary_id", ""),
        split_sentences=body.get("split_sentences", "1"),
        preserve_formatting=body.get("preserve_formatting", True),
        tag_handling=body.get("tag_handling", ""),
    )
    return result


# ─── DeepL Document Translation ─────────────────────────────────────────────

@app.post("/deepl/translate-document")
async def deepl_translate_document(
    file: UploadFile = File(...),
    source_lang: str = Form(""),
    target_lang: str = Form("EN"),
    formality: str = Form("default"),
    glossary_id: str = Form(""),
    authorization: str = Header(default=""),
):
    verify_auth(authorization)
    file_bytes = await file.read()
    filename = file.filename or "document"

    result = deepl_service.translate_document(
        file_bytes=file_bytes,
        filename=filename,
        source_lang=source_lang,
        target_lang=target_lang,
        formality=formality,
        glossary_id=glossary_id,
    )

    # Return translated file as base64 (for JSON transport)
    translated_bytes = result["translated_bytes"]
    return {
        "filename": result["filename"],
        "content_base64": base64.b64encode(translated_bytes).decode("ascii"),
        "size": len(translated_bytes),
    }


# ─── DeepL Glossary Management ──────────────────────────────────────────────

@app.post("/deepl/glossary/create")
async def deepl_create_glossary(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    return deepl_service.create_glossary(
        name=body["name"],
        source_lang=body["source_lang"],
        target_lang=body["target_lang"],
        entries_tsv=body["entries_tsv"],
    )


@app.post("/deepl/glossary/validate")
async def deepl_validate_glossary(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    return deepl_service.validate_glossary_tsv(
        tsv_content=body["tsv_content"],
        source_lang=body.get("source_lang", "EN"),
        target_lang=body.get("target_lang", "UK"),
    )


@app.get("/deepl/glossary/list")
async def deepl_list_glossaries(authorization: str = Header(default="")):
    verify_auth(authorization)
    return deepl_service.list_glossaries()


@app.delete("/deepl/glossary/{glossary_id}")
async def deepl_delete_glossary(glossary_id: str, authorization: str = Header(default="")):
    verify_auth(authorization)
    return deepl_service.delete_glossary(glossary_id)


@app.get("/deepl/usage")
async def deepl_usage(authorization: str = Header(default="")):
    verify_auth(authorization)
    return deepl_service.get_usage()


# ─── AI Term Extraction ─────────────────────────────────────────────────────

@app.post("/ai/extract-terms")
async def ai_extract_terms(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    return ai_service.extract_terms(
        source_text=body["source_text"],
        reference_text=body.get("reference_text", ""),
        source_lang=body.get("source_lang", "EN"),
        target_lang=body.get("target_lang", "UK"),
        instructions=body.get("instructions", ""),
        deepl_settings=body.get("deepl_settings"),
    )


@app.post("/ai/extract-terms-batch")
async def ai_extract_terms_batch(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    return ai_service.extract_terms_batch(chunks=body["chunks"])


@app.get("/ai/batch/{batch_id}")
async def ai_check_batch(batch_id: str, authorization: str = Header(default="")):
    verify_auth(authorization)
    return ai_service.check_batch(batch_id)


@app.post("/ai/generate-glossary-prompt")
async def ai_generate_prompt(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    return ai_service.generate_glossary_prompt(
        instructions=body["instructions"],
        source_lang=body.get("source_lang", "EN"),
        target_lang=body.get("target_lang", "UK"),
        deepl_settings=body.get("deepl_settings"),
    )


# ─── Voice Estimation ───────────────────────────────────────────────────────

@app.post("/voice/estimate")
async def voice_estimate(request: Request, authorization: str = Header(default="")):
    verify_auth(authorization)
    body = await request.json()

    return ai_service.estimate_voice(
        text=body["text"],
        language=body.get("language", "uk"),
    )


# ─── Error Handler ───────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal service error"},
    )
