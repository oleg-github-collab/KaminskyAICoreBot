"""Accurate document page/character counting for all supported formats.

Uses pdfplumber for PDF (better accuracy than PyPDF2),
python-docx for DOCX, openpyxl for XLSX, python-pptx for PPTX,
and document_engine for everything else.
"""

import io
import math
import os
import chardet
import logging

logger = logging.getLogger(__name__)

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
        elif ext == ".doc":
            return _count_doc(file_bytes, filename)
        elif ext == ".xlsx":
            return _count_xlsx(file_bytes, filename)
        elif ext == ".xls":
            return _count_xls(file_bytes, filename)
        elif ext == ".pptx":
            return _count_pptx(file_bytes, filename)
        elif ext == ".rtf":
            return _count_rtf(file_bytes, filename)
        elif ext in (".odt", ".ods", ".odp"):
            return _count_odf(file_bytes, filename, ext)
        elif ext in (".html", ".htm"):
            return _count_html(file_bytes, filename)
        elif ext == ".epub":
            return _count_epub(file_bytes, filename)
        elif ext in (".txt", ".csv", ".tsv", ".md", ".xml", ".json", ".srt", ".sub", ".ass"):
            return _count_text(file_bytes, filename)
        else:
            return _count_text(file_bytes, filename)
    except Exception as e:
        logger.error(f"count_file failed for {filename}: {e}", exc_info=True)
        return {
            "pages": max(1, len(file_bytes) // 3000),
            "chars": 0,
            "file_type": ext.lstrip(".") or "unknown",
            "pricing_cents": max(1, len(file_bytes) // 3000) * PRICE_PER_PAGE_DOC,
            "method": "fallback",
            "error": str(e),
        }


def _count_pdf(file_bytes: bytes, filename: str) -> dict:
    """PDF: pdfplumber (primary) → PyPDF2 (fallback)."""
    total_chars = 0
    physical_pages = 0
    method = "pdf_exact"

    # Method 1: pdfplumber (best quality)
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            physical_pages = len(pdf.pages)
            for page in pdf.pages:
                text = page.extract_text() or ""
                total_chars += len(text.strip())
            method = "pdfplumber"
    except Exception as e:
        logger.warning(f"pdfplumber count failed: {e}")

        # Method 2: PyPDF2 fallback
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            physical_pages = len(reader.pages)
            total_chars = 0
            for page in reader.pages:
                text = page.extract_text() or ""
                total_chars += len(text.strip())
            method = "pypdf2"
        except Exception as e2:
            logger.warning(f"PyPDF2 count also failed: {e2}")
            # Last resort: physical pages only
            physical_pages = max(1, physical_pages)
            method = "pdf_page_count"

    # If text extraction yielded very little, it's likely a scanned PDF
    if total_chars < physical_pages * 100:
        return {
            "pages": max(1, physical_pages),
            "chars": total_chars,
            "file_type": "pdf",
            "pricing_cents": max(1, physical_pages) * PRICE_PER_PAGE_DOC,
            "method": method,
            "note": "scanned_or_image_pdf",
        }

    char_pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
    return {
        "pages": char_pages,
        "chars": total_chars,
        "file_type": "pdf",
        "pricing_cents": char_pages * PRICE_PER_PAGE_DOC,
        "method": method,
    }


def _count_docx(file_bytes: bytes, filename: str) -> dict:
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))

    total_chars = 0
    for para in doc.paragraphs:
        total_chars += len(para.text)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                total_chars += len(cell.text)

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
        "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
        "method": "docx_exact",
    }


def _count_doc(file_bytes: bytes, filename: str) -> dict:
    """Legacy .doc: try document_engine extraction, fallback to estimate."""
    try:
        import document_engine
        result = document_engine.extract_text(file_bytes, filename)
        text = result.get("text", "")
        if text.strip():
            total_chars = len(text.strip())
            pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
            return {
                "pages": pages,
                "chars": total_chars,
                "file_type": "doc",
                "pricing_cents": pages * PRICE_PER_PAGE_DOC,
                "method": "doc_extracted",
            }
    except Exception as e:
        logger.warning(f"doc extraction for counting failed: {e}")

    estimated_chars = len(file_bytes) // 3
    pages = max(1, math.ceil(estimated_chars / CHARS_PER_PAGE))
    return {
        "pages": pages,
        "chars": estimated_chars,
        "file_type": "doc",
        "pricing_cents": pages * PRICE_PER_PAGE_DOC,
        "method": "doc_estimate",
        "note": "legacy_format_estimated",
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
        "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
        "method": "xlsx_exact",
    }


def _count_xls(file_bytes: bytes, filename: str) -> dict:
    """Legacy .xls: try LibreOffice conversion → count as xlsx."""
    try:
        import document_engine
        result = document_engine.extract_text(file_bytes, filename)
        text = result.get("text", "")
        if text.strip():
            total_chars = len(text.strip())
            pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
            return {
                "pages": pages,
                "chars": total_chars,
                "file_type": "xls",
                "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
                "method": "xls_extracted",
            }
    except Exception:
        pass

    estimated_chars = len(file_bytes) // 4
    pages = max(1, math.ceil(estimated_chars / CHARS_PER_PAGE))
    return {
        "pages": pages,
        "chars": estimated_chars,
        "file_type": "xls",
        "pricing_cents": pages * PRICE_PER_PAGE_DOC,
        "method": "xls_estimate",
    }


def _count_pptx(file_bytes: bytes, filename: str) -> dict:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(file_bytes))
    slide_count = len(prs.slides)

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
        # Speaker notes
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            total_chars += len(slide.notes_slide.notes_text_frame.text)

    char_pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
    return {
        "pages": char_pages,
        "chars": total_chars,
        "slides": slide_count,
        "file_type": "pptx",
        "pricing_cents": char_pages * PRICE_PER_PAGE_DOC,
        "method": "pptx_exact",
    }


def _count_rtf(file_bytes: bytes, filename: str) -> dict:
    """RTF: striprtf for text extraction."""
    try:
        from striprtf.striprtf import rtf_to_text
        text = rtf_to_text(file_bytes.decode("utf-8", errors="replace"))
        total_chars = len(text.strip())
        pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
        return {
            "pages": pages,
            "chars": total_chars,
            "file_type": "rtf",
            "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
            "method": "rtf_exact",
        }
    except Exception as e:
        logger.warning(f"RTF count failed: {e}")
        estimated = len(file_bytes) // 3
        pages = max(1, math.ceil(estimated / CHARS_PER_PAGE))
        return {
            "pages": pages,
            "chars": estimated,
            "file_type": "rtf",
            "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
            "method": "rtf_estimate",
        }


def _count_odf(file_bytes: bytes, filename: str, ext: str) -> dict:
    """ODF formats: use document_engine extraction."""
    try:
        import document_engine
        result = document_engine.extract_text(file_bytes, filename)
        text = result.get("text", "")
        if text.strip():
            total_chars = len(text.strip())
            pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
            price = PRICE_PER_PAGE_TEXT if ext == ".odt" else PRICE_PER_PAGE_DOC
            return {
                "pages": pages,
                "chars": total_chars,
                "file_type": ext.lstrip("."),
                "pricing_cents": pages * price,
                "method": f"{ext.lstrip('.')}_extracted",
            }
    except Exception:
        pass

    estimated = len(file_bytes) // 3
    pages = max(1, math.ceil(estimated / CHARS_PER_PAGE))
    return {
        "pages": pages,
        "chars": estimated,
        "file_type": ext.lstrip("."),
        "pricing_cents": pages * PRICE_PER_PAGE_DOC,
        "method": f"{ext.lstrip('.')}_estimate",
    }


def _count_html(file_bytes: bytes, filename: str) -> dict:
    """HTML: BeautifulSoup text extraction for accurate counting."""
    try:
        from bs4 import BeautifulSoup
        detected = chardet.detect(file_bytes)
        encoding = detected.get("encoding") or "utf-8"
        try:
            html = file_bytes.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            html = file_bytes.decode("utf-8", errors="replace")

        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        total_chars = len(text)
        pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
        return {
            "pages": pages,
            "chars": total_chars,
            "file_type": "html",
            "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
            "method": "html_exact",
        }
    except Exception:
        return _count_text(file_bytes, filename)


def _count_epub(file_bytes: bytes, filename: str) -> dict:
    """EPUB: ebooklib extraction for counting."""
    try:
        import document_engine
        result = document_engine.extract_text(file_bytes, filename)
        text = result.get("text", "")
        if text.strip():
            total_chars = len(text.strip())
            pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))
            return {
                "pages": pages,
                "chars": total_chars,
                "file_type": "epub",
                "pricing_cents": pages * PRICE_PER_PAGE_DOC,
                "method": "epub_exact",
            }
    except Exception:
        pass

    estimated = len(file_bytes) // 4
    pages = max(1, math.ceil(estimated / CHARS_PER_PAGE))
    return {
        "pages": pages,
        "chars": estimated,
        "file_type": "epub",
        "pricing_cents": pages * PRICE_PER_PAGE_DOC,
        "method": "epub_estimate",
    }


def _count_text(file_bytes: bytes, filename: str) -> dict:
    ext = os.path.splitext(filename.lower())[1].lstrip(".")

    detected = chardet.detect(file_bytes)
    encoding = detected.get("encoding") or "utf-8"

    try:
        text = file_bytes.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        text = file_bytes.decode("utf-8", errors="replace")

    if text.startswith("\ufeff"):
        text = text[1:]

    total_chars = len(text.strip())
    pages = max(1, math.ceil(total_chars / CHARS_PER_PAGE))

    return {
        "pages": pages,
        "chars": total_chars,
        "file_type": ext or "txt",
        "pricing_cents": pages * PRICE_PER_PAGE_TEXT,
        "method": "text_exact",
    }
