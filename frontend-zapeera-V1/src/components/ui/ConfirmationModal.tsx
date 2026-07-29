import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './dialog';
import { Button } from './button';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
  loadingText?: string;
  itemName?: string;
  itemDetails?: string;
  icon?: React.ReactNode;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
  loadingText = 'Processing...',
  itemName,
  itemDetails,
  icon,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          borderColor: 'border-red-200',
          bgColor: 'bg-red-50',
          textColor: 'text-red-800',
          detailColor: 'text-red-700',
          buttonClass: 'bg-red-600 hover:bg-red-700',
          defaultIcon: <Trash2 className="w-4 h-4" />,
        };
      case 'warning':
        return {
          iconBg: 'bg-yellow-100',
          iconColor: 'text-yellow-600',
          borderColor: 'border-yellow-200',
          bgColor: 'bg-yellow-50',
          textColor: 'text-yellow-800',
          detailColor: 'text-yellow-700',
          buttonClass: 'bg-yellow-600 hover:bg-yellow-700',
          defaultIcon: <AlertTriangle className="w-4 h-4" />,
        };
      case 'info':
        return {
          iconBg: 'bg-blue-100',
          iconColor: 'text-blue-600',
          borderColor: 'border-blue-200',
          bgColor: 'bg-blue-50',
          textColor: 'text-blue-800',
          detailColor: 'text-blue-700',
          buttonClass: 'bg-blue-600 hover:bg-blue-700',
          defaultIcon: <X className="w-4 h-4" />,
        };
      default:
        return {
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          borderColor: 'border-red-200',
          bgColor: 'bg-red-50',
          textColor: 'text-red-800',
          detailColor: 'text-red-700',
          buttonClass: 'bg-red-600 hover:bg-red-700',
          defaultIcon: <Trash2 className="w-4 h-4" />,
        };
    }
  };

  const styles = getVariantStyles();
  const displayIcon = icon || styles.defaultIcon;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="flex items-center gap-2">
            <div className={`w-5 h-5 ${styles.iconColor}`}>
              {displayIcon}
            </div>
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        {(itemName || itemDetails) && (
          <div className="py-4">
            <div className={`${styles.bgColor} border ${styles.borderColor} rounded-lg p-4`}>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <div className={`w-8 h-8 ${styles.iconBg} rounded-full flex items-center justify-center`}>
                    <div className={styles.iconColor}>
                      {displayIcon}
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  {itemName && (
                    <h4 className={`text-sm font-medium ${styles.textColor} mb-1`}>
                      {itemName}
                    </h4>
                  )}
                  {itemDetails && (
                    <p className={`text-sm ${styles.detailColor}`}>
                      {itemDetails}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isLoading}
            className={variant !== 'danger' ? styles.buttonClass : ''}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                {loadingText}
              </>
            ) : (
              <>
                <div className="w-4 h-4 mr-2">
                  {displayIcon}
                </div>
                {confirmText}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmationModal;
