import { useEffect, useRef } from 'react';
import { config } from '@/lib/config';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface NotificationData {
  type: 'connected' | 'ping' | 'account_deactivated' | 'account_reactivated' |
        'product_change' | 'sale_change' | 'refund_change' | 'customer_change' |
        'inventory_change' | 'payment_proof_status_change';
  message?: string;
  data?: any;
  timestamp?: string;
}

export const useRealtimeNotifications = () => {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const eventSourceRef = useRef<EventSource | null>(null);

  // Detect if running in Electron (offline mode)
  const isElectron = typeof window !== 'undefined' &&
    typeof window.electronAPI !== 'undefined';

  useEffect(() => {
    if (!user) {
      // Close connection if user is not logged in
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    // SENIOR ENGINEER FIX: Disable SSE in Electron mode (offline software)
    // SSE is only needed for website real-time updates, not for offline software
    if (isElectron) {
      console.log('[SSE] ⚠️ SSE disabled in Electron mode (offline software)');
      return;
    }

    // Listen for account deactivation events from API calls
    const handleAccountDeactivation = (event: CustomEvent) => {
      // Debug: Account deactivated via API call
      toast({
        title: "Account Deactivated",
        description: event.detail.message,
        variant: "destructive",
        duration: 5000,
      });

      // Logout user immediately
      logout();
    };

    window.addEventListener('accountDeactivated', handleAccountDeactivation as EventListener);

    // Create SSE connection (only for website, not Electron).
    // EventSource cannot set custom headers and the httpOnly cookie is scoped to the
    // frontend origin, so authenticate via query token and connect DIRECTLY to the
    // backend — the Vercel /api rewrite cannot stream SSE (returns 502).
    const sseBase = String(config.realtime.sseBaseUrl || config.api.baseUrl || '/api').replace(/\/+$/, '');
    const token = typeof window !== 'undefined'
      ? (localStorage.getItem('localAccessToken') || localStorage.getItem('token'))
      : null;
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const eventSource = new EventSource(`${sseBase}/sse/events${tokenQuery}`, { withCredentials: true });

    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      // Debug: Real-time connection established
    };

    eventSource.onmessage = (event) => {
      try {
        const data: NotificationData = JSON.parse(event.data);

        switch (data.type) {
          case 'connected':
            // Debug: Connected to real-time updates
            break;

          case 'ping':
            // Keep connection alive
            break;

          case 'account_deactivated':
            // Debug: Account deactivated notification received

            // Show immediate notification
            toast({
              title: "Account Deactivated",
              description: data.message,
              variant: "destructive",
              duration: 5000,
            });

            // Logout user immediately and redirect to login
            logout();

            // Show logout confirmation
            setTimeout(() => {
              toast({
                title: "Logged Out",
                description: "You have been logged out due to account deactivation",
                variant: "destructive",
              });
            }, 1000);
            break;

          case 'account_reactivated':
            // Debug: Account reactivated notification received
            toast({
              title: "Account Reactivated",
              description: data.message,
              variant: "default",
              duration: 5000,
            });
            break;

          case 'product_change':
            // Handle product changes (create, update, delete)
            const productAction = data.data?.action;
            const product = data.data?.product;
            if (productAction && product) {
              // Dispatch custom event for components to listen to
              window.dispatchEvent(new CustomEvent('productChanged', {
                detail: { action: productAction, product }
              }));

              // Show toast notification
              toast({
                title: `Product ${productAction.charAt(0).toUpperCase() + productAction.slice(1)}`,
                description: data.message || `Product ${product.name} was ${productAction}`,
                variant: "default",
                duration: 3000,
              });
            }
            break;

          case 'sale_change':
            // Handle sale changes
            const saleAction = data.data?.action;
            const sale = data.data?.sale;
            if (saleAction && sale) {
              window.dispatchEvent(new CustomEvent('saleChanged', {
                detail: { action: saleAction, sale }
              }));

              toast({
                title: `Sale ${saleAction.charAt(0).toUpperCase() + saleAction.slice(1)}`,
                description: data.message || `Sale ${sale.id} was ${saleAction}`,
                variant: "default",
                duration: 3000,
              });
            }
            break;

          case 'refund_change':
            // Handle refund changes
            const refundAction = data.data?.action;
            const refund = data.data?.refund;
            if (refundAction && refund) {
              window.dispatchEvent(new CustomEvent('refundChanged', {
                detail: { action: refundAction, refund }
              }));

              toast({
                title: `Refund ${refundAction.charAt(0).toUpperCase() + refundAction.slice(1)}`,
                description: data.message || `Refund ${refund.id} was ${refundAction}`,
                variant: "default",
                duration: 3000,
              });
            }
            break;

          case 'customer_change':
            // Handle customer changes
            const customerAction = data.data?.action;
            const customer = data.data?.customer;
            if (customerAction && customer) {
              window.dispatchEvent(new CustomEvent('customerChanged', {
                detail: { action: customerAction, customer }
              }));

              toast({
                title: `Customer ${customerAction.charAt(0).toUpperCase() + customerAction.slice(1)}`,
                description: data.message || `Customer ${customer.name} was ${customerAction}`,
                variant: "default",
                duration: 3000,
              });
            }
            break;

          case 'inventory_change':
            // Handle inventory changes (stock updates, product add/remove)
            const inventoryAction = data.data?.action;
            const inventoryData = data.data?.data;
            if (inventoryAction && inventoryData) {
              window.dispatchEvent(new CustomEvent('inventoryChanged', {
                detail: { action: inventoryAction, data: inventoryData }
              }));

              toast({
                title: `Inventory ${inventoryAction.charAt(0).toUpperCase() + inventoryAction.slice(1)}`,
                description: data.message || `Inventory was updated`,
                variant: "default",
                duration: 3000,
              });
            }
            break;

          case 'payment_proof_status_change':
            // Handle payment proof status changes (approved/rejected)
            const proofStatus = data.data?.status;
            const proofData = data.data;
            if (proofStatus && proofData) {
              window.dispatchEvent(new CustomEvent('paymentProofStatusChanged', {
                detail: { status: proofStatus, proofData }
              }));

              const isApproved = proofStatus === 'APPROVED';
              toast({
                title: isApproved ? 'Payment Proof Approved' : 'Payment Proof Rejected',
                description: data.message || `Your payment proof has been ${proofStatus.toLowerCase()}`,
                variant: isApproved ? "default" : "destructive",
                duration: 5000,
              });
            }
            break;

          default:
            // Debug: Unknown notification type
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);

      // Try to reconnect after 5 seconds
      setTimeout(() => {
        if (user && !eventSourceRef.current) {
          // Debug: Attempting to reconnect
          // The useEffect will run again and create a new connection
        }
      }, 5000);
    };

    // Cleanup on unmount
    return () => {
      window.removeEventListener('accountDeactivated', handleAccountDeactivation as EventListener);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [user, logout, toast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);
};
