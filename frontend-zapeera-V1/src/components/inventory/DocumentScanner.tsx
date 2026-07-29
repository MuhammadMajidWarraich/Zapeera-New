import React, { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

interface ExtractedData {
  productName?: string;
  category?: string;
  manufacturer?: string;
  batchNo?: string;
  quantity?: number;
  expiryDate?: string;
  price?: number;
  shelf?: string;
  supplier?: string;
  rawText?: string;
  confidence?: Record<string, number>;
}

interface DocumentScannerProps {
  onExtractedData: (data: ExtractedData) => void;
  onClose: () => void;
}

export function DocumentScanner({ onExtractedData, onClose }: DocumentScannerProps) {
  const [image, setImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      setError('Failed to access camera. Please use file upload instead.');
      console.error('Camera error:', err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  const captureImage = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg');
        setImage(imageData);
        stopCamera();
      }
    }
  }, [stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async () => {
    if (!image) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Convert base64 to blob
      const response = await fetch(image);
      const blob = await response.blob();
      
      // Create FormData
      const formData = new FormData();
      formData.append('file', blob, 'document.jpg');

      // Send to backend
      const apiUrl = import.meta.env.VITE_API_URL || '/api';
      const ocrResponse = await fetch(`${apiUrl}/ocr/scan`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!ocrResponse.ok) {
        throw new Error('Failed to process image');
      }

      const result = await ocrResponse.json();
      
      if (result.success) {
        setExtractedData(result.data);
      } else {
        throw new Error(result.message || 'OCR processing failed');
      }
    } catch (err) {
      console.error('OCR error:', err);
      console.error('OCR error details:', {
        message: err?.message,
        stack: err?.stack,
        name: err?.name,
        response: err?.response,
        status: err?.response?.status,
        data: err?.response?.data
      });
      setError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = () => {
    if (extractedData) {
      onExtractedData(extractedData);
      onClose();
    }
  };

  const handleRetake = () => {
    setImage(null);
    setExtractedData(null);
    setError(null);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div>
          <CardTitle>Scan Document</CardTitle>
          <CardDescription>
            Scan medical rep document to extract product information
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!image ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <Button
                onClick={() => startCamera()}
                className="flex-1"
                disabled={isCameraActive}
              >
                <Camera className="mr-2 h-4 w-4" />
                Use Camera
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload File
              </Button>
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            {isCameraActive && (
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg border"
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
                  <Button onClick={captureImage} size="lg">
                    <Camera className="mr-2 h-4 w-4" />
                    Capture
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-4 right-4"
                  onClick={stopCamera}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <img
                src={image}
                alt="Scanned document"
                className="w-full rounded-lg border"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 bg-white/90"
                onClick={handleRetake}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {!extractedData && !error && (
              <Button
                onClick={processImage}
                disabled={isProcessing}
                className="w-full"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Extract Information
                  </>
                )}
              </Button>
            )}

            {error && (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
                <AlertCircle className="h-5 w-5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {extractedData && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-semibold text-green-800 mb-2">Extracted Information</h4>
                  <div className="space-y-2 text-sm">
                    {extractedData.productName && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Product:</span>
                        <span className="font-medium">{extractedData.productName}</span>
                      </div>
                    )}
                    {extractedData.category && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Category:</span>
                        <span className="font-medium">{extractedData.category}</span>
                      </div>
                    )}
                    {extractedData.manufacturer && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Manufacturer:</span>
                        <span className="font-medium">{extractedData.manufacturer}</span>
                      </div>
                    )}
                    {extractedData.batchNo && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Batch No:</span>
                        <span className="font-medium">{extractedData.batchNo}</span>
                      </div>
                    )}
                    {extractedData.quantity && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Quantity:</span>
                        <span className="font-medium">{extractedData.quantity}</span>
                      </div>
                    )}
                    {extractedData.expiryDate && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Expiry Date:</span>
                        <span className="font-medium">{extractedData.expiryDate}</span>
                      </div>
                    )}
                    {extractedData.price && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Price:</span>
                        <span className="font-medium">PKR {extractedData.price.toFixed(2)}</span>
                      </div>
                    )}
                    {extractedData.shelf && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Shelf:</span>
                        <span className="font-medium">{extractedData.shelf}</span>
                      </div>
                    )}
                    {extractedData.supplier && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Supplier:</span>
                        <span className="font-medium">{extractedData.supplier}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleConfirm} className="flex-1">
                    <Check className="mr-2 h-4 w-4" />
                    Confirm & Continue
                  </Button>
                  <Button variant="outline" onClick={handleRetake} className="flex-1">
                    <Camera className="mr-2 h-4 w-4" />
                    Retake
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
