import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  MapPin,
  Phone,
  Mail,
  Users,
  Store,
  ArrowRight,
  AlertTriangle,
  Briefcase,
  Home,
  X,
} from 'lucide-react';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAdmin } from '@/contexts/useAdmin';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Business {
  id: string;
  name: string;
  businessType?: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  createdBy: string | null;
  createdByUser?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  branches: Array<{
    id: string;
    name: string;
    address: string;
    phone: string;
    email: string;
  }>;
  _count: {
    memberships: number;
    employees: number;
    products: number;
  };
  accessType?: 'owned' | 'shared';
  memberRole?: 'MANAGER' | 'CASHIER';
  memberBranchId?: string;
  slug?: string | null;
}

const BusinessManagement = () => {
  const { user } = useAuth();
  const { setSelectedBusinessId, refreshBusinesses: refreshGlobalBusinesses, refreshBranches: refreshGlobalBranches, getMembershipRole } = useAdmin();
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [businessToDelete, setBusinessToDelete] = useState<Business | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [userBusinessId, setUserBusinessId] = useState<string | null>(null);
  const [businessSubscriptions, setBusinessSubscriptions] = useState<Record<string, { planName: string; status: string; isSubscribed: boolean; subscriptionStatus: string | null }>>({});
  const [isSubscriptionRequiredDialogOpen, setIsSubscriptionRequiredDialogOpen] = useState(false);
  const [isSharedBusinessLocked, setIsSharedBusinessLocked] = useState(false);
  const [lockedBusinessName, setLockedBusinessName] = useState('');
  const [lockedBusinessId, setLockedBusinessId] = useState<string | null>(null);
  const lockedBusinessSlug = useMemo(() => {
    if (!lockedBusinessId) return null;
    return businesses.find((business) => business.id === lockedBusinessId)?.slug?.trim() || null;
  }, [businesses, lockedBusinessId]);
  const [refreshSubscriptionTrigger, setRefreshSubscriptionTrigger] = useState(0);
  const [branchStaffCount, setBranchStaffCount] = useState<number>(0);
  const location = useLocation();
  const [businessTypes, setBusinessTypes] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    businessType: 'PHARMACY',
    description: '',
    address: '',
    phone: '',
    email: ''
  });
  const [formErrors, setFormErrors] = useState({
    name: '',
    businessType: '',
    description: '',
    address: '',
    phone: '',
    email: ''
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [businessListTab, setBusinessListTab] = useState<'owned' | 'shared'>('owned');
  
  // Get the role in the context of the current selected business
  const membershipRole = getMembershipRole();
  const effectiveRole = membershipRole || String(user?.role || '').toUpperCase();
  const role = String(effectiveRole || '').toUpperCase();
  const isStaffUser = role === 'MANAGER' || role === 'CASHIER';
  const hasBusinessAccess = user?.businessAccessGranted !== false;
  /** Everyone sees My businesses / Shared with me — same layout for owners, Super Admin, and staff. */
  const showOwnershipTabs = true;

  const ownedBusinesses = useMemo(
    () =>
      businesses.filter((c) => {
        if (c.accessType === 'shared') return false;
        if (c.accessType === 'owned') return true;
        // Legacy rows without accessType: businesses you created
        return c.createdBy === user?.id;
      }),
    [businesses, user?.id]
  );

  const sharedBusinesses = useMemo(
    () =>
      businesses.filter((c) => {
        // Explicit membership / invited rows
        if (c.accessType === 'shared') return true;
        // Never classify owned rows as shared
        if (c.accessType === 'owned') return false;
        // Legacy owned row without accessType
        if (c.createdBy === user?.id) return false;
        // Everyone else can treat remaining non-owned rows as shared
        if (isStaffUser) return true;
        // OWNER/USER fallback: if not owned and not explicitly shared, still show in shared tab
        return true;
      }),
    [businesses, user?.id, user?.role, isStaffUser]
  );

  const listSourceBusinesses = useMemo(() => {
    if (!showOwnershipTabs) return businesses;
    return businessListTab === 'owned' ? ownedBusinesses : sharedBusinesses;
  }, [showOwnershipTabs, businesses, businessListTab, ownedBusinesses, sharedBusinesses]);

  const filteredBusinesses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return listSourceBusinesses;
    return listSourceBusinesses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
    );
  }, [listSourceBusinesses, searchQuery]);

  useEffect(() => {
    // For MANAGER/CASHIER, fetch branch details first to get businessId
    if ((role === 'MANAGER' || role === 'CASHIER') && user?.branchId) {
      fetchBranchDetails().then(() => {
        loadBusinesses();
      }).catch((error) => {
        console.error('Error in fetchBranchDetails:', error);
        setLoading(false);
      });
    } else {
      loadBusinesses().catch((error) => {
        console.error('Error in loadBusinesses:', error);
        setLoading(false);
      });
    }
    fetchBusinessTypes().catch((error) => {
      console.error('Error in fetchBusinessTypes:', error);
    });
  }, []);

  // Fetch subscription information for all businesses
  useEffect(() => {
    const fetchSubscriptionInfo = async () => {
      if (!businesses || businesses.length === 0) return;

      const subscriptions: Record<string, { planName: string; status: string; isSubscribed: boolean; subscriptionStatus: string | null }> = {};
      const promises = businesses.map(async (business: Business) => {
        try {
          const entitlement = await apiService.getBusinessEntitlements(business.id);
          if (entitlement.success && entitlement.data) {
            const isSubscribed = entitlement.data.isSubscribed || false;
            const subscriptionStatus = entitlement.data.subscriptionStatus;
            subscriptions[business.id] = {
              planName: isSubscribed ? (entitlement.data.plan?.name || 'No Plan') : 'No Plan',
              status: subscriptionStatus || (isSubscribed ? 'Active' : 'Inactive'),
              isSubscribed,
              subscriptionStatus
            };
          } else {
            subscriptions[business.id] = {
              planName: 'No Plan',
              status: 'Inactive',
              isSubscribed: false,
              subscriptionStatus: null
            };
          }
        } catch (error) {
          console.error(`Failed to fetch subscription for ${business.name}:`, error);
          subscriptions[business.id] = {
            planName: 'No Plan',
            status: 'Inactive',
            isSubscribed: false,
            subscriptionStatus: null
          };
        }
      });

      await Promise.all(promises);
      setBusinessSubscriptions(subscriptions);
    };

    fetchSubscriptionInfo();
  }, [businesses, refreshSubscriptionTrigger]);

  // Refresh subscription data when returning from subscription page
  useEffect(() => {
    if (location.pathname === '/zapeera/businesses' && businesses.length > 0) {
      setRefreshSubscriptionTrigger(prev => prev + 1);
    }
  }, [location.pathname, businesses.length]);

  // Also refresh when component mounts (in case user just upgraded subscription)
  useEffect(() => {
    setRefreshSubscriptionTrigger(prev => prev + 1);
  }, []);

  const fetchBusinessTypes = async () => {
    try {
      const res = await apiService.getBusinessTypes();
      if (res.success && res.data) {
        setBusinessTypes(res.data);
      }
    } catch (error) {
      console.error("Failed to fetch business types:", error);
    }
  };

  // Reload businesses when userBusinessId changes (for MANAGER/CASHIER)
  useEffect(() => {
    if (userBusinessId && (role === 'MANAGER' || role === 'CASHIER')) {
      loadBusinesses();
    }
  }, [userBusinessId]);

  const validateForm = () => {
    const errors = {
      name: '',
      businessType: '',
      description: '',
      address: '',
      phone: '',
      email: ''
    };

    // Business Name - Required
    if (!formData.name.trim()) {
      errors.name = 'Business name is required';
    } else if (formData.name.trim().length < 2) {
      errors.name = 'Business name must be at least 2 characters';
    }

    // Email - Required and valid format
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        errors.email = 'Please enter a valid email address';
      }
    }

    // Phone - Required and valid format
    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    } else {
      // Remove spaces, dashes, and parentheses for validation
      const cleanPhone = formData.phone.replace(/[\s\-\(\)]/g, '');
      // Check if it's a valid phone number (at least 10 digits, can have + at start)
      const phoneRegex = /^(\+?[0-9]{10,15})$/;
      if (!phoneRegex.test(cleanPhone)) {
        errors.phone = 'Please enter a valid phone number (10-15 digits)';
      }
    }

    setFormErrors(errors);
    
    // Check if there are any errors
    const hasErrors = Object.values(errors).some(error => error !== '');
    
    if (hasErrors) {
      toast({
        title: "Validation Error",
        description: "Please fill all required fields correctly (Name, Email, Phone are required)",
        variant: "destructive",
      });
    }
    
    return !hasErrors; // Return true if no errors
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (formErrors[field as keyof typeof formErrors]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const openCreateDialog = () => {
    setFormData({
      name: '',
      businessType: 'PHARMACY',
      description: '',
      address: '',
      phone: '',
      email: ''
    });
    setFormErrors({
      name: '',
      businessType: '',
      description: '',
      address: '',
      phone: '',
      email: ''
    });
    setIsCreateDialogOpen(true);
  };

  const fetchBranchDetails = async () => {
    try {
      if (!user?.branchId) return;
      
      const response = await apiService.getBranches();
      if (response.success && response.data.branches) {
        const userBranch = response.data.branches.find((b: any) => b.id === user.branchId);
        const branchBusinessId = (userBranch as any)?.businessId || userBranch?.companyId;
        if (branchBusinessId) {
          setUserBusinessId(branchBusinessId);
          
          // For manager, get staff count from their branch
          if (role === 'MANAGER' && (userBranch as any)._count?.membershipBranches !== undefined) {
            setBranchStaffCount((userBranch as any)._count.membershipBranches || 0);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching branch details:', error);
    }
  };

  const loadBusinesses = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await apiService.getBusinesses();
      if (response.success) {
        let nextList = response.data;

        if (role === 'OWNER') {
          // API returns owned + shared (accessType); do not strip shared rows
          nextList = response.data;
        } else if (role === 'MANAGER' || role === 'CASHIER') {
          // Staff may have access to multiple businesses; rely on backend visibility, not single-business clamp.
          nextList = hasBusinessAccess ? response.data : [];
        }

        setBusinesses(nextList as any);

        console.log('🏢 businesses loaded:', nextList.length, 'for', user?.name, `(${user?.role})`);
      }
    } catch (error) {
      console.error('Error loading businesses:', error);
      if (showLoading) {
        toast({
          title: "Error",
          description: "Failed to load businesses",
          variant: "destructive",
        });
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const handleCreateBusiness = async () => {
    // Validate form first
    if (!validateForm()) {
      return;
    }

    // Check if business name already exists (client-side check)
    const existingBusiness = businesses.find(business =>
      business.name.toLowerCase() === formData.name.toLowerCase()
    );

    if (existingBusiness) {
      setFormErrors(prev => ({ ...prev, name: 'A business with this name already exists' }));
      toast({
        title: "Error",
        description: "A business with this name already exists. Please choose a different name.",
        variant: "destructive",
      });
      return;
    }

    // Business creation limits removed: each subscription now supports unlimited businesses.
    // Limits only apply to resources within each business (branches, counters, etc).

    // Store form data for optimistic update
    const formDataCopy = { ...formData };

    // OPTIMISTIC UPDATE: Create temporary business object and add to list IMMEDIATELY
    const tempId = `temp-${Date.now()}`;
    const optimisticBusiness: Business = {
      id: tempId,
      name: formDataCopy.name,
      businessType: formDataCopy.businessType || 'PHARMACY',
      description: formDataCopy.description || null,
      address: formDataCopy.address || null,
      phone: formDataCopy.phone || null,
      email: formDataCopy.email || null,
      createdBy: user?.id || null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      branches: [],
      _count: {
        memberships: 0,
        employees: 0,
        products: 0
      }
    };

    // Add to list IMMEDIATELY
    setBusinesses(prev => [optimisticBusiness, ...prev]);
    
    // Close dialog IMMEDIATELY
    setIsCreateDialogOpen(false);
    
    // Reset form IMMEDIATELY
    setFormData({
      name: '',
      businessType: 'PHARMACY',
      description: '',
      address: '',
      phone: '',
      email: ''
    });
    setFormErrors({
      name: '',
      businessType: '',
      description: '',
      address: '',
      phone: '',
      email: ''
    });

    // Show success toast IMMEDIATELY
    toast({
      title: "Business created",
      description: "Your 15-day Trial plan has been activated. You can upgrade at any time from the Subscription & Billing page.",
    });

    // Call API in background (non-blocking)
    apiService.createBusiness(formDataCopy as any)
      .then((response) => {
        if (response.success && response.data) {
          // Replace temporary business with real one
          setBusinesses(prev => prev.map(c => 
            c.id === tempId ? response.data as any : c
          ));
          
          // Reload in background to ensure consistency (silent - no loading state)
          loadBusinesses(false).catch(err => console.error('Background reload error:', err));
          refreshGlobalBusinesses().catch(err => console.error('Background refresh error:', err));
        } else {
          // If API call failed, remove the optimistic business
          setBusinesses(prev => prev.filter(c => c.id !== tempId));
          
          const errorMessage = response?.message || "Failed to create business";
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      })
      .catch((error: any) => {
        // If API call failed, remove the optimistic business
        setBusinesses(prev => prev.filter(c => c.id !== tempId));
        
        console.error('❌ Error creating business:', error);
        const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || "Failed to create business";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      });
  };

  const handleEditBusiness = async () => {
    if (!selectedBusiness) return;

    // Validate form first
    if (!validateForm()) {
      return;
    }

    // Check if business name already exists (excluding current business)
    const existingBusiness = businesses.find(business =>
      business.id !== selectedBusiness.id &&
      business.name.toLowerCase() === formData.name.toLowerCase()
    );

    if (existingBusiness) {
      setFormErrors(prev => ({ ...prev, name: 'A business with this name already exists' }));
      toast({
        title: "Error",
        description: "A business with this name already exists. Please choose a different name.",
        variant: "destructive",
      });
      return;
    }

    // Store business data for optimistic update
    const businessId = selectedBusiness.id;
    const originalBusiness = { ...selectedBusiness };

    const payload = {
      name: formData.name?.trim() || undefined,
      businessType: formData.businessType?.trim() || undefined,
      description: formData.description?.trim() ? formData.description.trim() : undefined,
      address: formData.address?.trim() ? formData.address.trim() : undefined,
      phone: formData.phone?.trim() ? formData.phone.trim() : undefined,
      email: formData.email?.trim() ? formData.email.trim() : undefined,
    };

    // OPTIMISTIC UPDATE: Update business in list IMMEDIATELY (before API call)
    const updatedBusiness: Business = {
      ...selectedBusiness,
      name: payload.name || selectedBusiness.name,
      businessType: payload.businessType || selectedBusiness.businessType,
      description: payload.description ?? null,
      address: payload.address ?? null,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
      updatedAt: new Date().toISOString()
    };

    setBusinesses(prev => prev.map(c => c.id === businessId ? updatedBusiness : c));
    
    // Close dialog IMMEDIATELY
    setIsEditDialogOpen(false);
    setSelectedBusiness(null);
    
    // Reset form IMMEDIATELY
    setFormData({
      name: '',
      businessType: 'PHARMACY',
      description: '',
      address: '',
      phone: '',
      email: ''
    });

    // Call API in background (non-blocking)
    apiService.updateBusiness(businessId, payload as any)
      .then((response) => {
        if (response.success && response.data) {
          toast({
            title: "Success",
            description: "Business updated successfully",
          });
          // Replace optimistic business with real one
          setBusinesses(prev => prev.map(c => 
            c.id === businessId ? response.data as any : c
          ));
          
          // Reload in background to ensure consistency
          loadBusinesses(false).catch(err => console.error('Background reload error:', err));
          refreshGlobalBusinesses().catch(err => console.error('Background refresh error:', err));
        } else {
          // If API call failed, revert the optimistic update
          setBusinesses(prev => prev.map(c => 
            c.id === businessId ? originalBusiness : c
          ));
          
          const errorMessage = response?.message || "Failed to update business";
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      })
      .catch((error: any) => {
        // If API call failed, revert the optimistic update
        setBusinesses(prev => prev.map(c => 
          c.id === businessId ? originalBusiness : c
        ));
        
        console.error('Error updating business:', error);
        
        // Handle specific server validation errors
        if (error.message && error.message.includes('already exists')) {
          setFormErrors(prev => ({ ...prev, name: 'A business with this name already exists' }));
          toast({
            title: "Error",
            description: "A business with this name already exists. Please choose a different name.",
            variant: "destructive",
          });
        } else {
          const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || "Failed to update business";
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      });
  };

  const openDeleteDialog = (business: Business) => {
    setBusinessToDelete(business);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteBusiness = async () => {
    if (!businessToDelete) {
      toast({
        title: "Error",
        description: "No business selected for deletion",
        variant: "destructive",
      });
      return;
    }

    // Store business data before deletion (for revert if needed)
    const businessToDeleteId = businessToDelete.id;
    const businessToDeleteCopy = { ...businessToDelete };

    // OPTIMISTIC UPDATE: Remove business from list IMMEDIATELY (before API call)
    setBusinesses(prev => prev.filter(c => c.id !== businessToDeleteId));
    
    // Close dialog IMMEDIATELY
    setIsDeleteDialogOpen(false);
    setBusinessToDelete(null);

    // Show success toast IMMEDIATELY
    toast({
      title: "Success",
      description: "Business deleted successfully",
    });

    // Call API in background (non-blocking)
    apiService.deleteBusiness(businessToDeleteId)
      .then((response) => {
        if (!response || !response.success) {
          // If API call failed, revert the optimistic update
          setBusinesses(prev => {
            // Re-add the business if it doesn't exist
            const exists = prev.find(c => c.id === businessToDeleteId);
            if (!exists) {
              return [...prev, businessToDeleteCopy];
            }
            return prev;
          });
          
          const errorMessage = response?.message || "Failed to delete business";
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        } else {
          // Success - reload in background to ensure consistency (silent - no loading state)
          loadBusinesses(false).catch(err => console.error('Background reload error:', err));
          refreshGlobalBusinesses().catch(err => console.error('Background refresh error:', err));
          refreshGlobalBranches().catch(err => console.error('Background refresh error:', err));
        }
      })
      .catch((error: any) => {
        // If API call failed, revert the optimistic update
        setBusinesses(prev => {
          const exists = prev.find(c => c.id === businessToDeleteId);
          if (!exists) {
            return [...prev, businessToDeleteCopy];
          }
          return prev;
        });
        
        console.error('Error deleting business:', error);
        const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || "Failed to delete business";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      });
  };

  const handleClickToGo = async (businessId: string) => {
    try {
      console.log('🔍 handleClickToGo: Starting navigation for business:', businessId);

      // Find the selected business details
      const business = businesses.find(c => c.id === businessId);
      console.log('🔍 handleClickToGo: Found business:', business?.name);

      if (!business) {
        toast({
          title: "Error",
          description: "Business not found. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const isBusinessCreator = business.createdBy === user?.id;

      if (isStaffUser) {
        if (!hasBusinessAccess) {
          toast({
            title: "Access Restricted",
            description: "Your business access is currently disabled.",
            variant: "destructive",
          });
          return;
        }

        // Business creator always has full control of businesses they created,
        // even when they are staff in other businesses.
        // Staff can also access shared businesses they have a membership for.
        const hasMembershipForBusiness = Array.isArray(user?.memberships)
          ? user.memberships.some((m) => String(m.businessId) === String(business.id) && m.status === 'ACTIVE')
          : false;
        if (!isBusinessCreator && !hasMembershipForBusiness && (!userBusinessId || business.id !== userBusinessId)) {
          toast({
            title: "Access Denied",
            description: "You can only manage your assigned business.",
            variant: "destructive",
          });
          return;
        }
      }

      // Set the selected business in AdminContext FIRST
      console.log('🔍 handleClickToGo: Setting selected business ID:', businessId);
      setSelectedBusinessId(businessId);

      // Wait for context to update
      await new Promise(resolve => setTimeout(resolve, 200));

      // AdminContext persists selected business automatically.

      // Show success message
      toast({
        title: "Business Selected",
        description: `You are now viewing ${business.name}'s dashboard.`,
        duration: 3000,
      });

      // Wait longer for context to fully update
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('🔍 handleClickToGo: Waited for context update, now navigating...');

      const target = getBusinessNavigationTarget(business);
      navigate(target);
      console.log('🔍 handleClickToGo: Navigation initiated via navigate(', target, ')');
    } catch (error) {
      console.error('❌ Error navigating to dashboard:', error);
      toast({
        title: "Error",
        description: "Failed to navigate to dashboard. Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (business: Business) => {
    setSelectedBusiness(business);
    setFormData({
      name: business.name,
      businessType: business.businessType || 'PHARMACY',
      description: business.description || '',
      address: business.address || '',
      phone: business.phone || '',
      email: business.email || ''
    });
    setIsEditDialogOpen(true);
  };

  const normalizeBusinessTypeKey = (input?: string | null) => {
    const raw = String(input || '').trim();
    return raw
      ? raw
          .toUpperCase()
          .replace(/[\s-]+/g, '_')
          .replace(/_+/g, '_')
      : '';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getBusinessTypeLabel = (businessType?: string | null) => {
    let key = normalizeBusinessTypeKey(businessType);

    // Legacy normalization: platform no longer uses STORE.
    // Old data may still contain STORE / DEPARTMENT_STORE.
    if (key === 'STORE' || key === 'DEPARTMENT_STORE' || key === 'DEPARTMENTALSTORE') {
      key = 'DEPARTMENTAL_STORE';
    }

    // Ensure pharmacy businesses always show a type even if legacy data missed the column.
    if (!key) {
      key = 'PHARMACY';
    }

    // Prefer backend-managed list (platform admin controlled)
    const match = Array.isArray(businessTypes)
      ? businessTypes.find((t: any) => normalizeBusinessTypeKey(t?.name) === key)
      : undefined;
    const rawName = String(match?.name || key || '').trim();

    if (!rawName) return '';
    return rawName
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase());
  };

  const branchCount = (business: Business) => business.branches?.length ?? 0;

  const showBranchesCol = role !== 'MANAGER' && role !== 'CASHIER';
  const showStaffCol = role !== 'CASHIER';
  const canMutateBusinesses = true; // Show Create Business button for all user roles
  const canManageBusiness = (business: Business) => {
    // For shared businesses, check if user has a valid member role
    if (business.accessType === 'shared') {
      // User can manage shared businesses if they have a member role (MANAGER or CASHIER)
      return !!business.memberRole;
    }
    // For owned businesses
    if (business.createdBy === user?.id) return true;
    if (!isStaffUser) return true;
    return hasBusinessAccess && !!userBusinessId && business.id === userBusinessId;
  };

  const canEditOrDeleteBusiness = (business: Business) => {
    // Only business owner can edit/delete their own businesses
    if (business.accessType === 'shared') return false;
    return business.createdBy === user?.id;
  };

  const normalizeSubscriptionStatus = (status?: string | null) => {
    if (!status) return null;
    const value = status.toString().trim().toLowerCase();
    if (['active', 'trial'].includes(value)) return 'active';
    if (['grace'].includes(value)) return 'grace';
    if (['expired'].includes(value)) return 'expired';
    if ([
      'pending',
      'pending_payment',
      'pending_payment_approval',
      'payment_pending_approval',
      'payment approval pending',
      'awaiting approval',
      'waiting for approval',
    ].includes(value)) return 'pending';
    if (['cancelled', 'cancel', 'suspended', 'inactive', 'none'].includes(value)) return 'inactive';
    return value;
  };

  const capitalizeLabel = (value?: string | null) => {
    if (!value) return '';
    const text = value.toString().trim();
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  };

  const getBusinessSubscriptionDisplay = (businessId: string) => {
    const entry = businessSubscriptions[businessId];
    const statusKey = normalizeSubscriptionStatus(entry?.subscriptionStatus);
    const isSubscribed = Boolean(entry?.isSubscribed);

    let badgeClass = 'border-slate-200 bg-slate-100 text-slate-600';
    if (statusKey === 'grace') badgeClass = 'border-amber-200 bg-amber-100 text-amber-700';
    else if (isSubscribed) badgeClass = 'border-green-200 bg-green-50 text-green-700';
    else if (statusKey === 'expired') badgeClass = 'border-rose-200 bg-rose-100 text-rose-700';
    else if (statusKey === 'pending') badgeClass = 'border-amber-200 bg-amber-100 text-amber-700';
    else badgeClass = 'border-slate-200 bg-slate-100 text-slate-600';

    const planLabel = entry?.planName || 'No Plan';
    const statusLabel = statusKey ? capitalizeLabel(statusKey) : undefined;

    return {
      planLabel,
      statusLabel,
      badgeClass,
      isSubscribed,
      statusKey,
    };
  };

  // Determine provisioning state from user memberships
  const getProvisioningStatus = (businessId: string): { label: string; badgeClass: string } | null => {
    if (!user?.memberships) return null;
    const membership = user.memberships.find((m) => String(m.businessId) === String(businessId));
    if (!membership?.status) return null;
    if (membership.status === 'DOWNLOADED') {
      return { label: 'Downloaded', badgeClass: 'border-blue-200 bg-blue-50 text-blue-600' };
    }
    if (membership.status === 'OUT_OF_SYNC') {
      return { label: 'Out of Sync', badgeClass: 'border-amber-200 bg-amber-100 text-amber-700' };
    }
    return { label: 'Cloud Only', badgeClass: 'border-slate-200 bg-slate-100 text-slate-500' };
  };

  const getBusinessNavigationTarget = (business: Business) => {
    const slug = business.slug?.trim();
    const entry = businessSubscriptions[business.id];
    const statusKey = normalizeSubscriptionStatus(entry?.subscriptionStatus);
    const isOwnedOrAdmin = business.createdBy === user?.id || role === 'ADMIN';
    const shouldGoToSubscription = isOwnedOrAdmin && (!entry?.isSubscribed || statusKey === 'expired' || !entry?.subscriptionStatus);

    if (shouldGoToSubscription && slug) {
      return `/business/${encodeURIComponent(slug)}/subscription`;
    }

    return slug ? `/business/${encodeURIComponent(slug)}/dashboard` : '/dashboard';
  };

  const showCreateBusinessButton =
    canMutateBusinesses && (!showOwnershipTabs || businessListTab === 'owned');

  const heroBusinessCount = showOwnershipTabs
    ? businessListTab === 'owned'
      ? ownedBusinesses.length
      : sharedBusinesses.length
    : businesses.length;

  return (
    <>
      <div className="px-11 pb-14 pt-9">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#1a52c5] border-t-transparent" />
              <p className="mt-4 text-sm text-[#8c95b0]">Loading businesses...</p>
            </div>
          </div>
        ) : (
          <>
            <section className="zv3-page-hero relative mb-7 flex flex-col gap-5 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1a52c5] via-[#1f8ac8] to-[#28c2ce] px-8 py-9 sm:flex-row sm:items-center sm:justify-between lg:px-10">
              <div
                className="pointer-events-none absolute -right-[10%] -top-1/2 h-[400px] w-[400px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%)" }}
              />
              <div
                className="pointer-events-none absolute bottom-[-40%] left-[20%] h-[300px] w-[300px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)" }}
              />
              <div className="relative z-[1] flex items-center gap-5">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 backdrop-blur-md">
                  <Home className="h-[26px] w-[26px] text-white" strokeWidth={2} />
                </div>
                <div>
                  <h1 className="text-[22px] font-extrabold tracking-tight text-white sm:text-[26px]">Business Management</h1>
                  <p className="mt-1 text-sm text-white">
                    {role === "OWNER" || role === "USER"
                      ? "Manage your businesses and their branches"
                      : "Businesses you work with"}
                  </p>
                  <p className="mt-1 text-xs text-white/90">
                    {ownedBusinesses.length} owned · {sharedBusinesses.length} shared with you
                  </p>
                </div>
              </div>
              <div className="relative z-[1] flex w-full flex-wrap items-center justify-between gap-4 sm:w-auto sm:justify-end">
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-white">
                    {showOwnershipTabs
                      ? businessListTab === "owned"
                        ? "My businesses"
                        : "Shared with me"
                      : "Total Businesses"}
                  </div>
                  <div className="text-3xl font-black leading-none tracking-tight text-white drop-shadow-sm">
                    {heroBusinessCount}
                  </div>
                </div>
                {showCreateBusinessButton && (
                  <button
                    type="button"
                    onClick={openCreateDialog}
                    className="inline-flex items-center gap-2 rounded-[10px] bg-white px-[26px] py-3 text-sm font-bold text-[#1a52c5] shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(0,0,0,0.15)]"
                  >
                    <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
                    Create Business
                  </button>
                )}
              </div>
            </section>

            {businesses.length === 0 ? (
              <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-20 text-center shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_40px_rgba(0,0,0,0.04)]">
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-[18px] bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06]">
                  <Building2 className="h-7 w-7 text-[#8c95b0]" strokeWidth={1.8} />
                </div>
                <h3 className="mb-1.5 text-base font-bold text-[#0a1128]">No businesses found</h3>
                <p className="mx-auto mb-6 max-w-[320px] text-sm leading-relaxed text-[#8c95b0]">
                  Get started by creating your first business
                </p>
                {showCreateBusinessButton && (
                  <button
                    type="button"
                    onClick={openCreateDialog}
                    className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)]"
                  >
                    <Plus className="h-4 w-4" />
                    Create Your First Business
                  </button>
                )}
              </div>
            ) : (
              <div className="zv3-table-card overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_40px_rgba(0,0,0,0.04)]">
                <div className="flex flex-col gap-4 border-b border-[rgba(15,23,60,0.06)] px-6 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
                  {showOwnershipTabs && (
                    <div className="flex w-full max-w-xl gap-1 rounded-[12px] border border-[rgba(15,23,60,0.08)] bg-[#f0f2f7] p-1 lg:max-w-max">
                      <button
                        type="button"
                        onClick={() => {
                          setBusinessListTab("owned");
                          setSearchQuery("");
                        }}
                        className={cn(
                          "inline-flex flex-1 items-center justify-center gap-2 rounded-[9px] px-3 py-2.5 text-sm font-semibold transition-all sm:flex-initial sm:px-5",
                          businessListTab === "owned"
                            ? "bg-white text-[#1a52c5] shadow-[0_2px_8px_rgba(26,82,197,0.12)]"
                            : "text-[#8c95b0] hover:text-[#0a1128]"
                        )}
                      >
                        My businesses
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                            businessListTab === "owned"
                              ? "bg-[#1a52c5]/10 text-[#1a52c5]"
                              : "bg-black/[0.04] text-[#8c95b0]"
                          )}
                        >
                          {ownedBusinesses.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBusinessListTab("shared");
                          setSearchQuery("");
                        }}
                        className={cn(
                          "inline-flex flex-1 items-center justify-center gap-2 rounded-[9px] px-3 py-2.5 text-sm font-semibold transition-all sm:flex-initial sm:px-5",
                          businessListTab === "shared"
                            ? "bg-white text-[#1a52c5] shadow-[0_2px_8px_rgba(26,82,197,0.12)]"
                            : "text-[#8c95b0] hover:text-[#0a1128]"
                        )}
                      >
                        Shared with me
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                            businessListTab === "shared"
                              ? "bg-[#1a52c5]/10 text-[#1a52c5]"
                              : "bg-black/[0.04] text-[#8c95b0]"
                          )}
                        >
                          {sharedBusinesses.length}
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="relative flex w-full lg:w-auto">
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search businesses…"
                      className="h-11 w-full rounded-[12px] border border-[rgba(15,23,60,0.06)] bg-[#f0f2f7] px-4 pl-11 text-[13px] text-[#0a1128] outline-none transition-all placeholder:text-[#8c95b0] focus:border-[#1a52c5]/30 focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)] lg:w-[260px]"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%238c95b0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "14px center",
                      }}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto overflow-y-hidden" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 #f8fafc' }}>
                  <style>{`
                    .zv3-table-card::-webkit-scrollbar {
                      height: 6px;
                    }
                    .zv3-table-card::-webkit-scrollbar-track {
                      background: #f8fafc;
                      border-radius: 3px;
                    }
                    .zv3-table-card::-webkit-scrollbar-thumb {
                      background: #cbd5e1;
                      border-radius: 3px;
                    }
                    .zv3-table-card::-webkit-scrollbar-thumb:hover {
                      background: #94a3b8;
                    }
                  `}</style>
                  <table className="w-full min-w-full border-collapse">
                    <thead>
                      <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                        <th className="px-6 py-3.5 pl-8 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0] sm:pl-8">
                          Business
                        </th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                          Business Type
                        </th>
                        {showOwnershipTabs && businessListTab === "shared" && (
                          <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                            Role
                          </th>
                        )}
                        <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                          Status
                        </th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                          Subscription
                        </th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                          Contact
                        </th>
                        {showBranchesCol && (
                          <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                            Branches
                          </th>
                        )}
                        {showStaffCol && (
                          <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                            Staff
                          </th>
                        )}
                        <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                          Created
                        </th>
                        <th className="sticky right-0 z-10 px-6 py-3.5 pr-8 bg-white text-right text-xs font-semibold uppercase tracking-wide text-[#8c95b0] shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBusinesses.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7 + (showBranchesCol ? 1 : 0) + (showStaffCol ? 1 : 0) + (showOwnershipTabs && businessListTab === "shared" ? 1 : 0)}
                            className="px-8 py-16 text-center text-sm text-[#8c95b0]"
                          >
                            {searchQuery.trim()
                              ? `No businesses match "${searchQuery}"`
                              : showOwnershipTabs && businessListTab === "shared"
                                ? "No businesses have been shared with you yet. When an owner invites you as staff, they will appear here."
                                : showOwnershipTabs && businessListTab === "owned"
                                  ? "You have not created a business yet. Use Create Business to get started."
                                  : "No businesses to show."}
                          </td>
                        </tr>
                      ) : (
                        filteredBusinesses.map((business) => {
                          const subscriptionDisplay = getBusinessSubscriptionDisplay(business.id);
                          return (
                            <tr
                              key={business.id}
                              className="border-b border-[rgba(15,23,60,0.06)] transition-colors last:border-b-0 hover:bg-[#1a52c5]/[0.02]"
                            >
                            <td className="px-6 py-5 pl-8 align-middle">
                              <div className="flex items-center gap-3.5">
                                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5]/[0.08] to-[#28c2ce]/[0.06]">
                                  <Home className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[15px] font-bold tracking-tight text-[#0a1128]">{business.name}</span>
                                    {(() => {
                                      const ps = getProvisioningStatus(business.id);
                                      return ps ? (
                                        <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wider ${ps.badgeClass}`}>
                                          {ps.label}
                                        </span>
                                      ) : null;
                                    })()}
                                  </div>
                                  <div className="mt-0.5 line-clamp-1 text-xs text-[#8c95b0]">
                                    {business.address || business.description || "—"}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-5 align-middle">
                              <span className="inline-flex max-w-full items-center rounded-full bg-[#28c2ce]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#0f8f99]">
                                {getBusinessTypeLabel(business.businessType)}
                              </span>
                            </td>
                            {showOwnershipTabs && businessListTab === "shared" && (
                              <td className="px-6 py-5 align-middle">
                                <span className="inline-flex items-center rounded-full bg-[#0f8f99]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0f8f99] border border-[#0f8f99]/15">
                                  {business.memberRole || "MEMBER"}
                                </span>
                              </td>
                            )}
                            <td className="px-6 py-5 align-middle">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                business.isActive
                                  ? 'bg-green-50 text-green-600 border border-green-200'
                                  : 'bg-red-50 text-red-600 border border-red-200'
                              }`}>
                                {business.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-5 align-middle">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${subscriptionDisplay.badgeClass}`}>
                                {subscriptionDisplay.planLabel}
                                {subscriptionDisplay.statusLabel && (
                                  <span className="ml-1 opacity-70">· {subscriptionDisplay.statusLabel}</span>
                                )}
                              </span>
                            </td>
                            <td className="px-6 py-5 align-middle">
                              <div className="flex flex-col gap-1">
                                {business.phone && (
                                  <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                                    <Phone className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                                    <span>{business.phone}</span>
                                  </div>
                                )}
                                {business.email && (
                                  <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                                    <span className="max-w-[200px] truncate">{business.email}</span>
                                  </div>
                                )}
                                {!business.phone && !business.email && business.address && (
                                  <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                                    <MapPin className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                                    <span className="max-w-[200px] truncate">{business.address}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                            {showBranchesCol && (
                              <td className="px-6 py-5 align-middle">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1a52c5]/[0.06] px-3.5 py-1.5 text-[13px] font-semibold text-[#1a52c5]">
                                  <Store className="h-[15px] w-[15px]" strokeWidth={2} />
                                  {branchCount(business)}
                                </span>
                              </td>
                            )}
                            {showStaffCol && (
                              <td className="px-6 py-5 align-middle">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#28c2ce]/[0.08] px-3.5 py-1.5 text-[13px] font-semibold text-[#1aa8b3]">
                                  <Users className="h-[15px] w-[15px]" strokeWidth={2} />
                                  {(business.accessType === 'shared' && business.memberRole === 'MANAGER')
                                    ? (business._count?.memberships || 0) + (business._count?.employees || 0)
                                    : role === "MANAGER"
                                      ? branchStaffCount
                                      : (business._count?.memberships || 0) + (business._count?.employees || 0)}
                                </span>
                              </td>
                            )}
                            <td className="px-6 py-5 align-middle">
                              <span className="text-sm font-medium text-[#4a5578]">{formatDate(business.createdAt)}</span>
                            </td>
                            <td className="sticky right-0 z-10 px-4 py-4 pr-6 bg-white text-right align-middle whitespace-nowrap shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleClickToGo(business.id)}
                                  disabled={!canManageBusiness(business)}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all",
                                    canManageBusiness(business)
                                      ? "bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_3px_12px_rgba(26,82,197,0.2)] hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(26,82,197,0.3)]"
                                      : "cursor-not-allowed bg-slate-200 text-slate-500"
                                  )}
                                  title={!canManageBusiness(business) ? "You do not have access to this business" : undefined}
                                >
                                  Manage
                                  <ArrowRight className="h-[14px] w-[14px]" strokeWidth={2.5} />
                                </button>
                                {canMutateBusinesses && canEditOrDeleteBusiness(business) && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditDialog(business)}
                                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                                      title="Edit"
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openDeleteDialog(business)}
                                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] transition-colors hover:border-red-600/15 hover:bg-red-600/[0.05] hover:text-red-600"
                                      title="Delete"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (open) openCreateDialog();
          else setIsCreateDialogOpen(false);
        }}
      >
        <DialogContent className="zv3-modal-scrollbar z-[100] max-h-[90vh] gap-0 overflow-y-auto rounded-[28px] rounded-t-[28px] rounded-b-[28px] border border-[rgba(15,23,60,0.06)] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:max-w-[500px] [&>button]:hidden" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent', scrollbarGutter: 'stable' }}>
          <style>{`
            .zv3-modal-scrollbar::-webkit-scrollbar {
              width: 8px;
            }
            .zv3-modal-scrollbar::-webkit-scrollbar-track {
              background: transparent;
              border-radius: 0;
            }
            .zv3-modal-scrollbar::-webkit-scrollbar-thumb {
              background: #cbd5e1;
              border-radius: 28px;
              border: 2px solid white;
            }
            .zv3-modal-scrollbar::-webkit-scrollbar-thumb:hover {
              background: #94a3b8;
            }
          `}</style>
          <DialogHeader className="space-y-0 p-8 pb-0 text-left">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Create New Business</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-[#8c95b0]">Add a new business to your account</DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateDialogOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[rgba(15,23,60,0.06)] text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                aria-label="Close"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-5 px-8 py-7 pr-6">
            <div className="space-y-2">
              <Label htmlFor="cm-name" className="text-sm font-semibold text-[#0a1128]">
                Business Name <span className="text-red-600">*</span>
              </Label>
              <Input
                id="cm-name"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="Enter business name"
                className={cn(
                  "h-12 rounded-[10px] border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white text-[15px] focus-visible:border-[#1a52c5] focus-visible:outline-none transition-all duration-200",
                  formErrors.name && "border-red-500"
                )}
              />
              {formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cm-desc" className="text-sm font-semibold text-[#0a1128]">
                Description
              </Label>
              <Textarea
                id="cm-desc"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter business description"
                rows={3}
                className="min-h-[90px] rounded-[10px] border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white text-[15px] focus-visible:border-[#1a52c5] focus-visible:outline-none transition-all duration-200 resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cm-business-type" className="text-sm font-semibold text-[#0a1128]">
                Business Type <span className="text-red-600">*</span>
              </Label>
              <Select
                  value={formData.businessType}
                  onValueChange={(value) => setFormData({ ...formData, businessType: value })}
                >
                  <SelectTrigger id="cm-business-type" className={cn(
                    "h-12 w-full rounded-[10px] border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white px-3 text-[15px] focus-visible:border-[#1a52c5] focus-visible:outline-none transition-all duration-200",
                    formErrors.businessType && "border-red-500"
                  )}>
                    <SelectValue placeholder="Select business type" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {(() => {
                      const seen = new Set<string>();
                      const items: Array<{ value: string; label: string }> = [];

                      if (Array.isArray(businessTypes) && businessTypes.length > 0) {
                        for (const type of businessTypes) {
                          const rawName = String((type as any)?.name || '').trim();
                          const canonical = rawName
                            ? rawName
                                .toUpperCase()
                                .replace(/[\s-]+/g, '_')
                                .replace(/_+/g, '_')
                            : '';

                          if (!canonical) continue;
                          if (seen.has(canonical)) continue;
                          seen.add(canonical);

                          const label = rawName
                            ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase().replace(/_/g, ' ')
                            : 'Business';

                          items.push({ value: canonical, label });
                        }
                      }

                      // Fallback: ensure all canonical types are available
                      const fallbackTypes = [
                        { value: 'PHARMACY', label: 'Pharmacy' },
                        { value: 'DEPARTMENTAL_STORE', label: 'Departmental Store' },
                        { value: 'RETAIL_STORE', label: 'Retail Store' },
                        { value: 'HOTEL', label: 'Hotel' },
                        { value: 'CLINIC', label: 'Clinic' },
                      ];

                      for (const fallback of fallbackTypes) {
                        if (!seen.has(fallback.value)) {
                          items.push(fallback);
                          seen.add(fallback.value);
                        }
                      }

                      return items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ));
                    })()}
                  </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cm-addr" className="text-sm font-semibold text-[#0a1128]">
                Address
              </Label>
              <Input
                id="cm-addr"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Enter business address"
                className="h-12 rounded-[10px] border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white text-[15px] focus-visible:border-[#1a52c5] focus-visible:outline-none transition-all duration-200"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cm-phone" className="text-sm font-semibold text-[#0a1128]">
                  Phone Number <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="cm-phone"
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  placeholder="e.g., +923001234567"
                  className={cn(
                    "h-12 rounded-[10px] border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white text-[15px] focus-visible:border-[#1a52c5] focus-visible:outline-none transition-all duration-200",
                    formErrors.phone && "border-red-500"
                  )}
                />
                {formErrors.phone && <p className="text-xs text-red-500">{formErrors.phone}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cm-email" className="text-sm font-semibold text-[#0a1128]">
                  Email Address <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="cm-email"
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="e.g., business@example.com"
                  className={cn(
                    "h-12 rounded-[10px] border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white text-[15px] focus-visible:border-[#1a52c5] focus-visible:outline-none transition-all duration-200",
                    formErrors.email && "border-red-500"
                  )}
                />
                {formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3 border-0 px-8 pb-8 pt-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateBusiness}
              disabled={!formData.name.trim() || !formData.email.trim() || !formData.phone.trim()}
              className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
            >
              Create Business
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog — same shell as Create */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="z-[100] max-h-[90vh] gap-0 overflow-y-auto rounded-[28px] border border-[rgba(15,23,60,0.06)] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:max-w-[560px] [&>button]:hidden">
          <DialogHeader className="space-y-0 p-8 pb-0 text-left">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Edit Business</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-[#8c95b0]">Update business information</DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsEditDialogOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[rgba(15,23,60,0.06)] text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                aria-label="Close"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            </div>
          </DialogHeader>
          <div className="flex max-h-[calc(90vh-170px)] flex-col gap-5 overflow-y-auto px-8 py-7">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm font-semibold text-[#0a1128]">
                Business Name <span className="text-red-600">*</span>
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="Enter business name"
                className={cn(
                  "h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8",
                  formErrors.name && "border-red-500"
                )}
              />
              {formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description" className="text-sm font-semibold text-[#0a1128]">
                Description
              </Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter business description"
                rows={3}
                className="min-h-[90px] rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-business-type" className="text-sm font-semibold text-[#0a1128]">
                Business Type <span className="text-red-600">*</span>
              </Label>
              <Input
                id="edit-business-type"
                value={getBusinessTypeLabel(formData.businessType)}
                disabled
                className="h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address" className="text-sm font-semibold text-[#0a1128]">
                Address
              </Label>
              <Input
                id="edit-address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Enter business address"
                className="h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-phone" className="text-sm font-semibold text-[#0a1128]">
                  Phone Number <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="edit-phone"
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  placeholder="e.g., +923001234567"
                  className={cn(
                    "h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8",
                    formErrors.phone && "border-red-500"
                  )}
                />
                {formErrors.phone && <p className="text-xs text-red-500">{formErrors.phone}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email" className="text-sm font-semibold text-[#0a1128]">
                  Email Address <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="edit-email"
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="e.g., business@example.com"
                  className={cn(
                    "zv3-modal-email-input h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-0 focus-visible:ring-offset-0",
                    formErrors.email && "border-red-500"
                  )}
                />
                {formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3 border-0 px-8 pb-8 pt-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleEditBusiness}
              disabled={!formData.name.trim() || !formData.email.trim() || !formData.phone.trim()}
              className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
            >
              Update Business
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog — v3 shell + branded destructive styling */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="z-[100] gap-0 overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:max-w-[480px] [&>button]:hidden">
          <div className="relative px-8 pb-2 pt-8 text-center">
            <button
              type="button"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="absolute right-6 top-6 grid h-9 w-9 place-items-center rounded-[10px] border border-[rgba(15,23,60,0.06)] text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
              aria-label="Close"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-gradient-to-br from-red-100 to-rose-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <AlertTriangle className="h-9 w-9 text-red-600" strokeWidth={2} />
            </div>
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Delete Business</DialogTitle>
            <DialogDescription className="mx-auto mt-3 max-w-[400px] text-center text-sm leading-relaxed text-[#8c95b0]">
              Are you sure you want to delete{" "}
              <span className="font-bold text-[#0a1128]">&ldquo;{businessToDelete?.name}&rdquo;</span>? This action cannot be undone
              and will remove all associated data including branches, staff, and products.
            </DialogDescription>
          </div>
          <div className="mx-8 mt-2 rounded-2xl border border-red-200/80 bg-gradient-to-br from-red-50 to-rose-50/90 p-5">
            <div className="flex gap-3 text-left">
              <div className="mt-0.5 shrink-0">
                <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/80 text-red-600 shadow-sm">
                  <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2} />
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-red-800">Warning: This will permanently delete:</p>
                <ul className="mt-2 list-inside list-disc space-y-1.5 text-sm font-medium text-red-700">
                  <li>All branches ({businessToDelete?.branches?.length || 0})</li>
                  <li>
                    All staff members (
                    {(businessToDelete?._count?.memberships || 0) + (businessToDelete?._count?.employees || 0)})
                  </li>
                  <li>All products and inventory data</li>
                </ul>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-2 flex flex-col-reverse gap-3 border-0 px-8 pb-8 pt-6 sm:flex-row sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="h-11 flex-1 rounded-[10px] border-[rgba(15,23,60,0.06)] bg-white font-semibold text-[#4a5578] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDeleteBusiness}
              className="h-11 flex-1 rounded-[10px] border-0 bg-red-600 font-semibold text-white shadow-[0_4px_16px_rgba(220,38,38,0.25)] hover:bg-red-700 hover:opacity-[0.98]"
            >
              <Trash2 className="mr-2 h-4 w-4" strokeWidth={2} />
              Delete Business
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSubscriptionRequiredDialogOpen} onOpenChange={setIsSubscriptionRequiredDialogOpen}>
        <DialogContent className="z-[100] max-w-[560px] rounded-[20px]">
          <DialogHeader>
            <DialogTitle className="text-[#0a1128]">Subscription Required</DialogTitle>
            <DialogDescription className="text-[#4a5578]">
              {isSharedBusinessLocked
                ? "The business owner's subscription has expired. Please contact the owner to upgrade their subscription to access this business."
                : "A subscription is required to access business management system. Please upgrade your plan to manage this business and access business features."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 mb-6 rounded-[12px] border border-[#1a52c5]/10 bg-[#1a52c5]/[0.04] px-4 py-3 text-sm text-[#1a52c5]">
            Selected business: <span className="font-semibold">{lockedBusinessName}</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsSubscriptionRequiredDialogOpen(false);
                setRefreshSubscriptionTrigger(prev => prev + 1);
              }}
              className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
            >
              Close
            </Button>
            {!isSharedBusinessLocked && (
              <Button
                type="button"
                className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                onClick={() => {
                  setIsSubscriptionRequiredDialogOpen(false);
                navigate(lockedBusinessSlug ? `/business/${encodeURIComponent(lockedBusinessSlug)}/subscription` : '/zapeera/my-businesses');
              }}
              >
                Upgrade Plan
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(BusinessManagement);