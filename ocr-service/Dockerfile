# Zapeera OCR service — RapidOCR (ONNX) on ARM64 + x86_64
# Python 3.11 is deliberate: onnxruntime 1.20.x / opencv 4.10.x resolve
# against the numpy 1.26.4 pin on 3.11 (on >=3.12 they demand numpy>=2,
# which conflicts with rapidocr-onnxruntime 1.4.4's tested range here).
FROM python:3.11-slim

# tesseract-ocr = fallback OCR engine binary; libgl1/libglib2.0-0 are
# required by the (full) opencv-python build that rapidocr depends on;
# curl is used by the container healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/ || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
