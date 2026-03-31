"""Accurate document page/character counting for all supported formats."""

import io
import math
import os
import chardet

CHARS_PER_PAGE = 1800
PRICE_PER_PAGE_TEXT = 58  # cents (€0.58 per 1800 chars — text files)
PRICE_PER_PAGE_DOC = 89   # cents (€0.89 per 1800 chars — PDF/binary docs)


def count_file(file_bytes: bytes, filename: str) -> dict:
    """Count pages and characters for a file. Returns pricing info."""
    ext = os.path.splitext(filename.lower())[1]

    try:
        if ext == ".pdf":
            return _count_pdf(file_bytes, filename)
        elif ext == ".docx":
            return _count_docx(file_bytes, filename)
        elif ext == ".xlsx":
            return _count_xlsx(file_bytes, filename)
        elif ext == ".pptx":
            return _count_pptx(file_bytes, filename)
        elif ext == ".doc":
            return _count_doc_legacy(file_bytes, filename)
        elif ext in (".txt", ".csv", ".tsv", ".md", ".html", ".htm", ".xml", ".json"):
            return _count_text(file_bytes, filename)
        else:
            return _count_text(file_bytes, filename)
    except Exception as e:
        return {
            "pages": max(1, len(file_bytes) // 3000),
            "chars": 0,
            "file_type": ext.lstrip(".") or "unknown",
            "pricing_cents": max(1, len(file_bytes) // 3000) * PRICE_PER_PAGE_DOC,
            "method": "fallback",
            "error": str(e),
        }


def _count_pdf(file_bytes: bytes, filename: str) -> dict:
    from PyPDF2 import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    physical_pages = len(reader.pages)

    total_chars = 0
    for page in reader.pages:
        text = page.extract_text() or ""
        total_chars += len(text.strip())

    # If text extraction yielded very little, it's likely a scanned PDF
    # Fall back to physical page count for pricing
    if total_chars < physical_pages * 100:
        return {
            "pages": physical_pages,
            "chars": total_chars,
            "file_type": "pdf",
            "pricing_cents": physical_pages * PRICE_PER_PAGE_DOC,
            "method": "pdf_page_count",
            "note": "scanned_or_image_pdf",
        }

    # Price by characters: €0.89 per 1800 chars
    char_pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
    return {
        "pages": char_pages,
        "chars": total_chars,
        "file_type": "pdf",
        "pricing_cents": char_pages * PRICE_PER_PAGE_DOC,
        "method": "pdf_exact",
    }


def _count_docx(file_bytes: bytes, filename: str) -> dict:
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))

    total_chars = 0
    for para in doc.paragraphs:
        total_chars += len(para.text)

    # Also count text in tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                total_chars += len(cell.text)

    # Also count text in headers/footers
    for section in doc.sections:
        for header_footer in [section.header, section.footer]:
            if header_footer is not None:
                for para in header_footer.paragraphs:
                    total_chars += len(para.text)

    pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))

    return {
        "pages": pages,
        "chars": total_chars,
        "file_type": "docx",
        "pricing_cents": math.ceil(total_chars / CHARS_PER_PAGE) * PRICE_PER_PAGE_TEXT,
        "method": "docx_exact",
    }


def _count_xlsx(file_bytes: bytes, filename: str) -> dict:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)

    total_chars = 0
    sheet_count = len(wb.sheetnames)

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is not None:
                    total_chars += len(str(cell.value))

    wb.close()

    pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))

    return {
        "pages": pages,
        "chars": total_chars,
        "file_type": "xlsx",
        "sheets": sheet_count,
        "pricing_cents": math.ceil(total_chars / CHARS_PER_PAGE) * PRICE_PER_PAGE_TEXT,
        "method": "xlsx_exact",
    }


def _count_pptx(file_bytes: bytes, filename: str) -> dict:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(file_bytes))
    pages = len(prs.slides)

    total_chars = 0
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    total_chars += len(para.text)
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        total_chars += len(cell.text)

    # Price by characters: €0.89 per 1800 chars
    char_pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
    return {
        "pages": char_pages,
        "chars": total_chars,
        "file_type": "pptx",
        "pricing_cents": char_pages * PRICE_PER_PAGE_DOC,
        "method": "pptx_exact",
    }


def _count_doc_legacy(file_bytes: bytes, filename: str) -> dict:
    """Legacy .doc files — no good Python parser, use size heuristic."""
    estimated_chars = len(file_bytes) // 3
    pages = max(1, math.ceil(estimated_chars / CHARS_PER_PAGE))

    return {
        "pages": pages,
        "chars": estimated_chars,
        "file_type": "doc",
        "pricing_cents": pages * PRICE_PER_PAGE_DOC,
        "method": "doc_estimate",
        "note": "legacy_format_estimated_by_chars",
    }


def _count_text(file_bytes: bytes, filename: str) -> dict:
    ext = os.path.splitext(filename.lower())[1].lstrip(".")

    # Detect encoding
    detected = chardet.detect(file_bytes)
    encoding = detected.get("encoding") or "utf-8"

    try:
        text = file_bytes.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        text = file_bytes.decode("utf-8", errors="replace")

    # Strip BOM
    if text.startswith("\ufeff"):
        text = text[1:]

    total_chars = len(text.strip())
    pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))

    return {
        "pages": pages,
        "chars": total_chars,
        "file_type": ext or "txt",
        "pricing_cents": math.ceil(total_chars / CHARS_PER_PAGE) * PRICE_PER_PAGE_TEXT,
        "method": "text_exact",
    }
