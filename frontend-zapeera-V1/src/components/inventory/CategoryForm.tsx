import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiService } from '@/services/api';
import { useAdmin } from '@/contexts/useAdmin';
import {
  getCategoryTypeOptions,
  categoryTypeLabel,
  type CategoryTypeValue,
} from '@/utils/category-types';

interface CategoryFormData {
  name: string;
  description: string;
  // Backend value (e.g. 'MEDICAL', 'FOOD', 'GENERAL') — the per-industry
  // sets live in '@/utils/category-types' (mirror of the backend's
  // category-types.util.ts, which enforces them on the API).
  type: string;
  color: string;
}

interface CategoryFormProps {
  initialData?: Partial<CategoryFormData>;
  onSubmit: (data: CategoryFormData) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitButtonText?: string;
  /** Override the business type used for the type options (defaults to
   *  the currently selected business from the admin context). */
  businessType?: string;
}

// Parents used to pass legacy lowercase slugs ('medical', 'non-medical');
// stored values are the uppercase backend values. Accept both.
const normalizeInitialType = (raw: unknown): string => {
  const key = String(raw || 'GENERAL').trim().toUpperCase().replace(/-/g, '_');
  return key || 'GENERAL';
};

const CategoryForm: React.FC<CategoryFormProps> = ({
  initialData = {},
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitButtonText = 'Add Category',
  businessType: businessTypeProp
}) => {
  const { toast } = useToast();
  const { selectedCompany } = useAdmin();
  const businessType = businessTypeProp ?? (selectedCompany as any)?.businessType;

  const typeOptions = useMemo(() => getCategoryTypeOptions(businessType), [businessType]);
  const showTypeSelector = typeOptions.length > 1;

  const [formData, setFormData] = useState<CategoryFormData>({
    name: initialData.name || '',
    description: initialData.description || '',
    type: normalizeInitialType(initialData.type),
    color: initialData.color || '#3B82F6'
  });

  // Update form data when initialData changes (for editing)
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setFormData({
        name: initialData.name || '',
        description: initialData.description || '',
        type: normalizeInitialType(initialData.type),
        color: initialData.color || '#3B82F6'
      });
    }
  }, [initialData]);

  // Keep the selected type inside the industry's set (e.g. after the
  // business context resolves late). A stored legacy value on the row
  // being edited is grandfathered below instead of being silently
  // rewritten.
  const isEditing = Boolean((initialData as any)?.name);
  useEffect(() => {
    if (!showTypeSelector) {
      setFormData((prev) => (prev.type === 'GENERAL' ? prev : { ...prev, type: 'GENERAL' }));
      return;
    }
    setFormData((prev) => {
      if (typeOptions.some((o) => o.value === prev.type)) return prev;
      if (isEditing) return prev; // grandfathered legacy value, rendered as an extra option
      return { ...prev, type: 'GENERAL' };
    });
  }, [typeOptions, showTypeSelector, isEditing]);

  const selectOptions = useMemo(() => {
    const opts = [...typeOptions];
    if (showTypeSelector && formData.type && !opts.some((o) => o.value === formData.type)) {
      opts.push({
        value: formData.type as CategoryTypeValue,
        label: `${categoryTypeLabel(formData.type)} (legacy)`,
      });
    }
    return opts;
  }, [typeOptions, formData.type, showTypeSelector]);

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
      // Type is already the backend value for this business's industry.
      console.log('🔍 CategoryForm - Sending data to backend:', formData);
      await onSubmit(formData);
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
          placeholder="e.g., Beverages"
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

      {showTypeSelector && (
        <div className="space-y-2">
          <Label htmlFor="categoryType">Type</Label>
          <Select
            value={formData.type}
            onValueChange={(value: string) =>
              setFormData({ ...formData, type: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
