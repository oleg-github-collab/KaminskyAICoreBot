"""Python Processor Microservice — FastAPI application.

Provides accurate document counting, text/table/metadata extraction,
DeepL SDK integration, and AI services.
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
import document_engine

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
    return {"status": "ok", "service": "processor", "version": "2.0"}


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


# ─── Text Extraction (powered by document_engine) ────────────────────────────

@app.post("/extract-text")
async def extract_text(
    file: UploadFile = File(...),
    authorization: str = Header(default=""),
):
    """Extract text from any supported document format.

    Supports: PDF, DOCX, DOC, XLSX, XLS, PPTX, RTF, ODT, ODS, ODP,
              HTML, EPUB, images (OCR), TXT, CSV, JSON, XML, and more.
    """
    verify_auth(authorization)
    file_bytes = await file.read()
    filename = file.filename or "unknown"

    try:
        result = document_engine.extract_text(file_bytes, filename)
        return result
    except Exception as e:
        logger.error(f"Text extraction failed for {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to extract text: {str(e)}")


# ─── Metadata Extraction ─────────────────────────────────────────────────────

@app.post("/extract-metadata")
async def extract_metadata(
    file: UploadFile = File(...),
    authorization: str = Header(default=""),
):
    """Extract document metadata (author, title, dates, pages, language)."""
    verify_auth(authorization)
    file_bytes = await file.read()
    filename = file.filename or "unknown"

    try:
        result = document_engine.extract_metadata(file_bytes, filename)
        return result
    except Exception as e:
        logger.error(f"Metadata extraction failed for {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to extract metadata: {str(e)}")


# ─── Table Extraction ────────────────────────────────────────────────────────

@app.post("/extract-tables")
async def extract_tables(
    file: UploadFile = File(...),
    authorization: str = Header(default=""),
):
    """Extract tables from PDF, DOCX, XLSX, PPTX."""
    verify_auth(authorization)
    file_bytes = await file.read()
    filename = file.filename or "unknown"

    try:
        result = document_engine.extract_tables(file_bytes, filename)
        return result
    except Exception as e:
        logger.error(f"Table extraction failed for {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to extract tables: {str(e)}")


# ─── OCR ──────────────────────────────────────────────────────────────────────

@app.post("/ocr")
async def ocr_image(
    file: UploadFile = File(...),
    lang: str = Form("ukr+deu+eng+rus+pol"),
    authorization: str = Header(default=""),
):
    """OCR: extract text from image or scanned PDF via PaddleOCR."""
    verify_auth(authorization)
    file_bytes = await file.read()
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename.lower())[1].lstrip(".")

    try:
        if ext == "pdf":
            # Scanned PDF → pdf2image → PaddleOCR
            text = document_engine._ocr_pdf(file_bytes)
            if text:
                return {"text": text, "length": len(text), "method": "ocr_pdf", "format": "pdf"}
            raise HTTPException(status_code=400, detail="OCR produced no text")
        elif ext in ("png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp"):
            result = document_engine._extract_image_ocr(file_bytes, filename)
            return result
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format for OCR: {ext}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OCR failed for {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"OCR failed: {str(e)}")


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
