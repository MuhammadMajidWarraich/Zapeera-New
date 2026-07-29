# Zapeera OCR Service

Python microservice for OCR processing using PaddleOCR. Handles handwritten and printed medical rep documents.

## Setup

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Run Service
```bash
python main.py
```

Service will run on http://localhost:8000

## API Endpoints

### POST /scan-document
Upload image file for OCR processing

**Request**: multipart/form-data with file
**Response**: JSON with extracted product information

### POST /scan-document-base64
Process base64 encoded image

**Request**: JSON with base64 image data
**Response**: JSON with extracted product information

## Extracted Fields

- productName: Product name
- category: Product category
- manufacturer: Manufacturer name
- batchNo: Batch number
- quantity: Quantity
- expiryDate: Expiry date
- price: Price
- shelf: Shelf location
- supplier: Supplier name
- rawText: Full OCR text
- confidence: Confidence scores for each field

## Notes

- Supports handwritten text recognition
- Uses pattern matching for entity extraction
- Can be enhanced with ML-based entity extraction for better accuracy
