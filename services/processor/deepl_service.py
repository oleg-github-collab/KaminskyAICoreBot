"""DeepL API SDK wrapper — full translation capabilities."""

import io
import os
import time
import logging

import deepl

logger = logging.getLogger(__name__)

_translator = None


def get_translator() -> deepl.Translator:
    global _translator
    if _translator is None:
        key = os.environ.get("DEEPL_API_KEY", "")
        if not key:
            raise RuntimeError("DEEPL_API_KEY not configured")
        _translator = deepl.Translator(key)
    return _translator


def translate_text(
    text: str,
    source_lang: str,
    target_lang: str,
    formality: str = "default",
    context: str = "",
    glossary_id: str = "",
    split_sentences: str = "1",
    preserve_formatting: bool = True,
    tag_handling: str = "",
) -> dict:
    """Translate text with full DeepL parameter support."""
    translator = get_translator()

    kwargs = {
        "text": text,
        "source_lang": source_lang.upper() if source_lang else None,
        "target_lang": target_lang.upper(),
        "preserve_formatting": preserve_formatting,
    }

    # Formality (only supported for certain target languages)
    if formality and formality != "default":
        kwargs["formality"] = formality

    # Context (not billed by DeepL)
    if context:
        kwargs["context"] = context

    # Glossary
    if glossary_id:
        kwargs["glossary"] = glossary_id

    # Split sentences
    if split_sentences and split_sentences != "1":
        kwargs["split_sentences"] = split_sentences

    # Tag handling
    if tag_handling:
        kwargs["tag_handling"] = tag_handling

    result = translator.translate_text(**kwargs)

    return {
        "translated_text": result.text,
        "detected_source_lang": result.detected_source_lang,
    }


def translate_document(
    file_bytes: bytes,
    filename: str,
    source_lang: str,
    target_lang: str,
    formality: str = "default",
    glossary_id: str = "",
) -> dict:
    """Translate a document preserving formatting. Returns translated file bytes."""
    translator = get_translator()

    input_buf = io.BytesIO(file_bytes)
    input_buf.name = filename
    output_buf = io.BytesIO()

    kwargs = {
        "input_document": input_buf,
        "output_document": output_buf,
        "source_lang": source_lang.upper() if source_lang else None,
        "target_lang": target_lang.upper(),
    }

    if formality and formality != "default":
        kwargs["formality"] = formality

    if glossary_id:
        kwargs["glossary"] = glossary_id

    translator.translate_document(**kwargs)

    return {
        "translated_bytes": output_buf.getvalue(),
        "filename": f"translated_{filename}",
    }


def create_glossary(
    name: str,
    source_lang: str,
    target_lang: str,
    entries_tsv: str,
) -> dict:
    """Create a DeepL glossary from TSV content."""
    translator = get_translator()

    glossary = translator.create_glossary_from_csv(
        name=name,
        source_lang=source_lang.upper(),
        target_lang=target_lang.upper(),
        csv_data=entries_tsv.encode("utf-8"),
        csv_format="tsv",
    )

    return {
        "glossary_id": glossary.glossary_id,
        "name": glossary.name,
        "source_lang": glossary.source_lang,
        "target_lang": glossary.target_lang,
        "entry_count": glossary.entry_count,
        "creation_time": str(glossary.creation_time),
    }


def validate_glossary_tsv(
    tsv_content: str,
    source_lang: str,
    target_lang: str,
) -> dict:
    """Validate TSV content for DeepL glossary compatibility."""
    errors = []
    warnings = []
    valid_entries = 0

    lines = tsv_content.strip().split("\n")
    seen_sources = set()

    for i, line in enumerate(lines, 1):
        line = line.strip()
        if not line:
            continue

        parts = line.split("\t")
        if len(parts) < 2:
            errors.append(f"Line {i}: missing tab separator")
            continue

        source = parts[0].strip()
        target = parts[1].strip()

        if not source:
            errors.append(f"Line {i}: empty source term")
            continue
        if not target:
            errors.append(f"Line {i}: empty target term")
            continue

        if len(source) > 1024:
            errors.append(f"Line {i}: source term exceeds 1024 characters")
            continue
        if len(target) > 1024:
            errors.append(f"Line {i}: target term exceeds 1024 characters")
            continue

        if source.lower() in seen_sources:
            warnings.append(f"Line {i}: duplicate source term '{source}'")
        seen_sources.add(source.lower())

        valid_entries += 1

    return {
        "valid": len(errors) == 0,
        "valid_entries": valid_entries,
        "total_lines": len(lines),
        "errors": errors,
        "warnings": warnings,
    }


def delete_glossary(glossary_id: str) -> dict:
    translator = get_translator()
    translator.delete_glossary(glossary_id)
    return {"deleted": True, "glossary_id": glossary_id}


def list_glossaries() -> dict:
    translator = get_translator()
    glossaries = translator.list_glossaries()
    return {
        "glossaries": [
            {
                "glossary_id": g.glossary_id,
                "name": g.name,
                "source_lang": g.source_lang,
                "target_lang": g.target_lang,
                "entry_count": g.entry_count,
                "creation_time": str(g.creation_time),
            }
            for g in glossaries
        ]
    }


def get_usage() -> dict:
    translator = get_translator()
    usage = translator.get_usage()
    result = {}
    if usage.character:
        result["character_count"] = usage.character.count
        result["character_limit"] = usage.character.limit
    if usage.document:
        result["document_count"] = usage.document.count
        result["document_limit"] = usage.document.limit
    return result
