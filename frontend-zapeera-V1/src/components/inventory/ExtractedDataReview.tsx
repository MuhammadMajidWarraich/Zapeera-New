import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Check, X } from 'lucide-react';

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

interface ExtractedDataReviewProps {
  data: ExtractedData;
  onConfirm: (data: ExtractedData) => void;
  onCancel: () => void;
}

export function ExtractedDataReview({ data, onConfirm, onCancel }: ExtractedDataReviewProps) {
  const [editedData, setEditedData] = React.useState<ExtractedData>({ ...data });

  const handleChange = (field: keyof ExtractedData, value: any) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
  };

  const handleConfirm = () => {
    onConfirm(editedData);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Review Extracted Information</CardTitle>
        <CardDescription>
          Please verify and correct the extracted information before saving
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="productName">Product Name *</Label>
            <Input
              id="productName"
              value={editedData.productName || ''}
              onChange={(e) => handleChange('productName', e.target.value)}
              placeholder="Enter product name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={editedData.category || ''}
              onChange={(e) => handleChange('category', e.target.value)}
              placeholder="Enter category"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manufacturer">Manufacturer</Label>
            <Input
              id="manufacturer"
              value={editedData.manufacturer || ''}
              onChange={(e) => handleChange('manufacturer', e.target.value)}
              placeholder="Enter manufacturer"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="batchNo">Batch Number *</Label>
            <Input
              id="batchNo"
              value={editedData.batchNo || ''}
              onChange={(e) => handleChange('batchNo', e.target.value)}
              placeholder="Enter batch number"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                value={editedData.quantity || ''}
                onChange={(e) => handleChange('quantity', parseInt(e.target.value) || 0)}
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Price (PKR)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={editedData.price || ''}
                onChange={(e) => handleChange('price', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiryDate">Expiry Date</Label>
            <Input
              id="expiryDate"
              type="date"
              value={editedData.expiryDate || ''}
              onChange={(e) => handleChange('expiryDate', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shelf">Shelf Location</Label>
            <Input
              id="shelf"
              value={editedData.shelf || ''}
              onChange={(e) => handleChange('shelf', e.target.value)}
              placeholder="e.g., A-1, B-2"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Input
              id="supplier"
              value={editedData.supplier || ''}
              onChange={(e) => handleChange('supplier', e.target.value)}
              placeholder="Enter supplier name"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button onClick={handleConfirm} className="flex-1">
            <Check className="mr-2 h-4 w-4" />
            Save to System
          </Button>
          <Button variant="outline" onClick={onCancel} className="flex-1">
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
