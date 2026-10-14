from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
import base64
from typing import Dict, List, Optional
import re
from pydantic import BaseModel

app = FastAPI(title="Zapeera OCR Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# OCR engine (single-host migration, 2026-10-15)
#
# The original engine was PaddleOCR (paddlepaddle), which publishes NO Linux
# aarch64 wheels, so the service cannot run on the ARM64 single-host VM
# (Oracle Ampere A1). The engine is now RapidOCR (rapidocr-onnxruntime): the
# same PaddleOCR model family (PP-OCR det/rec/cls) converted to ONNX, running
# on ONNX Runtime, which ships aarch64 wheels. RAM use also drops
# (~1.5-2.5 GB -> ~0.4-0.8 GB). The HTTP API contract — endpoints and the
# ExtractedData response schema — is UNCHANGED.
#
# The engine loads lazily on first use so the health endpoint stays fast.
# Fallback: if RapidOCR fails to initialise, pytesseract is used when the
# `tesseract` binary is present (the Docker image installs it). If no engine
# is available the scan endpoints return HTTP 500 and the rest of the
# platform is unaffected (the backend already degrades gracefully).
# ---------------------------------------------------------------------------
_ocr_engine = None
_ocr_engine_kind = None


def _get_ocr_engine():
    global _ocr_engine, _ocr_engine_kind
    if _ocr_engine is not None or _ocr_engine_kind == "unavailable":
        return _ocr_engine
    try:
        from rapidocr_onnxruntime import RapidOCR

        _ocr_engine = RapidOCR()
        _ocr_engine_kind = "rapidocr"
    except Exception as exc:  # depends on host binaries/wheels
        print(f"[OCR] RapidOCR init failed ({exc}); trying Tesseract fallback")
        try:
            import shutil

            import pytesseract  # noqa: F401

            if shutil.which("tesseract"):
                _ocr_engine = "tesseract"
                _ocr_engine_kind = "tesseract"
                return _ocr_engine
        except Exception:
            pass
        _ocr_engine_kind = "unavailable"
    return _ocr_engine


def run_ocr(image_array) -> str:
    """Run the configured OCR engine on a numpy image; return text lines joined by newlines."""
    engine = _get_ocr_engine()
    if engine is None:
        raise RuntimeError(
            "No OCR engine available (RapidOCR failed to initialise and Tesseract is not installed)"
        )
    if engine == "tesseract":
        import pytesseract

        return pytesseract.image_to_string(Image.fromarray(image_array))
    # RapidOCR returns (result, elapse); each result item is [box, text, score]
    result, _elapse = engine(image_array)
    text_lines = []
    if result:
        for item in result:
            if len(item) >= 2 and item[1]:
                text_lines.append(str(item[1]))
    return "\n".join(text_lines)

class ExtractedData(BaseModel):
    productName: Optional[str] = None
    category: Optional[str] = None
    manufacturer: Optional[str] = None
    batchNo: Optional[str] = None
    quantity: Optional[int] = None
    expiryDate: Optional[str] = None
    price: Optional[float] = None
    shelf: Optional[str] = None
    supplier: Optional[str] = None
    rawText: Optional[str] = None
    confidence: Dict[str, float] = {}

def extract_entities(text: str) -> Dict:
    """
    Extract pharmacy-related entities from OCR text using pattern matching
    """
    result = {
        'productName': None,
        'category': None,
        'manufacturer': None,
        'batchNo': None,
        'quantity': None,
        'expiryDate': None,
        'price': None,
        'shelf': None,
        'supplier': None,
        'confidence': {}
    }
    
    lines = text.split('\n')
    
    # Patterns for extraction
    patterns = {
        'batch': r'[Bb][Aa][Tt][Cc][Hh]\s*[:#]?\s*([A-Z0-9-]+)',
        'batch_alt': r'([A-Z]{2,4}-?\d{4}-?\d{3})',
        'expiry': r'[Ee][Xx][Pp]?(?:[Ii][Rr][Yy])?\s*[:#]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{2,4}[-/]\d{1,2}[-/]\d{1,2})',
        'quantity': r'[Qq][Tt][Yy]?\s*[:#]?\s*(\d+)',
        'price': r'[Pp][Rr][Ii][Cc][Ee]?\s*[:#]?\s*(\d+\.?\d*)',
        'shelf': r'[Ss][Hh][Ee][Ll][Ff]?\s*[:#]?\s*([A-Z]\d{1,2})',
        'shelf_alt': r'([A-Z]-\d{1,2})',
    }
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Extract batch number
        if not result['batchNo']:
            batch_match = re.search(patterns['batch'], line, re.IGNORECASE)
            if not batch_match:
                batch_match = re.search(patterns['batch_alt'], line)
            if batch_match:
                result['batchNo'] = batch_match.group(1)
                result['confidence']['batchNo'] = 0.8
        
        # Extract expiry date
        if not result['expiryDate']:
            expiry_match = re.search(patterns['expiry'], line)
            if expiry_match:
                result['expiryDate'] = expiry_match.group(1)
                result['confidence']['expiryDate'] = 0.7
        
        # Extract quantity
        if not result['quantity']:
            qty_match = re.search(patterns['quantity'], line, re.IGNORECASE)
            if qty_match:
                result['quantity'] = int(qty_match.group(1))
                result['confidence']['quantity'] = 0.8
        
        # Extract price
        if not result['price']:
            price_match = re.search(patterns['price'], line, re.IGNORECASE)
            if price_match:
                result['price'] = float(price_match.group(1))
                result['confidence']['price'] = 0.7
        
        # Extract shelf
        if not result['shelf']:
            shelf_match = re.search(patterns['shelf'], line, re.IGNORECASE)
            if not shelf_match:
                shelf_match = re.search(patterns['shelf_alt'], line)
            if shelf_match:
                result['shelf'] = shelf_match.group(1)
                result['confidence']['shelf'] = 0.7
    
    # Try to identify product name (usually first meaningful line)
    meaningful_lines = [l for l in lines if len(l) > 5 and not any(k in l.lower() for k in ['batch', 'expiry', 'qty', 'price', 'shelf', 'mfg', 'exp'])]
    if meaningful_lines and not result['productName']:
        result['productName'] = meaningful_lines[0].strip()
        result['confidence']['productName'] = 0.6
    
    # Try to identify manufacturer (common pharmaceutical companies)
    pharma_companies = ['gsk', 'pfizer', 'novartis', 'sanofi', 'abbott', 'bayer', 'johnson', 'merck', 'roche', 'astrazeneca']
    for line in lines:
        line_lower = line.lower()
        for company in pharma_companies:
            if company in line_lower and not result['manufacturer']:
                result['manufacturer'] = line.strip()
                result['confidence']['manufacturer'] = 0.7
                break
    
    # Try to identify category from product name
    if result['productName']:
        category_keywords = {
            'pain relief': ['pain', 'headache', 'fever', 'paracetamol', 'ibuprofen'],
            'antibiotic': ['antibiotic', 'cillin', 'mycin'],
            'vitamin': ['vitamin', 'supplement'],
            'cardio': ['heart', 'blood pressure', 'cardio'],
            'diabetes': ['diabetes', 'insulin', 'glucose'],
        }
        for category, keywords in category_keywords.items():
            if any(kw in result['productName'].lower() for kw in keywords):
                result['category'] = category.title()
                result['confidence']['category'] = 0.5
                break
    
    result['rawText'] = text
    return result

@app.get("/")
async def root():
    return {"message": "Zapeera OCR Service is running", "status": "healthy", "engine": _ocr_engine_kind or "not-initialized"}

@app.post("/scan-document", response_model=ExtractedData)
async def scan_document(file: UploadFile = File(...)):
    """
    Scan a medical rep document and extract product information
    """
    try:
        # Read image file
        contents = await file.read()
        
        # Convert to PIL Image
        image = Image.open(io.BytesIO(contents))
        
        # Convert to numpy array
        image_array = np.array(image)
        
        # Perform OCR (RapidOCR, with Tesseract fallback — see engine notes above)
        extracted_text = run_ocr(image_array)
        
        # Extract entities
        entities = extract_entities(extracted_text)
        
        return ExtractedData(**entities)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/scan-document-base64")
async def scan_document_base64(data: dict):
    """
    Scan a document from base64 encoded image
    """
    try:
        # Decode base64
        image_data = base64.b64decode(data['image'])
        
        # Convert to PIL Image
        image = Image.open(io.BytesIO(image_data))
        
        # Convert to numpy array
        image_array = np.array(image)
        
        # Perform OCR (RapidOCR, with Tesseract fallback — see engine notes above)
        extracted_text = run_ocr(image_array)
        
        # Extract entities
        entities = extract_entities(extracted_text)
        
        return ExtractedData(**entities)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
