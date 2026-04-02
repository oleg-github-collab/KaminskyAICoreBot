"""O.Translator API wrapper — document and text translation service.

Base URL: https://otranslator.com/api/v1
Auth: Authorization: <api_key> (no Bearer prefix)
Languages: full names — "Ukrainian", "English", "German"
"""

import os
import time
import logging
import requests

logger = logging.getLogger(__name__)

API_KEY = os.environ.get("OTRANSLATOR_API_KEY", "")
BASE_URL = "https://otranslator.com/api/v1"
POLL_INTERVAL = 3  # seconds
MAX_POLL_TIME = 600  # 10 minutes

# Map short codes to full language names used by o.translator API
LANG_MAP = {
    "uk": "Ukrainian", "de": "German", "en": "English",
    "ru": "Russian", "pl": "Polish", "fr": "French",
    "es": "Spanish", "it": "Italian", "pt": "Portuguese",
    "nl": "Dutch", "cs": "Czech", "sv": "Swedish",
    "da": "Danish", "fi": "Finnish", "hu": "Hungarian",
    "ro": "Romanian", "bg": "Bulgarian", "sk": "Slovak",
    "sl": "Slovenian", "hr": "Croatian", "et": "Estonian",
    "lv": "Latvian", "lt": "Lithuanian", "el": "Greek",
    "ja": "Japanese", "zh": "Chinese", "ko": "Korean",
    "ar": "Arabic", "tr": "Turkish",
}


def _headers(json_content=False):
    h = {"Authorization": API_KEY}
    if json_content:
        h["Content-Type"] = "application/json"
    return h


def _resolve_lang(code: str) -> str:
    """Convert short code (e.g. 'uk') to full name (e.g. 'Ukrainian')."""
    if not code:
        return ""
    lower = code.lower().strip()
    if lower in LANG_MAP:
        return LANG_MAP[lower]
    # Already a full name?
    for full in LANG_MAP.values():
        if lower == full.lower():
            return full
    return code  # Return as-is, let API validate


# ─── Text Translation (synchronous) ─────────────────────────────────

def translate_text(
    texts: list,
    source_lang: str,
    target_lang: str,
    model: str = "",
    description: str = "",
) -> dict:
    """Translate text segments synchronously via o.translator API.

    Args:
        texts: List of text strings to translate.
        source_lang: Source language code (e.g. 'en', 'de').
        target_lang: Target language code (e.g. 'uk').
        model: Optional model override.
        description: Context description for better quality.

    Returns:
        dict with translatedTexts[], taskId, price, usedCredits
    """
    if not API_KEY:
        raise ValueError("OTRANSLATOR_API_KEY not configured")

    payload = {
        "texts": texts,
        "fromLang": _resolve_lang(source_lang),
        "toLang": _resolve_lang(target_lang),
    }
    if model:
        payload["model"] = model
    if description:
        payload["fileDescription"] = description

    logger.info(f"O.Translator text: {len(texts)} segments, {source_lang}→{target_lang}")

    resp = requests.post(
        f"{BASE_URL}/translation/translateTexts",
        headers=_headers(json_content=True),
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    result = resp.json()

    logger.info(f"O.Translator text result: taskId={result.get('taskId')}, "
                f"credits={result.get('usedCredits')}")
    return result


# ─── Document Translation (async: create + poll) ────────────────────

def translate_document(
    file_bytes: bytes,
    filename: str,
    source_lang: str,
    target_lang: str,
    glossary_name: str = "",
    description: str = "",
) -> dict:
    """Translate a document via o.translator API (async with polling).

    Returns:
        dict with translated_bytes, filename, taskId
    """
    if not API_KEY:
        raise ValueError("OTRANSLATOR_API_KEY not configured")

    logger.info(f"O.Translator doc: {filename} ({len(file_bytes)} bytes), "
                f"{source_lang}→{target_lang}")

    # Step 1: Create translation task
    data = {
        "fromLang": _resolve_lang(source_lang),
        "toLang": _resolve_lang(target_lang),
    }
    if glossary_name:
        data["glossary"] = glossary_name
    if description:
        data["fileDescription"] = description

    resp = requests.post(
        f"{BASE_URL}/translation/create",
        headers=_headers(),
        files={"file": (filename, file_bytes)},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    create_result = resp.json()
    task_id = create_result.get("taskId")

    if not task_id:
        raise Exception(f"O.Translator create failed: {create_result}")

    logger.info(f"O.Translator task created: {task_id}")

    # Step 2: Poll until completed
    elapsed = 0
    while elapsed < MAX_POLL_TIME:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        status = query_task(task_id)
        task_status = status.get("status", "")

        if task_status == "Completed":
            # Step 3: Download translated file
            download_url = status.get("translatedFileUrl")
            if not download_url:
                raise Exception("O.Translator: completed but no download URL")

            dl_resp = requests.get(download_url, timeout=120)
            dl_resp.raise_for_status()

            result_filename = status.get("translatedFileName", f"translated_{filename}")
            logger.info(f"O.Translator doc completed: {result_filename} "
                        f"({len(dl_resp.content)} bytes)")

            return {
                "translated_bytes": dl_resp.content,
                "filename": result_filename,
                "taskId": task_id,
            }

        if task_status in ("Terminated", "Cancelled", "Failed"):
            error_msg = status.get("errorMsg", status.get("message", "Unknown error"))
            raise Exception(f"O.Translator translation failed: {error_msg}")

        logger.debug(f"O.Translator polling {task_id}: {task_status} ({elapsed}s)")

    raise Exception(f"O.Translator timeout after {MAX_POLL_TIME}s for task {task_id}")


def query_task(task_id: str) -> dict:
    """Query translation task status."""
    resp = requests.post(
        f"{BASE_URL}/translation/query",
        headers=_headers(json_content=True),
        json={"taskId": task_id},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ─── Glossary Management ────────────────────────────────────────────

def create_glossary(
    name: str,
    source_lang: str,
    target_lang: str,
    entries: list,
) -> dict:
    """Create a glossary on o.translator.

    Args:
        name: Glossary name.
        source_lang: Source language code.
        target_lang: Target language code.
        entries: List of dicts with 'source' and 'target' keys.

    Returns:
        API response dict.
    """
    if not API_KEY:
        raise ValueError("OTRANSLATOR_API_KEY not configured")

    resp = requests.post(
        f"{BASE_URL}/glossary/create",
        headers=_headers(json_content=True),
        json={
            "name": name,
            "fromLang": _resolve_lang(source_lang),
            "toLang": _resolve_lang(target_lang),
            "entries": entries,
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


# ─── Account ────────────────────────────────────────────────────────

def get_balance() -> dict:
    """Get account credit balance."""
    if not API_KEY:
        raise ValueError("OTRANSLATOR_API_KEY not configured")

    resp = requests.post(
        f"{BASE_URL}/me",
        headers=_headers(json_content=True),
        json={},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def list_languages() -> dict:
    """List supported languages."""
    resp = requests.post(
        f"{BASE_URL}/languages",
        headers=_headers(json_content=True),
        json={},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()
