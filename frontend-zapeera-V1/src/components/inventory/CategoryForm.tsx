import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiService } from '@/services/api';

interface CategoryFormData {
  name: string;
  description: string;
  type: 'medical' | 'non-medical' | 'general';
  color: string;
}

interface CategoryFormProps {
  initialData?: Partial<CategoryFormData>;
  onSubmit: (data: CategoryFormData) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitButtonText?: string;
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  initialData = {},
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitButtonText = 'Add Category'
}) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<CategoryFormData>({
    name: initialData.name || '',
    description: initialData.description || '',
    type: initialData.type || 'general',
    color: initialData.color || '#3B82F6'
  });

  // Update form data when initialData changes (for editing)
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setFormData({
        name: initialData.name || '',
        description: initialData.description || '',
        type: initialData.type || 'general',
        color: initialData.color || '#3B82F6'
      });
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Category name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      // Convert type to uppercase for backend compatibility
      // Replace hyphen with underscore for NON-MEDICAL -> NON_MEDICAL
      const typeForBackend = formData.type.toUpperCase().replace('-', '_') as 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
      const formDataForBackend = {
        ...formData,
        type: typeForBackend
      };
      console.log('🔍 CategoryForm - Sending data to backend:', formDataForBackend);
      await onSubmit(formDataForBackend);
    } catch (error) {
      console.error('Error submitting category form:', error);
      toast({
        title: "Error",
        description: "Failed to save category. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="categoryName">Category Name *</Label>
        <Input
          id="categoryName"
          placeholder="e.g., Pain Relief"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="categoryDescription">Description</Label>
        <Textarea
          id="categoryDescription"
          placeholder="Brief description of the category..."
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="categoryType">Type</Label>
        <Select
          value={formData.type}
          onValueChange={(value: 'medical' | 'non-medical' | 'general') =>
            setFormData({ ...formData, type: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value="general"
              className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
            >
              General
            </SelectItem>
            <SelectItem
              value="medical"
              className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
            >
              Medical
            </SelectItem>
            <SelectItem
              value="non-medical"
              className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
            >
              Non-Medical
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="categoryColor">Color</Label>
        <div className="flex items-center space-x-2">
          <Input
            id="categoryColor"
            type="color"
            value={formData.color}
            onChange={(e) => setFormData({ ...formData, color: e.target.value })}
            className="w-16 h-10 p-1"
          />
          <Input
            value={formData.color}
            onChange={(e) => setFormData({ ...formData, color: e.target.value })}
            placeholder="#3B82F6"
            className="flex-1"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isSubmitting ? 'Saving...' : submitButtonText}
        </Button>
      </div>
    </form>
  );
};

export default CategoryForm;
