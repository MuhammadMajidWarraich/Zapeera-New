/**
 * UpgradeModal Component
 * Displays when user tries to access a module that's not in their subscription
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { withBusinessSlug } from '@/utils/business-routes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Lock, ArrowRight, Sparkles } from 'lucide-react';

interface UpgradeModalProps {
  module: string;
  moduleName: string;
  isOpen: boolean;
  onClose: () => void;
}

const MODULE_DESCRIPTIONS: Record<string, string> = {
  inventory: 'Track and manage your products, stock levels, and inventory movements.',
  sales: 'Process sales, manage orders, and track revenue.',
  pos: 'Point of Sale system for in-person transactions.',
  customers: 'Manage customer relationships and purchase history.',
  purchases: 'Track purchases, manage suppliers, and procurement.',
  staff: 'Manage employees, attendance, shifts, and payroll.',
  branches: 'Manage multiple store locations and branch operations.',
  reports: 'Access detailed analytics, sales reports, and business insights.',
  dashboard: 'View business overview and key metrics.',
  business_management: 'Configure business settings and manage your account.',
  subscription: 'Manage your subscription and billing.',
  expenses: 'Track business expenses and cost management.',
  analytics: 'Advanced analytics and business intelligence.',
};

export function UpgradeModal({ module, moduleName, isOpen, onClose }: UpgradeModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const subscriptionPath = withBusinessSlug(
    location.pathname.match(/\/business\/([^\/]+)/)?.[1] || null,
    '/subscription'
  );

  const handleUpgrade = () => {
    onClose();
    navigate(subscriptionPath);
  };

  const handleContactSales = () => {
    onClose();
    navigate('/contact-sales');
  };

  const description = MODULE_DESCRIPTIONS[module] || 'This feature is available in higher-tier plans.';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <Lock className="w-6 h-6 text-amber-600" />
          </div>
          <DialogTitle className="text-xl">{moduleName} is Locked</DialogTitle>
          <DialogDescription className="text-gray-500 mt-2">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-gray-50 rounded-lg p-4 mt-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-purple-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">Upgrade to unlock</p>
              <p className="text-sm text-gray-500 mt-1">
                This feature is included in our Growth and Scale plans.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-3 mt-6">
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            Maybe Later
          </Button>
          <Button
            onClick={handleUpgrade}
            className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            Upgrade Now
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </DialogFooter>

        <p className="text-xs text-center text-gray-400 mt-4">
          Need a custom plan?{' '}
          <button
            onClick={handleContactSales}
            className="text-blue-600 hover:underline"
          >
            Contact sales
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default UpgradeModal;
