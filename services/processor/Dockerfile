FROM python:3.12-slim
# REBUILD: 2026-04-01-pdf-text-cleanup

# System deps: OCR (tesseract), PDF tools (poppler), file detection
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    tesseract-ocr \
    tesseract-ocr-ukr \
    tesseract-ocr-deu \
    tesseract-ocr-rus \
    tesseract-ocr-pol \
    poppler-utils \
    unzip \
    libreoffice-writer-nogui \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "2"]
