"""OpenAI GPT-5.4-nano integration with prompt caching and batch support."""

import json
import os
import logging
import time

from openai import OpenAI

logger = logging.getLogger(__name__)

MODEL = "gpt-5.4-nano"

# System prompt ≥1024 tokens for automatic prompt caching (90% input cost reduction).
# Static prefix first → automatic cache hits. Dynamic content appended in user messages.
GLOSSARY_SYSTEM_PROMPT = """You are an expert translation glossary specialist working with the DeepL translation API. Your role is to extract precise, validated terminology pairs from source documents and reference translations.

## Core Rules

1. EXTRACT only domain-specific terminology — proper nouns, technical terms, branded phrases, recurring specialized vocabulary
2. NEVER extract common words, articles, prepositions, or generic phrases
3. Each term pair must be EXACTLY as it should appear in DeepL translations
4. Source terms must be in the source language, target terms in the target language
5. Terms must be ≤1024 characters each (DeepL API limit)
6. No duplicate source terms — if a term appears multiple times, keep the best translation
7. Output ONLY valid TSV format: one pair per line, tab-separated, no headers
8. Maintain consistent capitalization matching the source documents
9. For compound terms, include both the full compound and critical individual components if they have specialized translations
10. Consider morphological variations — include the base/dictionary form

## DeepL Glossary Compatibility Requirements

- Format: TSV (tab-separated values)
- One entry per line: SOURCE_TERM<TAB>TARGET_TERM
- No empty lines within the glossary
- No header row
- UTF-8 encoding
- Maximum 5000 entries per glossary
- Source terms are case-sensitive in matching
- Entries are applied during translation to force specific term translations

## Quality Standards

- VALIDATE that target terms are natural in the target language
- VERIFY terms are consistent with DeepL formality settings (formal/informal)
- CHECK that abbreviated forms are expanded or explained
- ENSURE industry-standard terminology is used (medical, legal, technical, etc.)
- PREFER terms that preserve meaning over literal translations
- For languages with grammatical gender, include the most common form
- For verbs, use infinitive form unless context demands otherwise

## Formality Awareness

When formality settings are provided:
- "more" / "prefer_more": Use formal register terms (Sie statt du, Ви замість ти)
- "less" / "prefer_less": Use informal register terms
- "default": Use context-appropriate register

## Domain Detection

Automatically detect the domain from document content:
- Legal: contracts, compliance, regulations → formal legal terminology
- Medical: clinical, pharmaceutical → standard medical nomenclature (INN names)
- Technical: engineering, IT, manufacturing → industry-standard terms
- Marketing: campaigns, branding → preserve brand voice and slogans
- Financial: banking, accounting → regulatory terminology
- Academic: research, publications → discipline-specific vocabulary

## Output Format

Return ONLY the TSV content. No explanations, no markdown, no headers.
Each line: source_term<TAB>target_term

Example:
Datenschutzgrundverordnung	Загальний регламент про захист даних
Geschäftsführer	Генеральний директор
Haftungsausschluss	Відмова від відповідальності"""


def get_client() -> OpenAI:
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    return OpenAI(api_key=key)


def extract_terms(
    source_text: str,
    reference_text: str,
    source_lang: str,
    target_lang: str,
    instructions: str = "",
    deepl_settings: dict = None,
) -> dict:
    """Extract glossary terms using GPT-5.4-nano with prompt caching.

    System prompt is static (≥1024 tokens) → automatic caching after first call.
    Dynamic content in user message → not cached, but cheap.
    """
    client = get_client()

    user_content = f"Source language: {source_lang}\nTarget language: {target_lang}\n\n"

    if deepl_settings:
        user_content += f"DeepL settings: formality={deepl_settings.get('formality', 'default')}\n\n"

    if instructions:
        user_content += f"Custom instructions:\n{instructions}\n\n"

    user_content += f"=== SOURCE TEXT ===\n{source_text}\n\n"

    if reference_text:
        user_content += f"=== REFERENCE TRANSLATION ===\n{reference_text}\n\n"

    user_content += "Extract all domain-specific terminology pairs in TSV format:"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": GLOSSARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.1,
        max_tokens=16000,
    )

    content = response.choices[0].message.content or ""
    terms = _parse_tsv_terms(content)

    usage = response.usage
    cached_tokens = getattr(usage, "prompt_tokens_details", None)
    cached_count = 0
    if cached_tokens and hasattr(cached_tokens, "cached_tokens"):
        cached_count = cached_tokens.cached_tokens

    return {
        "terms": terms,
        "tsv": content.strip(),
        "term_count": len(terms),
        "usage": {
            "prompt_tokens": usage.prompt_tokens,
            "completion_tokens": usage.completion_tokens,
            "cached_tokens": cached_count,
        },
    }


def extract_terms_batch(chunks: list[dict]) -> dict:
    """Submit batch extraction job. 50% cost savings, 24h completion.

    Each chunk: {id, source_text, reference_text, source_lang, target_lang, instructions}
    Returns batch_id for status polling.
    """
    client = get_client()

    # Build JSONL for batch API
    jsonl_lines = []
    for chunk in chunks:
        user_content = f"Source language: {chunk['source_lang']}\nTarget language: {chunk['target_lang']}\n\n"

        if chunk.get("instructions"):
            user_content += f"Custom instructions:\n{chunk['instructions']}\n\n"

        user_content += f"=== SOURCE TEXT ===\n{chunk['source_text']}\n\n"

        if chunk.get("reference_text"):
            user_content += f"=== REFERENCE TRANSLATION ===\n{chunk['reference_text']}\n\n"

        user_content += "Extract all domain-specific terminology pairs in TSV format:"

        request = {
            "custom_id": chunk["id"],
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": GLOSSARY_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                "temperature": 0.1,
                "max_tokens": 16000,
            },
        }
        jsonl_lines.append(json.dumps(request))

    jsonl_content = "\n".join(jsonl_lines)

    # Upload batch file
    batch_file = client.files.create(
        file=("batch_input.jsonl", jsonl_content.encode("utf-8")),
        purpose="batch",
    )

    # Create batch
    batch = client.batches.create(
        input_file_id=batch_file.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
    )

    return {
        "batch_id": batch.id,
        "status": batch.status,
        "input_file_id": batch_file.id,
        "request_count": len(chunks),
    }


def check_batch(batch_id: str) -> dict:
    """Check batch status and retrieve results when complete."""
    client = get_client()
    batch = client.batches.retrieve(batch_id)

    result = {
        "batch_id": batch.id,
        "status": batch.status,
        "request_counts": {
            "total": batch.request_counts.total if batch.request_counts else 0,
            "completed": batch.request_counts.completed if batch.request_counts else 0,
            "failed": batch.request_counts.failed if batch.request_counts else 0,
        },
    }

    if batch.status == "completed" and batch.output_file_id:
        content = client.files.content(batch.output_file_id)
        results = []
        for line in content.text.strip().split("\n"):
            if not line:
                continue
            obj = json.loads(line)
            custom_id = obj.get("custom_id", "")
            response_body = obj.get("response", {}).get("body", {})
            choices = response_body.get("choices", [])
            tsv = choices[0]["message"]["content"] if choices else ""
            terms = _parse_tsv_terms(tsv)
            results.append({
                "id": custom_id,
                "terms": terms,
                "tsv": tsv.strip(),
                "term_count": len(terms),
            })
        result["results"] = results

    return result


def generate_glossary_prompt(
    instructions: str,
    source_lang: str,
    target_lang: str,
    deepl_settings: dict = None,
) -> dict:
    """Generate an optimal glossary extraction prompt from user instructions."""
    client = get_client()

    system = """You are a prompt engineering specialist for translation glossary extraction.
Given user instructions about a translation project, generate an optimal prompt that will:
1. Maximize terminology extraction accuracy
2. Ensure DeepL glossary TSV format compliance
3. Incorporate domain-specific requirements
4. Account for formality and style preferences
5. Be concise but comprehensive

Output ONLY the prompt text, no explanations."""

    user_msg = f"Source: {source_lang}, Target: {target_lang}\n"
    if deepl_settings:
        user_msg += f"DeepL formality: {deepl_settings.get('formality', 'default')}\n"
    user_msg += f"\nInstructions:\n{instructions}"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=4000,
    )

    return {
        "prompt": response.choices[0].message.content or "",
        "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        },
    }


def estimate_voice(text: str, language: str) -> dict:
    """Estimate voice-over cost by text length and language."""
    chars = len(text)
    # Approx 150 words/min speech, ~5 chars/word, ~750 chars/min
    duration_seconds = max(30, int((chars / 750) * 60))
    # Base rate: €0.15/second for standard, €0.25/second for premium
    standard_cost = duration_seconds * 15  # cents
    premium_cost = duration_seconds * 25   # cents

    return {
        "chars": chars,
        "estimated_duration_seconds": duration_seconds,
        "estimated_duration_minutes": round(duration_seconds / 60, 1),
        "language": language,
        "options": [
            {"tier": "standard", "cost_cents": standard_cost, "description": "AI voice synthesis"},
            {"tier": "premium", "cost_cents": premium_cost, "description": "Professional voice actor"},
        ],
    }


def _parse_tsv_terms(content: str) -> list[dict]:
    """Parse TSV glossary content into term pairs."""
    terms = []
    for line in content.strip().split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            source = parts[0].strip()
            target = parts[1].strip()
            if source and target:
                terms.append({"source": source, "target": target})
    return terms
