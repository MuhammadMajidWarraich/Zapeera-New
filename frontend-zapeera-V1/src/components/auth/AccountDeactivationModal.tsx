import { useState } from "react";
import { config } from "@/lib/config";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Phone, Mail, MessageCircle } from 'lucide-react';

interface AccountDeactivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userInfo?: {
    username?: string;
    email?: string;
    name?: string;
  };
}

const AccountDeactivationModal: React.FC<AccountDeactivationModalProps> = ({
  isOpen,
  onClose,
  userInfo
}) => {
  const handleWhatsAppContact = () => {
    const message = `Hello,

My account is currently disabled and I need it to be activated.

Account Details:
- Username: ${userInfo?.username || 'N/A'}
- Email: ${userInfo?.email || 'N/A'}
- Name: ${userInfo?.name || 'N/A'}

Please help me activate my account so I can access the system.

Best regards,
${userInfo?.name || 'User'}`;

    const whatsappUrl = `https://wa.me/${config.support.phoneNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const handleCallSupport = () => {
    window.open(`tel:${config.support.phoneNumber}`, '_self');
  };

  const handleEmailContact = () => {
    const subject = "Account Activation Request - Zapeera";
    const body = `Hello,

My account is currently disabled and I need it to be activated.

Account Details:
- Username: ${userInfo?.username || 'N/A'}
- Email: ${userInfo?.email || 'N/A'}
- Name: ${userInfo?.name || 'N/A'}

Please help me activate my account so I can access the system.

Best regards,
${userInfo?.name || 'User'}`;

    const emailUrl = `mailto:${config.support.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(emailUrl, '_blank');
  };

  const handlePhoneContact = () => {
    window.open(`tel:${config.support.phoneNumber}`, '_self');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Account Deactivated
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Account Access Restricted
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Your account has been deactivated and you cannot access the system at this time.
            </p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-medium text-yellow-800 mb-2">What does this mean?</h4>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li>• Your account is temporarily disabled</li>
              <li>• You cannot log in or access any features</li>
              <li>• Your data is safe and preserved</li>
              <li>• Contact support to reactivate your account</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium text-gray-900">Contact Support</h4>
            <p className="text-sm text-gray-600">
              Reach out to our support Staff to reactivate your account:
            </p>

            <div className="grid grid-cols-1 gap-2">
              <Button
                onClick={handleWhatsAppContact}
                variant="outline"
                className="w-full justify-start gap-2 text-green-600 border-green-200 hover:bg-green-50"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp Support
              </Button>

              <Button
                onClick={handlePhoneContact}
                variant="outline"
                className="w-full justify-start gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
              >
                <Phone className="h-4 w-4" />
                Call +92 310 7100663
              </Button>

              <Button
                onClick={handleEmailContact}
                variant="outline"
                className="w-full justify-start gap-2 text-purple-600 border-purple-200 hover:bg-purple-50"
              >
                <Mail className="h-4 w-4" />
                Email Support
              </Button>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              onClick={onClose}
              variant="outline"
              className="px-6"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AccountDeactivationModal;
