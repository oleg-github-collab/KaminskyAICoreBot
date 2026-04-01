FROM python:3.12-slim
# REBUILD: 2026-04-01-paddleocr-calamine

# System deps: PDF tools (poppler), file detection, PaddleOCR runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    libgomp1 \
    libglib2.0-0 \
    poppler-utils \
    unzip \
    libreoffice-writer-nogui \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download PaddleOCR models (cyrillic for ukr/rus, latin for deu/pol)
# Models cached in ~/.paddleocr/ — avoids first-request delay
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='cyrillic', use_gpu=False, show_log=False); PaddleOCR(lang='latin', use_gpu=False, show_log=False)"

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
