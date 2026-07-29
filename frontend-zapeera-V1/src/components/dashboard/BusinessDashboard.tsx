import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ShoppingCart,
  Package,
  Users,
  TrendingUp,
  AlertTriangle,
  Wifi,
  Clock,
  DollarSign,
  Pill,
  Calendar,
  Building2,
  UserPlus,
  BarChart3,
  PieChart,
  LineChart,
  Download,
  Eye,
  CheckCircle,
  X,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  ArrowRight,
  Mail,
  Phone,
} from "lucide-react";
import { cn } from '@/lib/utils';
import { apiService } from '@/services/api';
import { toast } from 'sonner';
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { withBusinessSlug } from '@/utils/business-routes';
import { SyncStatusBadge } from "@/components/SyncStatusIndicator";
import { useBusinessModules } from "@/hooks/useBusinessModules";
import React, { useLayoutEffect } from "react";

const BusinessDashboard = () => {

  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const {
    selectedCompanyId,
    setSelectedCompanyId,
    selectedBranchId,
    setSelectedBranchId,
    allCompanies,
    allBranches,
    selectedCompany,
    selectedBranch: globalSelectedBranch
  } = useAdmin();
  const { hasModule } = useBusinessModules();

  // Detect businessSlug from URL pathname (e.g., /business/my-business/dashboard)
  const businessSlugFromUrl = useMemo(() => {
    const match = location.pathname.match(/\/business\/([^\/]+)/);
    return match ? match[1] : '';
  }, [location.pathname]);

  // Find company by URL slug
  const companyByUrlSlug = useMemo(() => {
    if (!businessSlugFromUrl) return null;
    return allCompanies.find((c: any) => c.slug === businessSlugFromUrl) || null;
  }, [businessSlugFromUrl, allCompanies]);

  // Use company from URL slug if available, otherwise fall back to selectedCompany
  const displayCompany = companyByUrlSlug || selectedCompany;
  const subscriptionPath = useMemo(
    () => withBusinessSlug(displayCompany?.slug || businessSlugFromUrl || null, '/subscription'),
    [displayCompany?.slug, businessSlugFromUrl]
  );

  const effectiveCompanyId = companyByUrlSlug?.id || selectedCompanyId || (businessSlugFromUrl ? null : user?.companyId) || null;
  const effectiveBranchId = selectedBranchId || (!selectedCompanyId && user?.branchId ? user.branchId : null);

  // Memoize logout function to prevent re-renders
  const memoizedLogout = useCallback(() => {
    logout();
  }, [logout]);
  const [isOnline, setIsOnline] = useState(true);
  const [loading, setLoading] = useState(false); // Start with false to show content immediately
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [branchDetails, setBranchDetails] = useState<any>(null);
  const [showBranchDetails, setShowBranchDetails] = useState(false);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [showAllRecentSales, setShowAllRecentSales] = useState(false);
  const [showAllLowStock, setShowAllLowStock] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  // Initialize state without cache
  const [realSalesData, setRealSalesData] = useState<any[]>([]);
  const [realProductsData, setRealProductsData] = useState<any[]>([]);
  const [realRevenue, setRealRevenue] = useState(0);
  const [realTotalSales, setRealTotalSales] = useState(0);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [isBranchSummaryCollapsed, setIsBranchSummaryCollapsed] = useState(false);
  const [activeStatTab, setActiveStatTab] = useState(0); // Only first card is active, no changes allowed

  // Expiry alerts state
  const [nearExpiryBatches, setNearExpiryBatches] = useState<any[]>([]);
  const [expiredBatches, setExpiredBatches] = useState<any[]>([]);
  const [showAllExpiryAlerts, setShowAllExpiryAlerts] = useState(false);
  const [todaySales, setTodaySales] = useState<any>({ count: 0, revenue: 0 });
  const [totalCost, setTotalCost] = useState(0);
  const [allBatches, setAllBatches] = useState<any[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([]);
  const [batchesOverview, setBatchesOverview] = useState({ total: 0, expired: 0, outOfStock: 0 });
  const [mostSellingProducts, setMostSellingProducts] = useState<any[]>([]);
  const [slowSellingProducts, setSlowSellingProducts] = useState<any[]>([]);
  const [growthMetrics, setGrowthMetrics] = useState({
    todayGrowth: 0,
    monthGrowth: 0,
    productsGrowth: 0,
    branchesGrowth: 0,
    staffGrowth: 0
  });

  // Company management state (now handled by AdminContext)
  const [globalSelectedCompany, setGlobalSelectedCompany] = useState<any>(null);

  // Track if initial load has happened
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const lastLoadedContextRef = useRef<string | null>(null); // Guard against redundant reloads
  

  // Real-time clock timer
  useEffect(() => {
    const updateDateTime = () => {
      setCurrentDateTime(new Date());
    };

    updateDateTime();
    timerRef.current = setInterval(updateDateTime, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Load expiry alerts data - CRITICAL: Define BEFORE loadDashboardData to avoid circular dependency
  const loadExpiryAlerts = useCallback(async () => {
    try {
      console.log('Loading expiry alerts (Admin)...', { selectedBranchId, selectedCompanyId, allBatchesCount: allBatches.length });

      // CRITICAL: Use batches from allBatches state (loaded in loadDashboardData)
      // Filter by selected branch if branch is selected
      // If All Branches is selected (no branchId), show all batches from selected company
      let batchesToCheck = allBatches;
      if (selectedBranchId) {
        // Specific branch selected - filter by branchId
        batchesToCheck = allBatches.filter((batch: any) => batch.branchId === selectedBranchId);
        console.log(`📦 Filtered batches for expiry alerts (specific branch): ${allBatches.length} -> ${batchesToCheck.length}`);
      } else if (selectedCompanyId && allBranches.length > 0) {
        // All Branches selected - ensure batches belong to selected company's branches
        const companyBranchIds = allBranches
          .filter(b => b.companyId === selectedCompanyId)
          .map(b => b.id);
        if (companyBranchIds.length > 0) {
          batchesToCheck = allBatches.filter((batch: any) =>
            companyBranchIds.includes(batch.branchId)
          );
          console.log(`📦 Filtered batches for expiry alerts (All Branches): ${allBatches.length} -> ${batchesToCheck.length} (company: ${selectedCompanyId}, branches: ${companyBranchIds.length})`);
        } else {
          // If no branches found, use all batches (already filtered by companyId from API)
          console.log(`📦 No branches found for company, using all batches: ${allBatches.length}`);
          batchesToCheck = allBatches;
        }
      } else if (selectedCompanyId) {
        // Company selected but branches not loaded yet - use all batches (already filtered by companyId from API)
        console.log(`📦 Branches not loaded yet, using all batches: ${allBatches.length}`);
        batchesToCheck = allBatches;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      // Filter expired batches (expireDate < today)
      const expired = batchesToCheck.filter((batch: any) => {
        if (!batch.expireDate) return false;
        const expireDate = new Date(batch.expireDate);
        return expireDate < today;
      });

      // Filter near expiry batches (expireDate between today and 30 days from now)
      const nearExpiry = batchesToCheck.filter((batch: any) => {
        if (!batch.expireDate) return false;
        const expireDate = new Date(batch.expireDate);
        return expireDate >= today && expireDate <= thirtyDaysFromNow;
      });

      setExpiredBatches(expired);
      setNearExpiryBatches(nearExpiry);

      console.log('📦 Expiry alerts loaded:', {
        expired: expired.length,
        nearExpiry: nearExpiry.length,
        totalBatches: batchesToCheck.length
      });
    } catch (error) {
      console.error('Error loading expiry alerts (Admin):', error);
      // Set empty arrays on error to prevent UI issues
      setNearExpiryBatches([]);
      setExpiredBatches([]);
    }
  }, [selectedBranchId, selectedCompanyId, allBatches, allBranches]);

  const calculateLowStockProducts = useCallback((products: any[] = []) => {
    return products
      .filter((product: any) => {
        const stock = Number(product.stock ?? product.totalStock ?? 0);
        const minStock = Number(product.minStock ?? product.minStockLevel ?? 0);
        return stock <= minStock;
      })
      .sort((a: any, b: any) => {
        const aStock = Number(a.stock ?? a.totalStock ?? 0);
        const bStock = Number(b.stock ?? b.totalStock ?? 0);
        return aStock - bStock;
      });
  }, []);

  const loadDashboardData = useCallback(async (forceRefresh: boolean = false) => {
    try {
      // CRITICAL FIX: Ensure selectedCompanyId is available before making any API calls
      // Without selectedCompanyId, API calls won't have X-Business-ID header, causing 404s
      if (!effectiveCompanyId) {
        console.warn('⚠️ loadDashboardData called without effectiveCompanyId - aborting to prevent 404s');
        setError('Please select a company first');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // Get current user info
      const currentUserData = JSON.parse(localStorage.getItem('zapeera_user') || '{}');
      setCurrentUser(currentUserData);
      const currentUserRole = currentUserData.role;
      const currentUserId = currentUserData.id;
      const currentUserBranchId = currentUserData.branchId || currentUserData.branch?.id;

      // CRITICAL FIX: When "All Branches" is selected (no branchId), don't pass branchId
      // This ensures API collects data from ALL branches of the selected company
      // When specific branch is selected, pass branchId to filter by that branch
      const requestBranchId = effectiveBranchId || undefined;
      const requestCompanyId = effectiveCompanyId;

      console.log('🔍 Loading dashboard data:', {
        selectedCompanyId,
        selectedBranchId,
        effectiveCompanyId,
        effectiveBranchId,
        requestCompanyId,
        currentUserBranchId,
        userCompanyId: currentUserData.companyId,
        isAllBranches: !effectiveBranchId && requestCompanyId ? 'YES - Collecting all branches data' : 'NO'
      });

      // CRITICAL FIX: Load ALL data in parallel - sab ek saath load ho
      // This ensures all widgets get data at the same time, not sequentially
      // CRITICAL FIX: Only call APIs for modules that are actually enabled
      // This prevents 403 'Module X is disabled' errors from flooding the console
      const dashboardBranchId = effectiveBranchId || undefined;
      console.log('🔍 Admin Dashboard - Loading data (module-aware):', {
        selectedCompanyId,
        selectedBranchId,
        effectiveBranchId,
        dashboardBranchId: dashboardBranchId || 'All Branches',
        isAllBranches: !effectiveBranchId && selectedCompanyId,
        modules: { reports: hasModule('reports'), sales: hasModule('sales'), inventory: hasModule('inventory'), business_management: hasModule('business_management') }
      });
      
      // Empty/default response for disabled modules
      const emptyResponse = { success: true, data: null };
      
      // CRITICAL FIX: Fetch true module status explicitly before firing APIs 
      // This avoids any timing issues with the useBusinessModules hook
      let trulyEnabledModules: Record<string, boolean> = {};
      try {
        const modulesResponse = await (apiService as any).getEnabledModules();
        if (modulesResponse.success && Array.isArray(modulesResponse.data)) {
          trulyEnabledModules = modulesResponse.data.reduce((acc: Record<string, boolean>, item: any) => {
            acc[String(item.name).toLowerCase()] = Boolean(item.enabled);
            return acc;
          }, {});
        } else {
          // If the API fails, fall back to what hook says just in case
          trulyEnabledModules = {
            reports: hasModule('reports'),
            sales: hasModule('sales'),
            inventory: hasModule('inventory'),
            business_management: hasModule('business_management')
          };
        }
      } catch (e) {
        console.warn('AdminDashboard: Failed to fetch enabled modules reliably', e);
        // Fall back to false to be safe and avoid 403s
      }

      const isTrulyEnabled = (name: string) => Boolean(trulyEnabledModules[name.toLowerCase()]);

      console.log('🔍 Verified Modules before API calls:', trulyEnabledModules);

      // Load ALL APIs in parallel - only call enabled modules
      // Type assertion needed because TypeScript has trouble inferring large class types
      const api = apiService as any;
      // Define promises with proper error handling to capture backend messages
      const dashboardPromise = isTrulyEnabled('reports')
        ? api.getDashboardData(dashboardBranchId).catch((e: any) => {
            // Suppress 500 errors from console, they're expected when backend has issues
            if (e?.response?.status === 500 || e?.status === 500) {
              console.log('Dashboard API returned 500 (backend error, using fallback)');
              return { success: false, data: null };
            }
            return { success: false, message: e.message || 'Dashboard failed', data: null };
          })
        : Promise.resolve(emptyResponse);

      const salesPromise = isTrulyEnabled('sales')
        ? api.getSales({
            page: 1,
            limit: 100,
            ...(effectiveBranchId && { branchId: effectiveBranchId })
          }).catch((e: any) => ({ success: false, message: e.message || 'Sales failed', data: null }))
        : Promise.resolve({ success: true, data: { sales: [] } });

      const productsPromise = isTrulyEnabled('inventory')
        ? api.getProducts({
            page: 1,
            limit: 200,
            ...(effectiveBranchId && { branchId: effectiveBranchId })
          }).catch((e: any) => ({ success: false, message: e.message || 'Products failed', data: null }))
        : Promise.resolve({ success: true, data: { products: [] } });

      const usersPromise = api.getUsers({
          page: 1,
          limit: 200,
          ...(effectiveBranchId && { branchId: effectiveBranchId })
        }).catch((e: any) => ({ success: false, message: e.message || 'Users failed', data: null }));

      const batchesPromise = isTrulyEnabled('inventory')
        ? api.getBatches({
            page: 1,
            limit: 500,
            isActive: true,
            ...(effectiveBranchId && { branchId: effectiveBranchId }),
            ...(effectiveCompanyId && { companyId: effectiveCompanyId })
          }).catch((e: any) => ({ success: false, message: e.message || 'Batches failed', data: null }))
        : Promise.resolve({ success: true, data: { batches: [] } });

      const [dashboardResponse, salesResponse, productsResponse, usersResponse, batchesResponse] = await Promise.all([
        dashboardPromise,
        salesPromise,
        productsPromise,
        usersPromise,
        batchesPromise
      ]);
      
      console.log('✅ All APIs loaded in parallel (module-aware)');

      // Process dashboard data from getDashboardData API FIRST
      // This ensures we have proper aggregated data from the start
      let apiRevenue = 0;
      let apiTotalSales = 0;
      let recentSalesFromAPI: any[] = [];

      if (dashboardResponse.success && dashboardResponse.data) {
        const dashboardData = dashboardResponse.data;
        console.log('📊 Dashboard data from API:', dashboardData);
        console.log('[Dashboard] Inventory data:', dashboardData.inventory);

        // CRITICAL FIX: Use API aggregated data for proper business stats
        apiRevenue = dashboardData.month?.revenue || 0;
        apiTotalSales = dashboardData.month?.transactions || 0;
        recentSalesFromAPI = dashboardData.recentSales || [];

        // Set revenue and sales from API (these are properly aggregated)
        setRealRevenue(apiRevenue);
        setRealTotalSales(apiTotalSales);

        // Set Today's sales from API if available (much more accurate than local filtering of paginated data)
        if (dashboardData.today) {
          setTodaySales({
            count: dashboardData.today.transactions || 0,
            revenue: dashboardData.today.revenue || 0
          });
        }

        // Capture total products and staff from backend if provided
        setDashboardData((prev: any) => ({
          ...(prev || {}),
          totalRevenue: apiRevenue,
          totalSales: apiTotalSales,
          recentSales: recentSalesFromAPI,
          totalProducts: dashboardData.totalProducts,
          totalStaff: dashboardData.totalStaff,
          mostSellingProducts: dashboardData.mostSellingProducts || [],
          slowSellingProducts: dashboardData.slowSellingProducts || [],
          totalCost: dashboardData.totalCost,
          batchesOverview: dashboardData.batchesOverview
        }));

        if (dashboardData.mostSellingProducts) {
          setMostSellingProducts(dashboardData.mostSellingProducts);
        }
        if (dashboardData.slowSellingProducts) {
          setSlowSellingProducts(dashboardData.slowSellingProducts);
        }
        if (dashboardData.totalCost !== undefined) {
          setTotalCost(dashboardData.totalCost);
        }
        if (dashboardData.batchesOverview) {
          setBatchesOverview(dashboardData.batchesOverview);
        }
        // Use lowStockProductsList from dashboard API if available (new field)
        if (dashboardData.inventory?.lowStockProductsList) {
          console.log('[Dashboard] Using lowStockProductsList from dashboard API:', dashboardData.inventory.lowStockProductsList.length);
          setLowStockProducts(dashboardData.inventory.lowStockProductsList);
        } else if (dashboardData.lowStockProducts) {
          // Fallback to old field (just a count number)
          setLowStockProducts(dashboardData.lowStockProducts);
        }
      } else {
        console.warn('Dashboard API failed or returned no data:', dashboardResponse.message || 'Unknown error');
        setRealRevenue(0);
        setRealTotalSales(0);
      }

      // Cache will be saved at the end after all processing is complete

      // Process real sales data for recent sales list
      if (salesResponse.success && salesResponse.data) {
        let sales = salesResponse.data.sales || [];
        
        // CRITICAL FIX: Double-check branch filtering on frontend
        // If specific branch is selected, ensure we only show that branch's data
        if (effectiveBranchId) {
          sales = sales.filter((sale: any) => sale.branchId === effectiveBranchId);
          console.log(`🔍 Filtered sales by branch ${effectiveBranchId}: ${salesResponse.data.sales?.length || 0} -> ${sales.length}`);
        } else if (effectiveCompanyId) {
          // All Branches selected - ensure sales belong to selected company's branches
          const companyBranchIds = allBranches
            .filter(b => b.companyId === effectiveCompanyId)
            .map(b => b.id);
          if (companyBranchIds.length > 0) {
            sales = sales.filter((sale: any) => companyBranchIds.includes(sale.branchId));
            console.log(`🔍 Filtered sales by company ${effectiveCompanyId}: ${salesResponse.data.sales?.length || 0} -> ${sales.length} (branches: ${companyBranchIds.length})`);
          }
        }
        
        setRealSalesData(sales);

        // Calculate today's sales
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todaySalesData = sales.filter((sale: any) => {
          if (sale.status === 'REFUNDED') return false;
          const saleDate = new Date(sale.createdAt);
          return saleDate >= today && saleDate < tomorrow;
        });

        const todaySalesCount = todaySalesData.length;
        const todaySalesRevenue = todaySalesData.reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0);
        
        // ONLY update todaySales if it wasn't already set from the more accurate dashboard API
        setTodaySales(prev => {
          if (prev.count > 0 || prev.revenue > 0) return prev;
          return { count: todaySalesCount, revenue: todaySalesRevenue };
        });

        // Use API aggregated data if available, otherwise calculate from sales
        const totalRevenue = apiRevenue > 0 ? apiRevenue : sales
          .filter((sale: any) => sale.status !== 'REFUNDED')
          .reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0);
        const totalSalesCount = apiTotalSales > 0 ? apiTotalSales : sales
          .filter((sale: any) => sale.status !== 'REFUNDED').length;

        // Calculate yesterday's sales for growth comparison
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayEnd = new Date(today);
        const yesterdaySalesData = sales.filter((sale: any) => {
          if (sale.status === 'REFUNDED') return false;
          const saleDate = new Date(sale.createdAt);
          return saleDate >= yesterday && saleDate < today;
        });
        const yesterdaySalesRevenue = yesterdaySalesData.reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0);

        // Calculate last month's sales for growth comparison
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastMonthSalesData = sales.filter((sale: any) => {
          if (sale.status === 'REFUNDED') return false;
          const saleDate = new Date(sale.createdAt);
          return saleDate >= lastMonthStart && saleDate < lastMonthEnd;
        });
        const lastMonthRevenue = lastMonthSalesData.reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0);

        // Calculate growth percentages
        const todayGrowth = yesterdaySalesRevenue > 0
          ? ((todaySalesRevenue - yesterdaySalesRevenue) / yesterdaySalesRevenue) * 100
          : 0;
        const monthGrowth = lastMonthRevenue > 0
          ? ((totalRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
          : 0;

        setGrowthMetrics(prev => ({
          ...prev,
          todayGrowth,
          monthGrowth
        }));

        // Use recent sales from API if available, otherwise use fetched sales
        const recentSales = recentSalesFromAPI.length > 0
          ? recentSalesFromAPI.slice(0, 10)
          : sales.slice(0, 10);

        // Create dashboard data structure with real data (prioritize API data)
        setDashboardData((prev: any) => ({
          ...(prev || {}),
          totalRevenue: totalRevenue,
          totalSales: totalSalesCount,
          recentSales: recentSales
        }));
      } else if (apiRevenue > 0 || apiTotalSales > 0) {
        // If sales API failed but we have API dashboard data, use that
        setDashboardData((prev: any) => ({
          ...(prev || {}),
          totalRevenue: apiRevenue,
          totalSales: apiTotalSales,
          recentSales: recentSalesFromAPI.slice(0, 10)
        }));
      } else {
        const msg = (salesResponse as any).message || 'Failed to load sales data';
        setError(msg);
        console.error('Sales load failure:', salesResponse);
      }

      let filteredProductsForMetrics: any[] = [];

      // Process real products data
      console.log('[Dashboard] productsResponse:', { success: productsResponse.success, hasData: !!productsResponse.data, productCount: productsResponse.data?.products?.length, message: (productsResponse as any).message, effectiveBranchId, effectiveCompanyId });
      if (productsResponse.success && productsResponse.data) {
        let products = productsResponse.data.products || [];
        console.log('[Dashboard] Raw products count:', products.length);
        
        // CRITICAL FIX: Double-check branch filtering on frontend
        // If specific branch is selected, ensure we only show that branch's data
        if (effectiveBranchId) {
          products = products.filter((product: any) => product.branchId === effectiveBranchId);
          console.log(`🔍 Filtered products by branch ${effectiveBranchId}: ${productsResponse.data.products?.length || 0} -> ${products.length}`);
        } else if (effectiveCompanyId) {
          // All Branches selected - ensure products belong to selected company's branches
          const companyBranchIds = allBranches
            .filter(b => b.companyId === effectiveCompanyId)
            .map(b => b.id);
          if (companyBranchIds.length > 0) {
            products = products.filter((product: any) => companyBranchIds.includes(product.branchId));
            console.log(`🔍 Filtered products by company ${effectiveCompanyId}: ${productsResponse.data.products?.length || 0} -> ${products.length} (branches: ${companyBranchIds.length})`);
          }
        }
        filteredProductsForMetrics = products;
        setRealProductsData(products);

        const lowStockProductsList = calculateLowStockProducts(products);
        console.log('[Dashboard] Low stock calculation:', { inputCount: products.length, lowStockCount: lowStockProductsList.length, firstLowStock: lowStockProductsList[0]?.name });
        setLowStockProducts(lowStockProductsList);

        setDashboardData((prev: any) => ({
          ...(prev || {}),
          lowStockProducts: lowStockProductsList
        }));

        // Set top products (you can customize this logic)
        setTopProducts(products.slice(0, 10));
      } else {
        const msg = (productsResponse as any).message || 'Failed to load products data';
        setError(msg);
        console.error('Products load failure:', productsResponse);
        setLowStockProducts([]);
      }

      // CRITICAL: Process batches data separately
      if (batchesResponse.success && batchesResponse.data) {
        const batches = batchesResponse.data.batches || [];

        // Filter batches based on selection:
        // - If specific branch selected: filter by branchId
        // - If All Branches selected (no branchId): show all batches from selected company's branches
        let filteredBatches = batches;
        if (effectiveBranchId) {
          // Specific branch selected - filter by branchId
          filteredBatches = batches.filter((batch: any) => batch.branchId === effectiveBranchId);
          console.log(`📦 Filtered batches for specific branch: ${batches.length} -> ${filteredBatches.length}`);
        } else if (effectiveCompanyId && allBranches.length > 0) {
          // All Branches selected - filter by companyId (batches should already be filtered by API headers)
          // Double-check: ensure batches belong to selected company's branches
          const companyBranchIds = allBranches
            .filter(b => b.companyId === effectiveCompanyId)
            .map(b => b.id);
          if (companyBranchIds.length > 0) {
            filteredBatches = batches.filter((batch: any) =>
              companyBranchIds.includes(batch.branchId)
            );
            console.log(`📦 Filtered batches for All Branches: ${batches.length} -> ${filteredBatches.length} (company: ${effectiveCompanyId}, branches: ${companyBranchIds.length})`);
          } else {
            // If no branches found for company, use all batches (API already filtered by companyId)
            console.log(`📦 No branches found for company ${effectiveCompanyId}, using all batches from API: ${batches.length}`);
            filteredBatches = batches;
          }
        } else if (effectiveCompanyId) {
          // Company selected but branches not loaded yet - use all batches (API already filtered by companyId)
          console.log(`📦 Branches not loaded yet, using all batches from API: ${batches.length}`);
          filteredBatches = batches;
        }

        setAllBatches(filteredBatches);

        // Calculate batches overview
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let totalBatches = 0;
        let expiredBatchesCount = 0;
        let outOfStockBatchesCount = 0;
        let totalBusinessCost = 0;

        filteredBatches.forEach((batch: any) => {
          totalBatches++;
          
          // CRITICAL FIX: Calculate total cost using correct price fields
          // API returns: costPrice, stockPurchasePrice, totalStock
          // Try multiple quantity and price fields in order of preference
          const quantity = batch.quantity || batch.stockQuantity || batch.totalStock || 0;
          
          // Try multiple price fields - costPrice is the primary field from API
          const purchasePrice = batch.costPrice || 
                               batch.purchasePrice || 
                               batch.stockPurchasePrice || 
                               (batch.costPricePerUnit ? batch.costPricePerUnit * (batch.unitsPerBox || 1) : 0) ||
                               0;
          
          // Only add to total if we have valid quantity and price
          if (quantity > 0 && purchasePrice > 0) {
            const batchCost = purchasePrice * quantity;
            totalBusinessCost += batchCost;
            
            // Debug first few batches to verify calculation
            if (totalBatches <= 3) {
              console.log(`💰 Batch ${totalBatches} cost:`, {
                batchNo: batch.batchNo,
                quantity,
                purchasePrice,
                batchCost,
                availableFields: {
                  purchasePrice: batch.purchasePrice,
                  costPrice: batch.costPrice,
                  stockPurchasePrice: batch.stockPurchasePrice,
                  costPricePerUnit: batch.costPricePerUnit
                }
              });
            }
          }

              // Check if expired
          if (batch.expireDate) {
            const expireDate = new Date(batch.expireDate);
            if (expireDate < today) {
                expiredBatchesCount++;
            }
              }

              // Check if out of stock
              if (quantity <= 0) {
                outOfStockBatchesCount++;
              }

        });

        setBatchesOverview({
          total: totalBatches,
          expired: expiredBatchesCount,
          outOfStock: outOfStockBatchesCount
        });
        setTotalCost(totalBusinessCost);

        console.log('📦 Batches loaded:', {
          total: totalBatches,
          expired: expiredBatchesCount,
          outOfStock: outOfStockBatchesCount,
          totalCost: totalBusinessCost,
          sampleBatch: filteredBatches.length > 0 ? {
            quantity: filteredBatches[0].quantity,
            purchasePrice: filteredBatches[0].purchasePrice,
            costPrice: filteredBatches[0].costPrice,
            stockPurchasePrice: filteredBatches[0].stockPurchasePrice
          } : null
        });
      } else {
        console.warn('Failed to load batches data');
        setAllBatches([]);
        setBatchesOverview({ total: 0, expired: 0, outOfStock: 0 });
        setTotalCost(0); // CRITICAL: Reset total cost if batches fail to load
      }

      // Calculate most selling and slow selling products from sales data ONLY if backend didn't provide them
      const hasMostSelling = dashboardResponse.success && dashboardResponse.data && dashboardResponse.data.mostSellingProducts && dashboardResponse.data.mostSellingProducts.length > 0;
      
      if (!hasMostSelling && salesResponse.success && salesResponse.data) {
        // Get sales - already filtered by companyId/branchId via API headers
        let sales = salesResponse.data.sales || [];

        // If specific branch selected, ensure we only use that branch's sales
        if (effectiveBranchId) {
          sales = sales.filter((sale: any) => sale.branchId === effectiveBranchId);
        }

        console.log(`📊 Calculating most/slow selling products from ${sales.length} local sales (fallback)`);

        // Count product sales
        const productSalesCount: { [key: string]: { product: any, count: number, revenue: number } } = {};

        sales.forEach((sale: any) => {
          if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach((item: any) => {
              const productId = item.productId || item.product?.id;
              if (productId) {
                if (!productSalesCount[productId]) {
                  productSalesCount[productId] = {
                    product: item.product || { id: productId, name: item.productName || 'Unknown' },
                    count: 0,
                    revenue: 0
                  };
                }
                productSalesCount[productId].count += item.quantity || 1;
                productSalesCount[productId].revenue += (item.totalPrice || item.price || 0) * (item.quantity || 1);
              }
            });
          }
        });

        // Get most selling products (top 5 by count)
        const mostSelling = Object.values(productSalesCount)
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map(item => ({
            ...item.product,
            salesCount: item.count,
            revenue: item.revenue
          }));
        if (mostSelling.length > 0) setMostSellingProducts(mostSelling);

        // Get slow selling products (products with low or no sales)
        const slowSelling = Object.values(productSalesCount)
          .filter(item => item.count < 5)
          .sort((a, b) => a.count - b.count)
          .slice(0, 5)
          .map(item => ({
            ...item.product,
            salesCount: item.count,
            revenue: item.revenue
          }));
        if (slowSelling.length > 0) setSlowSellingProducts(slowSelling);
      }

      // Branches are now loaded by the AdminContext

      if (usersResponse.success && usersResponse.data) {
        let usersData = usersResponse.data.users || [];
        
        // CRITICAL FIX: Double-check branch filtering on frontend BEFORE role/company filtering
        // If specific branch is selected, ensure we only show that branch's data
        if (effectiveBranchId) {
          usersData = usersData.filter((user: any) => user.branchId === effectiveBranchId);
          console.log(`🔍 Pre-filtered users by branch ${effectiveBranchId}: ${usersResponse.data.users?.length || 0} -> ${usersData.length}`);
        } else if (effectiveCompanyId) {
          // All Branches selected - ensure users belong to selected company's branches
          const companyBranchIds = allBranches
            .filter(b => b.companyId === effectiveCompanyId)
            .map(b => b.id);
          if (companyBranchIds.length > 0) {
            usersData = usersData.filter((user: any) => companyBranchIds.includes(user.branchId));
            console.log(`🔍 Pre-filtered users by company ${effectiveCompanyId}: ${usersResponse.data.users?.length || 0} -> ${usersData.length} (branches: ${companyBranchIds.length})`);
          }
        }

        console.log('👥 Raw users from API:', usersData.length, usersData.map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          companyId: u.companyId,
          branchId: u.branchId
        })));

        // CRITICAL FIX: Filter users by company first, then by role
        let filteredUsers = usersData;

        // Step 1: Filter by company (if company is selected)
        if (effectiveCompanyId) {
          filteredUsers = filteredUsers.filter((user: any) => {
            // Check if user's companyId matches selected company
            // Also check if user's branch belongs to selected company
            const userCompanyId = user.companyId;
            const userBranch = allBranches.find((b: any) => b.id === user.branchId);
            const branchCompanyId = userBranch?.companyId;

            const matchesCompany = userCompanyId === effectiveCompanyId || branchCompanyId === effectiveCompanyId;

            // If userCompanyId is undefined, don't filter out - they might be a member through membership
            if (!userCompanyId && !branchCompanyId) {
              // User doesn't have explicit company association, include them
              return true;
            }

            if (!matchesCompany) {
              console.log('❌ User filtered out (wrong company):', {
                userId: user.id,
                userName: user.name,
                userCompanyId,
                branchCompanyId,
                effectiveCompanyId
              });
            }

            return matchesCompany;
          });
          console.log('👥 After company filter:', filteredUsers.length);
        } else if (currentUserData.companyId) {
          // If no company selected but user has companyId, filter by user's company
          filteredUsers = filteredUsers.filter((user: any) => {
            const userCompanyId = user.companyId;
            const userBranch = allBranches.find((b: any) => b.id === user.branchId);
            const branchCompanyId = userBranch?.companyId;

            return userCompanyId === currentUserData.companyId || branchCompanyId === currentUserData.companyId;
          });
          console.log('👥 After user company filter:', filteredUsers.length);
        }

        // Step 2: Filter by branch if selectedBranchId is set
        if (selectedBranchId) {
          filteredUsers = filteredUsers.filter((user: any) => {
            const matchesBranch = user.branchId === selectedBranchId;
            if (!matchesBranch) {
              console.log(`👥 User ${user.username} (${user.id}) filtered out by branch. User branch: ${user.branchId}, Selected branch: ${selectedBranchId}`);
            }
            return matchesBranch;
          });
          console.log('👥 After branch filter:', filteredUsers.length);
        }

        // Step 3: Filter by role
        if (currentUserRole === 'ADMIN') {
          // ADMIN can see users from all branches they manage
          // Show only MANAGER and CASHIER users (not ADMIN)
          filteredUsers = filteredUsers.filter((user: any) =>
            user.role === 'MANAGER' || user.role === 'CASHIER'
          );
        }

        console.log('👥 Final filtered users:', filteredUsers.length, filteredUsers.map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role
        })));

        setAllUsers(filteredUsers);

        // Update dashboard data with total users count
        setDashboardData(prev => ({
          ...prev,
          totalUsers: filteredUsers.length
        }));
      }

      // Companies are now handled by AdminContext
      
      // CRITICAL: Prepare data for caching with ACTUAL calculated values (not state values)
      // Capture all computed values AFTER all processing is complete
      const finalSalesData = salesResponse.success && salesResponse.data ? (salesResponse.data.sales || []) : [];
      const finalProductsData = filteredProductsForMetrics;
      const finalBatches = batchesResponse.success && batchesResponse.data ? (batchesResponse.data.batches || []) : [];
      const finalUsers = usersResponse.success && usersResponse.data ? (usersResponse.data.users || []) : [];
      
      // Get dashboard data from consolidated API
      const dashboardDataFromAPI = dashboardResponse.success && dashboardResponse.data ? (dashboardResponse.data as any) : null;
      
      // Calculate final values for cache
      const finalTodaySales = dashboardDataFromAPI?.today ? {
        count: dashboardDataFromAPI.today.transactions || 0,
        revenue: dashboardDataFromAPI.today.revenue || 0
      } : { count: 0, revenue: 0 };
      
      const finalTotalCost = dashboardDataFromAPI?.totalCost !== undefined ? dashboardDataFromAPI.totalCost : totalCost;
      const finalBatchesOverview = dashboardDataFromAPI?.batchesOverview || batchesOverview;
      const finalLowStockProducts = calculateLowStockProducts(finalProductsData);
      const finalMostSellingProducts = dashboardDataFromAPI?.mostSellingProducts || mostSellingProducts;
      const finalSlowSellingProducts = dashboardDataFromAPI?.slowSellingProducts || slowSellingProducts;
      const finalGrowthMetrics = {
        todayGrowth: dashboardDataFromAPI?.today?.growth || 0,
        monthGrowth: dashboardDataFromAPI?.month?.growth || 0,
        productsGrowth: growthMetrics.productsGrowth,
        branchesGrowth: growthMetrics.branchesGrowth,
        staffGrowth: growthMetrics.staffGrowth
      };
      
      const dataToCache = {
        realSalesData: finalSalesData,
        realProductsData: finalProductsData,
        allBatches: finalBatches,
        allUsers: finalUsers,
        realRevenue: apiRevenue,
        realTotalSales: apiTotalSales,
        todaySales: finalTodaySales,
        totalCost: finalTotalCost,
        batchesOverview: finalBatchesOverview,
        lowStockProducts: finalLowStockProducts,
        mostSellingProducts: finalMostSellingProducts,
        slowSellingProducts: finalSlowSellingProducts,
        growthMetrics: finalGrowthMetrics,
        dashboardData: {
          totalRevenue: apiRevenue,
          totalSales: apiTotalSales,
          totalUsers: finalUsers.length,
          recentSales: recentSalesFromAPI.slice(0, 10),
          lowStockProducts: finalLowStockProducts
        },
        topProducts: []
      };
      
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, selectedCompanyId, effectiveBranchId, effectiveCompanyId, allBranches, loadExpiryAlerts, hasInitialLoad, calculateLowStockProducts]);

  // CRITICAL FIX: Wait for AdminContext to initialize before loading data
  useEffect(() => {
    // Only load once on initial mount or when effective company context is ready
    if (!hasInitialLoad && effectiveCompanyId) {
      console.log('🔍 AdminContext initialized, loading fresh data...');
      setHasInitialLoad(true);
      loadDashboardData();
      loadExpiryAlerts();
    }
  }, [hasInitialLoad, effectiveCompanyId, effectiveBranchId, loadDashboardData, loadExpiryAlerts]);

  // CRITICAL FIX: Reload dashboard data when branch OR company changes (but not on initial load)
  // IMPORTANT: Always load FRESH data when branch changes to ensure correct filtering
  useEffect(() => {
    if (!hasInitialLoad) return; // Skip if initial load hasn't happened yet
    
    // Guard against redundant reloads for the same context
    const contextKey = `${selectedCompanyId || 'all'}_${selectedBranchId || 'all'}`;
    if (lastLoadedContextRef.current === contextKey) {
      return; // Already loaded for this context, skip
    }
    lastLoadedContextRef.current = contextKey;
    
    console.log('🔄 Branch/Company changed - Loading FRESH data:', { 
      selectedBranchId: selectedBranchId || 'all', 
      selectedCompanyId: selectedCompanyId || 'all' 
    });
    
    // CRITICAL: When branch changes, always load fresh data to ensure correct filtering
    // Don't rely on cache - branch-specific data must be loaded fresh
    setLoading(true);
    
    // Clear old data immediately to prevent showing wrong branch's data
    // This ensures UI doesn't show stale data from previous branch
    setRealSalesData([]);
    setRealProductsData([]);
    setAllBatches([]);
    setAllUsers([]);
    setRealRevenue(0);
    setRealTotalSales(0);
    setTodaySales({ count: 0, revenue: 0 });
    setTotalCost(0);
    setBatchesOverview({ total: 0, expired: 0, outOfStock: 0 });
    setLowStockProducts([]);
    setMostSellingProducts([]);
    setSlowSellingProducts([]);
    setGrowthMetrics({
      todayGrowth: 0,
      monthGrowth: 0,
      productsGrowth: 0,
      branchesGrowth: 0,
      staffGrowth: 0
    });
    setDashboardData(null);
    setTopProducts([]);
    
    // Load fresh data for the new branch/company
    // Use forceRefresh=true to ensure we get fresh data, not cached data from wrong branch
    const refreshTimeout = setTimeout(() => {
      loadDashboardData(true); // Force refresh to get correct branch data
      loadExpiryAlerts();
    }, 100); // Small delay to let UI clear first
    
    return () => clearTimeout(refreshTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, selectedCompanyId, hasInitialLoad]);

  // CRITICAL: Reload expiry alerts when batches are loaded, branch changes, or company changes
  useEffect(() => {
    if (allBatches.length > 0) {
      loadExpiryAlerts();
    }
  }, [allBatches, selectedBranchId, selectedCompanyId, loadExpiryAlerts]);

  // Event listener removed - useEffect on state changes handles reloads


  // CRITICAL FIX: Calculate totalCost immediately from batches when branch/company changes
  // This ensures Total Cost shows instantly when branch is selected
  const calculatedTotalCost = useMemo(() => {
    if (allBatches.length === 0) return 0;
    
    // Filter batches by branch if branch is selected
    let filteredBatches = allBatches;
    if (selectedBranchId) {
      // Specific branch selected - filter by branchId
      filteredBatches = allBatches.filter((batch: any) => batch.branchId === selectedBranchId);
      console.log(`💰 Total Cost: Filtering batches for branch ${selectedBranchId}: ${allBatches.length} -> ${filteredBatches.length}`);
    } else if (selectedCompanyId && allBranches.length > 0) {
      // "All Branches" selected - filter by company branches
      // Use allBranches directly (availableBranches is defined later, so use allBranches here)
      const companyBranchIds = allBranches
        .filter(b => b.companyId === selectedCompanyId)
        .map(b => b.id);
      if (companyBranchIds.length > 0) {
        filteredBatches = allBatches.filter((batch: any) =>
          companyBranchIds.includes(batch.branchId)
        );
        console.log(`💰 Total Cost: Filtering batches for company ${selectedCompanyId} (${companyBranchIds.length} branches): ${allBatches.length} -> ${filteredBatches.length}`);
      } else {
        // No branches found for company, use all batches (might be from API filtering)
        console.log(`💰 Total Cost: No branches found for company, using all batches: ${allBatches.length}`);
      }
    } else {
      // No company selected or branches not loaded yet, use all batches
      console.log(`💰 Total Cost: No company/branches, using all batches: ${allBatches.length}`);
    }
    
    // Calculate total cost from filtered batches
    let totalBusinessCost = 0;
    filteredBatches.forEach((batch: any) => {
      const quantity = batch.quantity || batch.stockQuantity || batch.totalStock || 0;
      const purchasePrice = batch.costPrice || 
                           batch.purchasePrice || 
                           batch.stockPurchasePrice || 
                           (batch.costPricePerUnit ? batch.costPricePerUnit * (batch.unitsPerBox || 1) : 0) ||
                           0;
      if (quantity > 0 && purchasePrice > 0) {
        totalBusinessCost += purchasePrice * quantity;
      }
    });
    
    console.log(`💰 Total Cost calculated: Rs ${totalBusinessCost} (from ${filteredBatches.length} batches)`);
    return totalBusinessCost;
  }, [allBatches, selectedBranchId, selectedCompanyId, allBranches]);

  // CRITICAL FIX: Update totalCost state immediately when calculatedTotalCost changes
  // But ONLY if we don't already have a valid totalCost from the backend dashboard API
  useEffect(() => {
    // If we have dashboardData from API, prefer its totalCost
    if (dashboardData?.totalCost !== undefined && dashboardData.totalCost > 0) {
      setTotalCost(dashboardData.totalCost);
      return;
    }
    
    // Otherwise fall back to calculated cost from batches
    if (calculatedTotalCost > 0 || allBatches.length === 0) {
      setTotalCost(calculatedTotalCost);
    }
  }, [calculatedTotalCost, allBatches.length, dashboardData?.totalCost]);

  // CRITICAL FIX: Filter data based on selected branch AND company
  // When no branch is selected but company is selected, data is already filtered by companyId via API
  const filteredData = useMemo(() => {
    // CRITICAL FIX: Always filter data by selected branch to ensure correct data display
    // This ensures that when branch changes, only that branch's data is shown
    
    if (!selectedBranchId) {
      // "All Branches" selected - show all data for selected company
      // If company is selected, filter by company's branches
      if (effectiveCompanyId && allBranches.length > 0) {
        const companyBranchIds = allBranches
          .filter(b => b.companyId === effectiveCompanyId)
          .map(b => b.id);
        
        // Filter sales, products, and users by company branches
        // Note: For "All Branches", we prioritize aggregated counts from dashboardData if available
        const filteredSales = (dashboardData?.recentSales && dashboardData.recentSales.length > 0)
          ? dashboardData.recentSales
          : realSalesData.filter(sale => companyBranchIds.includes(sale.branchId));
        
        const activeSales = realSalesData.filter(sale => 
          companyBranchIds.includes(sale.branchId) && sale.status !== 'REFUNDED'
        );
        
        const filteredProducts = realProductsData.filter(product => 
          companyBranchIds.includes(product.branchId)
        );
        const filteredUsers = allUsers.filter(user => 
          companyBranchIds.includes(user.branchId)
        );
        
        // CRITICAL FIX: Use backend-provided aggregated revenue/sales if available
        // Local calculation from realSalesData is limited by pagination (e.g., 50 items)
        const filteredRevenue = (dashboardData?.totalRevenue !== undefined && dashboardData.totalRevenue > 0)
          ? dashboardData.totalRevenue
          : activeSales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
          
        const filteredTotalSales = (dashboardData?.totalSales !== undefined && dashboardData.totalSales > 0)
          ? dashboardData.totalSales
          : activeSales.length;
        
        console.log(`🔍 Filtered data for "All Branches" (company: ${effectiveCompanyId}):`, {
          sales: filteredSales.length,
          products: filteredProducts.length,
          users: filteredUsers.length,
          revenue: filteredRevenue,
          totalSales: filteredTotalSales,
          companyBranches: companyBranchIds.length
        });
        
        return {
          sales: filteredSales,
          products: filteredProducts,
          users: filteredUsers,
          revenue: filteredRevenue,
          totalSales: filteredTotalSales
        };
      }
      
      // No company selected - show all data
      return {
        sales: (dashboardData?.recentSales && dashboardData.recentSales.length > 0) ? dashboardData.recentSales : realSalesData,
        products: realProductsData,
        users: allUsers,
        revenue: (dashboardData?.totalRevenue !== undefined) ? dashboardData.totalRevenue : realRevenue,
        totalSales: (dashboardData?.totalSales !== undefined) ? dashboardData.totalSales : realTotalSales
      };
    }

    // Specific branch selected: STRICTLY filter by branchId
    // CRITICAL: Double-check filtering to ensure no data from other branches leaks through
    const filteredSales = realSalesData.filter(sale => {
      const matches = sale.branchId === selectedBranchId;
      if (!matches && sale.branchId) {
        console.warn(`⚠️ Sale ${sale.id} filtered out - branch mismatch: ${sale.branchId} !== ${selectedBranchId}`);
      }
      return matches;
    });
    const activeSales = filteredSales.filter(sale => sale.status !== 'REFUNDED');
    const filteredProducts = realProductsData.filter(product => {
      const matches = product.branchId === selectedBranchId;
      if (!matches && product.branchId) {
        console.warn(`⚠️ Product ${product.id} filtered out - branch mismatch: ${product.branchId} !== ${selectedBranchId}`);
      }
      return matches;
    });
    const filteredUsers = allUsers.filter(user => {
      const matches = user.branchId === selectedBranchId;
      if (!matches && user.branchId) {
        console.warn(`⚠️ User ${user.id} filtered out - branch mismatch: ${user.branchId} !== ${selectedBranchId}`);
      }
      return matches;
    });
    const filteredRevenue = activeSales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
    const filteredTotalSales = activeSales.length;

    console.log(`🔍 Filtered data for branch ${selectedBranchId}:`, {
      sales: filteredSales.length,
      products: filteredProducts.length,
      users: filteredUsers.length,
      revenue: filteredRevenue,
      totalSales: filteredTotalSales,
      originalSalesCount: realSalesData.length,
      originalProductsCount: realProductsData.length,
      originalUsersCount: allUsers.length
    });

    return {
      sales: filteredSales,
      products: filteredProducts,
      users: filteredUsers,
      revenue: filteredRevenue,
      totalSales: filteredTotalSales
    };
  }, [selectedBranchId, selectedCompanyId, realSalesData, realProductsData, allUsers, realRevenue, realTotalSales, allBranches]);

  // CRITICAL: Get branches from AdminContext OR localStorage cache (for immediate display on refresh)
  const availableBranches = useMemo(() => {
    // Only use branches from AdminContext - no localStorage cache
    if (allBranches && allBranches.length > 0) {
      return allBranches;
    }
    return [];
  }, [allBranches]);

  // Filter branches based on selected company
  const filteredBranches = useMemo(() => {
    if (!effectiveCompanyId) {
      return availableBranches;
    }
    return availableBranches.filter(branch => branch.companyId === effectiveCompanyId);
  }, [effectiveCompanyId, availableBranches]);

  // selectedBranch is now provided by AdminContext

  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }, []);


  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, []);

  const getTimeAgo = useCallback((dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays} days ago`;
    const diffInWeeks = Math.floor(diffInDays / 7);
    return `${diffInWeeks} weeks ago`;
  }, []);

  const handleBranchClick = useCallback(async (branch: any) => {
    // Prevent multiple calls if already loading
    if (loading) return;

    // Validate branch has an ID
    if (!branch || !branch.id) {
      console.error('Invalid branch data:', branch);
      setError('Invalid branch data');
      return;
    }

    try {
      setSelectedBranch(branch);
      setLoading(true);

      // Load branch-specific data
      // Type assertion needed because TypeScript has trouble inferring large class types
      const api = apiService as any;
      const [dashboardResponse, lowStockResponse, customersResponse] = await Promise.all([
        api.getDashboardStats(branch.id),
        api.getProducts({ branchId: branch.id, lowStock: true, limit: 50 }),
        api.getCustomers({ branchId: branch.id, limit: 10 })
      ]);

      if (dashboardResponse.success && dashboardResponse.data) {
        setBranchDetails({
          ...dashboardResponse.data,
          lowStockProducts: lowStockResponse.success ? lowStockResponse.data.products : [],
          recentCustomers: customersResponse.success ? customersResponse.data.customers : [],
          branchInfo: branch
        });
        setShowBranchDetails(true);
      }
    } catch (err) {
      console.error('Error loading branch details:', err);
      setError('Failed to load branch details');
      // Don't show branch details if there's an error
      setShowBranchDetails(false);
    } finally {
      setLoading(false);
    }
  }, [loading]); // Only depends on loading state

  // Calculate medical and non-medical products
  const productCounts = useMemo(() => {
    const products = filteredData.products || [];
    const medical = products.filter((p: any) =>
      p.category?.type === 'MEDICAL' || p.category?.type === 'medical'
    ).length;
    const nonMedical = products.filter((p: any) =>
      p.category?.type === 'NON_MEDICAL' || p.category?.type === 'NON-MEDICAL' ||
      (p.category?.type !== 'MEDICAL' && p.category?.type !== 'medical')
    ).length;
    
    // Use backend-provided total if available and in company-wide view
    const totalCount = (!selectedBranchId && dashboardData?.totalProducts !== undefined)
      ? dashboardData.totalProducts
      : products.length;

    return { medical, nonMedical, total: totalCount };
  }, [filteredData.products, dashboardData?.totalProducts, selectedBranchId, selectedCompanyId]);

  // All hooks must be called before any conditional returns
  const adminStats = useMemo(() => [
    {
      title: "Today Sales",
      value: todaySales.count.toString(),
      revenue: formatCurrency(todaySales.revenue || 0),
      change: selectedBranchId ? "Branch Data" : "All Data",
      icon: ShoppingCart,
      trend: growthMetrics.todayGrowth >= 0 ? "up" : "down",
      trendValue: `${growthMetrics.todayGrowth >= 0 ? '+' : ''}${growthMetrics.todayGrowth.toFixed(1)}%`,
      description: "sales comparison",
      type: "today-sales",
      clickable: true,
      navigateTo: "/invoices",
      requiredModule: "sales"
    },
    {
      title: selectedBranchId ? `${globalSelectedBranch?.name} Refunds` : "Total Refunds",
      value: (() => {
        const refunds = realSalesData.filter((sale: any) => sale.status === 'REFUNDED');
        if (selectedBranchId) {
          return refunds.filter((sale: any) => sale.branchId === selectedBranchId).length.toString();
        }
        // For all branches, filter by company if selected
        if (selectedCompanyId && allBranches.length > 0) {
          const companyBranchIds = allBranches
            .filter(b => b.companyId === selectedCompanyId)
            .map(b => b.id);
          return refunds.filter((sale: any) => companyBranchIds.includes(sale.branchId)).length.toString();
        }
        return refunds.length.toString();
      })(),
      refundedAmount: (() => {
        const refunds = realSalesData.filter((sale: any) => sale.status === 'REFUNDED');
        let filteredRefunds = refunds;
        if (selectedBranchId) {
          filteredRefunds = refunds.filter((sale: any) => sale.branchId === selectedBranchId);
        }
        // For all branches, filter by company if selected
        if (selectedCompanyId && allBranches.length > 0) {
          const companyBranchIds = allBranches
            .filter(b => b.companyId === selectedCompanyId)
            .map(b => b.id);
          filteredRefunds = refunds.filter((sale: any) => companyBranchIds.includes(sale.branchId));
        }
        const totalRefunded = filteredRefunds.reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0);
        return formatCurrency(totalRefunded);
      })(),
      change: selectedBranchId ? "Branch Data" : "All Data",
      icon: Package,
      trend: "neutral",
      trendValue: "N/A",
      description: "Refunded transactions",
      type: "refunds",
      clickable: true,
      navigateTo: "/reports",
      requiredModule: "reports"
    }
  ], [filteredData.products, filteredData.users.length, allBranches, allUsers, currentUser?.role, selectedBranchId, selectedCompanyId, globalSelectedBranch?.name, formatCurrency, todaySales, realSalesData, growthMetrics, dashboardData?.totalProducts]);

  const visibleStats = useMemo(() => {
    // Note: We intentionally show ALL stats regardless of module access
    // Module access is checked on click with toast notification
    return adminStats;
  }, [adminStats]);

  // Memoize date/time formatting to prevent unnecessary re-renders
  const formattedDateTime = useMemo(() => ({
    date: currentDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    time: currentDateTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }), [currentDateTime]);

  // Memoize event handlers to prevent re-renders
  const handleShowAllRecentSales = useCallback(() => {
    setShowAllRecentSales(!showAllRecentSales);
  }, [showAllRecentSales]);

  const handleShowAllLowStock = useCallback(() => {
    setShowAllLowStock(!showAllLowStock);
  }, [showAllLowStock]);

  const handleShowAllBranches = useCallback(() => {
    setShowAllBranches(!showAllBranches);
  }, [showAllBranches]);

  const handleShowAllUsers = useCallback(() => {
    setShowAllUsers(!showAllUsers);
  }, [showAllUsers]);

  const handleCloseBranchDetails = useCallback(() => {
    setShowBranchDetails(false);
  }, []);

  const businessContextPath = useCallback(
    (path: string) => withBusinessSlug(displayCompany?.slug || businessSlugFromUrl || null, path),
    [displayCompany?.slug, businessSlugFromUrl],
  );

  const handleGoToBranches = useCallback(() => {
    if (!hasModule('branches')) {
      toast.error('Branch Management Not Available', {
        description: 'This feature is not included in your current plan. Upgrade to unlock it.',
        action: {
          label: 'Upgrade',
          onClick: () => navigate(subscriptionPath),
        },
        duration: 6000,
      });
      return;
    }
    navigate(businessContextPath('/branches'));
  }, [navigate, hasModule, businessContextPath, subscriptionPath]);

  const handleGoToUsers = useCallback(() => {
    if (!hasModule('staff')) {
      toast.error('Staff Management Not Available', {
        description: 'This feature is not included in your current plan. Upgrade to unlock it.',
        action: {
          label: 'Upgrade',
          onClick: () => navigate(subscriptionPath),
        },
        duration: 6000,
      });
      return;
    }
    navigate(businessContextPath('/staff'));
  }, [navigate, hasModule, businessContextPath, subscriptionPath]);

  const handleGoToInvoices = useCallback(() => {
    if (!hasModule('sales')) {
      toast.error('Sales & POS Not Available', {
        description: 'This feature is not included in your current plan. Upgrade to unlock it.',
        action: {
          label: 'Upgrade',
          onClick: () => navigate(subscriptionPath),
        },
        duration: 6000,
      });
      return;
    }
    navigate(businessContextPath('/invoices'));
  }, [navigate, hasModule, businessContextPath, subscriptionPath]);

  const handleGoToInventory = useCallback(() => {
    if (!hasModule('inventory')) {
      toast.error('Inventory Management Not Available', {
        description: 'This feature is not included in your current plan. Upgrade to unlock it.',
        action: {
          label: 'Upgrade',
          onClick: () => navigate(subscriptionPath),
        },
        duration: 6000,
      });
      return;
    }
    navigate(businessContextPath('/products'));
  }, [navigate, hasModule, businessContextPath, subscriptionPath]);

  const handleStatCardClick = useCallback((stat: any) => {
    // Check if stat has module requirement and if module is enabled
    if (stat.requiredModule && !hasModule(stat.requiredModule)) {
      console.log('🚫 Module check failed:', {
        requiredModule: stat.requiredModule,
        hasModule: hasModule(stat.requiredModule),
        stat: stat
      });
      // Module not enabled - show upgrade toast with action
      const moduleNames: Record<string, string> = {
        inventory: 'Inventory Management',
        sales: 'Sales & POS',
        customers: 'Customer Management',
        purchases: 'Purchase Management',
        staff: 'Staff Management',
        branches: 'Branch Management',
        reports: 'Reports & Analytics',
        dashboard: 'Dashboard',
        business_management: 'Business Management',
        subscription: 'Subscription & Billing',
        expenses: 'Expenses',
        analytics: 'Analytics',
      };

      toast.error(`${moduleNames[stat.requiredModule] || stat.requiredModule} Not Available`, {
        description: 'This feature is not included in your current plan. Upgrade to unlock it.',
        action: {
          label: 'Upgrade',
          onClick: () => navigate(subscriptionPath),
        },
        duration: 6000,
      });
      return;
    }

    console.log('✅ Module check passed:', {
      requiredModule: stat.requiredModule,
      hasModule: stat.requiredModule ? hasModule(stat.requiredModule) : 'N/A',
      stat: stat
    });

    if (stat.clickable && stat.navigateTo) {
      const targetPath = String(stat.navigateTo);
      const resolvedPath = targetPath.startsWith('/business/')
        ? targetPath
        : businessContextPath(targetPath);
      navigate(resolvedPath);
    }
  }, [navigate, hasModule, businessContextPath]);

  const handleBranchSelect = useCallback((branchId: string | null) => {
    setSelectedBranchId(branchId);
    setIsBranchDropdownOpen(false);
  }, [setSelectedBranchId]);

  const handleCompanySelect = useCallback((companyId: string | null) => {
    // Use AdminContext methods for persistence
    setSelectedCompanyId(companyId);
    setSelectedBranchId(null); // Reset branch selection when company changes

    // Find the selected company
    const selectedCompany = companyId ? allCompanies.find(c => c.id === companyId) : null;
    setGlobalSelectedCompany(selectedCompany);
  }, [allCompanies, setSelectedCompanyId, setSelectedBranchId]);

  const handleToggleBranchSummary = useCallback(() => {
    setIsBranchSummaryCollapsed(!isBranchSummaryCollapsed);
  }, [isBranchSummaryCollapsed]);

  // Guard: Show loading if no company context
  if (!effectiveCompanyId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Loading company data...</p>
          <p className="text-sm text-muted-foreground mt-2">Please wait or select a company</p>
        </div>
      </div>
    );
  }

  // Don't block UI with loading screen - show content with loading indicator if needed
  // Only show full loading screen on initial load if no data exists
  if (loading && !hasInitialLoad) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f7] px-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-[#1a52c5] border-t-transparent" />
          <p className="text-sm text-[#8c95b0]">Loading dashboard data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f7] px-6">
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-600" />
          <p className="mb-4 text-red-600">{error}</p>
          <Button
            onClick={() => loadDashboardData(true)}
            className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full bg-[#f0f2f7]">
      <div
        className="pointer-events-none fixed right-[-100px] top-[-100px] z-0 h-[500px] w-[500px] rounded-full blur-[100px]"
        style={{ background: "rgba(40,194,206,0.06)" }}
      />
      <div
        className="pointer-events-none fixed bottom-[100px] left-[350px] z-0 h-[400px] w-[400px] rounded-full blur-[100px]"
        style={{ background: "rgba(26,82,197,0.04)" }}
      />

      <div className="relative z-[1] space-y-6 px-6 pb-14 pt-9 md:px-11">
        <div className="zv3-animate-fadeUp flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0a1128]">
              {displayCompany
                ? `${displayCompany.name} Dashboard`
                : selectedBranchId
                  ? `${globalSelectedBranch?.name} Dashboard`
                  : currentUser?.role === "ADMIN"
                    ? "Admin Dashboard"
                    : "Dashboard"}
            </h1>
            <p className="mt-1 text-sm text-[#8c95b0]">
              {selectedBranchId
                ? `Overview of ${globalSelectedBranch?.name} branch operations`
                : displayCompany
                  ? `Overview of ${displayCompany.name}'s branches, revenue, staff, and products`
                  : currentUser?.role === "ADMIN"
                    ? "Overview of all your branches, revenue, staff, and products"
                    : "Complete overview of all business operations"}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[13px] font-medium text-[#8c95b0]">{formattedDateTime.date}</p>
            <p className="mt-0.5 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] bg-clip-text text-[20px] font-extrabold tracking-tight text-transparent">
              {formattedDateTime.time}
            </p>
          </div>
        </div>

        <div className="zv3-settings-block grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visibleStats.map((stat, index) => (
            <div
              key={index}
              role={stat.clickable ? "button" : undefined}
              tabIndex={stat.clickable ? 0 : undefined}
              className={cn(
                "border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.02)] transition-all duration-300",
                stat.clickable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(0,0,0,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a52c5]/30",
                !stat.clickable && "cursor-default"
              )}
              onClick={() => handleStatCardClick(stat)}
              onKeyDown={(e) => {
                if (!stat.clickable) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleStatCardClick(stat);
                }
              }}
            >
              <div className="min-w-0">
                <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">{stat.title}</p>
                {stat.type === "today-sales" && stat.revenue ? (
                  <>
                    <p className="mb-1 break-words text-[16px] font-extrabold leading-none tracking-tight text-[#0a1128]">
                      {stat.value}
                    </p>
                    <p className="mb-2 break-words text-[24px] font-extrabold leading-none tracking-tight text-[#0a1128]">{stat.revenue}</p>
                  </>
                ) : stat.type === "refunds" && stat.refundedAmount ? (
                  <>
                    <p className="mb-1 break-words text-[16px] font-extrabold leading-none tracking-tight text-[#0a1128]">
                      {stat.value}
                    </p>
                    <p className="mb-2 break-words text-[24px] font-extrabold leading-none tracking-tight text-[#0a1128]">{stat.refundedAmount}</p>
                  </>
                ) : (
                  <p className="mb-2 break-words text-[28px] font-extrabold leading-none tracking-tight text-[#0a1128]">
                    {stat.value}
                  </p>
                )}
                {stat.type !== "refunds" && stat.type !== "today-sales" ? (
                  <div className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-black/[0.03] px-2.5 py-1 text-xs font-semibold text-[#8c95b0]">
                    <TrendingUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                    <span>
                      {stat.trendValue} {stat.description}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

      <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between px-7 pt-4 pb-0">
            <div className="flex items-center gap-2.5 text-base font-bold tracking-tight text-[#0a1128]">
              <ShoppingCart className="h-[19px] w-[19px] shrink-0 text-[#1a52c5]" strokeWidth={2} />
              Recent Sales
            </div>
            {filteredData.sales.length > 5 && (
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border-[#1a52c5]/20 font-semibold text-[#1a52c5] h-9 px-3 text-xs hover:bg-[#1a52c5]/10"
                onClick={() => window.location.href = "http://127.0.0.1:50862/business/gohar-pharma/invoices"}
              >
                View All Sales ({filteredData.sales.length})
              </Button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto px-7 pt-4 pb-8">
            {(filteredData.sales?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {filteredData.sales.slice(0, 5).map((sale: any, index: number) => (
                  <div
                    key={index}
                    className="rounded-[8px] border border-green-600/15 bg-green-600/[0.06] p-2.5 transition-colors hover:bg-green-600/[0.08]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#0a1128]">
                        {sale.invoiceNumber || `INV-${sale.id.slice(0, 8)}`}
                      </p>
                      <Badge variant="outline" className="shrink-0 border-[rgba(15,23,60,0.08)] text-xs font-semibold">
                        {formatCurrency(sale.totalAmount)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <div className="mb-3.5 grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-[#1a52c5]/10">
                  <ShoppingCart className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
                </div>
                <h4 className="mb-1 text-sm font-bold text-[#0a1128]">No recent sales found</h4>
                <p className="max-w-[280px] text-[13px] text-[#8c95b0]">
                  {selectedBranchId
                    ? `No recent sales for ${globalSelectedBranch?.name}. Sales will appear here.`
                    : "Sales transactions will appear here."}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between px-7 pt-4 pb-0">
            <div className="flex items-center gap-2.5 text-base font-bold tracking-tight text-[#0a1128]">
              <AlertTriangle className="h-[19px] w-[19px] shrink-0 text-amber-600" strokeWidth={2} />
              Low Stock Alert
            </div>
            {lowStockProducts.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border-[#1a52c5]/20 font-semibold text-[#1a52c5] h-9 px-3 text-xs hover:bg-[#1a52c5]/10"
                onClick={() => {
                  if (!hasModule('inventory')) {
                    toast.error('Inventory Management Not Available', {
                      description: 'This feature is not included in your current plan. Upgrade to unlock it.',
                      action: { label: 'Upgrade', onClick: () => navigate(subscriptionPath) },
                      duration: 6000,
                    });
                    return;
                  }
                  navigate("/inventory");
                }}
              >
                View All ({lowStockProducts.length})
              </Button>
            )}
          </div>
          <div className="px-7 pt-4 pb-8">
            {lowStockProducts.length > 0 ? (
              <div className="max-h-[420px] space-y-2 overflow-y-auto">
                {lowStockProducts.slice(0, 5).map((product: any, index: number) => {
                  const quantity = product.stock || product.totalStock || 0;
                  const minStock = product.minStock || product.minStockLevel || 0;
                  return (
                    <div
                      key={product.id || index}
                      className="rounded-[8px] border border-amber-500/20 bg-amber-500/[0.06] p-2.5 transition-colors hover:bg-amber-500/[0.08]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#0a1128]">{product.name || "Unknown Product"}</p>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/25 bg-amber-500/10 text-xs font-semibold text-amber-800"
                        >
                          {quantity} units
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center px-5 py-8 text-center">
                <div className="mb-3.5 grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-green-600/10">
                  <CheckCircle className="h-6 w-6 text-green-600" strokeWidth={2} />
                </div>
                <h4 className="mb-1 text-sm font-bold text-green-600">
                  {selectedBranchId
                    ? `All products in ${globalSelectedBranch?.name} are well stocked!`
                    : "All products are well stocked!"}
                </h4>
                <p className="text-[13px] text-[#8c95b0]">
                  {selectedBranchId ? "No low stock products for this branch." : "No low stock product alerts at this time."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <div className="overflow-hidden border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between px-7 pt-4 pb-0">
            <div className="flex items-center gap-2.5 text-base font-bold tracking-tight text-[#0a1128]">
              <TrendingUp className="h-[19px] w-[19px] shrink-0 text-[#1a52c5]" strokeWidth={2} />
              Most Selling Products
            </div>
            {mostSellingProducts.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border-[#1a52c5]/20 font-semibold text-[#1a52c5] h-9 px-3 text-xs hover:bg-[#1a52c5]/10"
                onClick={() => {
                  if (!hasModule('inventory')) {
                    toast.error('Inventory Management Not Available', {
                      description: 'This feature is not included in your current plan. Upgrade to unlock it.',
                      action: { label: 'Upgrade', onClick: () => navigate(subscriptionPath) },
                      duration: 6000,
                    });
                    return;
                  }
                  navigate("/inventory");
                }}
              >
                View All ({mostSellingProducts.length})
              </Button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto px-7 pt-4 pb-8">
            {mostSellingProducts.length > 0 ? (
              <div className="space-y-2">
                {mostSellingProducts.slice(0, 5).map((product: any, index: number) => (
                  <div
                    key={index}
                    className="rounded-[8px] border border-green-600/15 bg-green-600/[0.06] p-2.5 transition-colors hover:bg-green-600/[0.08]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#0a1128]">{product.name || "Unknown Product"}</p>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-green-600/20 bg-green-600/10 text-xs font-semibold text-green-800"
                      >
                        {product.salesCount} sold
                      </Badge>
                    </div>
                    <p className="text-xs text-[#8c95b0]">Revenue: {formatCurrency(product.revenue || 0)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-[#1a52c5]/10">
                  <BarChart3 className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
                </div>
                <p className="text-[13px] text-[#8c95b0]">No sales data available</p>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between px-7 pt-4 pb-0">
            <div className="flex items-center gap-2.5 text-base font-bold tracking-tight text-[#0a1128]">
              <TrendingUp className="h-[19px] w-[19px] shrink-0 rotate-180 text-[#1a52c5]" strokeWidth={2} />
              Slow Selling Products
            </div>
            {slowSellingProducts.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border-[#1a52c5]/20 font-semibold text-[#1a52c5] h-9 px-3 text-xs hover:bg-[#1a52c5]/10"
                onClick={() => {
                  if (!hasModule('inventory')) {
                    toast.error('Inventory Management Not Available', {
                      description: 'This feature is not included in your current plan. Upgrade to unlock it.',
                      action: { label: 'Upgrade', onClick: () => navigate(subscriptionPath) },
                      duration: 6000,
                    });
                    return;
                  }
                  navigate("/inventory");
                }}
              >
                View All ({slowSellingProducts.length})
              </Button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto px-7 pt-4 pb-8">
            {slowSellingProducts.length > 0 ? (
              <div className="space-y-2">
                {slowSellingProducts.slice(0, 5).map((product: any, index: number) => (
                  <div
                    key={index}
                    className="rounded-[8px] border border-amber-500/20 bg-amber-500/[0.06] p-2.5 transition-colors hover:bg-amber-500/[0.08]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#0a1128]">{product.name || "Unknown Product"}</p>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-500/25 bg-amber-500/10 text-xs font-semibold text-amber-900"
                      >
                        {product.salesCount} sold
                      </Badge>
                    </div>
                    <p className="text-xs text-[#8c95b0]">Revenue: {formatCurrency(product.revenue || 0)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-green-600/10">
                  <CheckCircle className="h-6 w-6 text-green-600" strokeWidth={2} />
                </div>
                <p className="text-[13px] text-[#8c95b0]">All products are selling well</p>
              </div>
            )}
          </div>
        </div>
      </div>







      {/* Expired Batches Widget - Tabular Format - Only Show When Expired Batches Exist */}
      {expiredBatches.length > 0 && (
        <Card className="mt-0 overflow-hidden border border-red-200/90 bg-gradient-to-br from-red-50 to-rose-50/80 shadow-[0_8px_40px_rgba(220,38,38,0.08)]">
          <CardHeader className="border-b border-red-200/60">
            <CardTitle className="flex items-center justify-between text-red-800">
              <div className="flex items-center gap-2">
                <X className="w-5 h-5" />
                Expired Batches ({expiredBatches.length})
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllExpiryAlerts(!showAllExpiryAlerts)}
                className="text-sm"
              >
                {showAllExpiryAlerts ? 'Show Less' : 'Show All'}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-red-300 bg-red-100">
                    <th className="text-left py-3 px-4 font-semibold text-red-800 text-sm">Product</th>
                    <th className="text-left py-3 px-4 font-semibold text-red-800 text-sm">Batch No</th>
                    <th className="text-left py-3 px-4 font-semibold text-red-800 text-sm">Branch</th>
                    <th className="text-left py-3 px-4 font-semibold text-red-800 text-sm">Expiry Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-red-800 text-sm">Days Expired</th>
                    <th className="text-right py-3 px-4 font-semibold text-red-800 text-sm">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllExpiryAlerts ? expiredBatches : expiredBatches.slice(0, 5)).map((batch: any, index: number) => {
                    const daysExpired = Math.ceil((new Date().getTime() - new Date(batch.expireDate).getTime()) / (1000 * 60 * 60 * 24));
                    // CRITICAL FIX: Get branch name from allBranches array using batch.branchId
                    let branchName = 'N/A';
                    if (batch.branchId && allBranches.length > 0) {
                      const branch = allBranches.find((b: any) => b.id === batch.branchId);
                      branchName = branch?.name || 'N/A';
                    } else if (batch.branch?.name) {
                      branchName = batch.branch.name;
                    } else if (batch.product?.branch?.name) {
                      branchName = batch.product.branch.name;
                    }
                    return (
                      <tr key={index} className="border-b border-red-200 hover:bg-red-50">
                        <td className="py-3 px-4 text-red-800 font-medium">
                          {batch.product?.name || 'Unknown Product'}
                        </td>
                        <td className="py-3 px-4 text-red-700 text-sm">
                          {batch.batchNo || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-red-700 text-sm">
                          {branchName}
                        </td>
                        <td className="py-3 px-4 text-red-600 text-sm">
                          {batch.expireDate ? new Date(batch.expireDate).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-red-800 font-medium text-sm">
                          {daysExpired} days
                        </td>
                        <td className="py-3 px-4 text-red-700 text-sm text-right font-medium">
                          {batch.quantity || 0}
                        </td>
                      </tr>
                    );
                  })}
                  {expiredBatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center text-red-600 text-sm">
                        No expired batches found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {expiredBatches.length > 5 && !showAllExpiryAlerts && (
                <p className="text-sm text-red-600 text-center mt-4">
                  +{expiredBatches.length - 5} more expired batches
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Branch Details Modal */}
      {showBranchDetails && branchDetails && typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-white shadow-xl">
              <div className="border-b border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">
                      {branchDetails.branchInfo?.name} Dashboard
                    </h2>
                    <p className="text-muted-foreground">Branch-specific overview and analytics</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleCloseBranchDetails}
                    className="text-gray-500 hover:text-gray-700"
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-6 p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <Card className="shadow-soft border-0">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                        <p className="text-xl font-bold text-foreground">
                          {formatCurrency(branchDetails.totalStats?.revenue || 0)}
                        </p>
                      </div>
                      <DollarSign className="h-8 w-8 text-[#0C2C8A]" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-soft border-0">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Sales</p>
                        <p className="text-xl font-bold text-foreground">
                          {(branchDetails.totalStats?.sales || 0).toLocaleString()}
                        </p>
                      </div>
                      <ShoppingCart className="h-8 w-8 text-accent" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-soft border-0">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Products</p>
                        <p className="text-xl font-bold text-foreground">
                          {(branchDetails.inventory?.totalProducts || 0).toLocaleString()}
                        </p>
                      </div>
                      <Package className="h-8 w-8 text-success" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-soft border-0">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Customers</p>
                        <p className="text-xl font-bold text-foreground">
                          {(branchDetails.customers?.total || 0).toLocaleString()}
                        </p>
                      </div>
                      <Users className="h-8 w-8 text-warning" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="shadow-soft border-0">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <ShoppingCart className="h-5 w-5 text-[#0C2C8A]" />
                      <span>Recent Sales</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(branchDetails.recentSales?.length ?? 0) > 0 ? (
                        branchDetails.recentSales.map((sale: any, index: number) => (
                          <div key={index} className="rounded-lg bg-muted/30 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-sm font-medium text-foreground">
                                {sale.customer?.name || "Walk-in Customer"}
                              </p>
                              <Badge variant="outline" className="text-xs">
                                {formatCurrency(sale.totalAmount)}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <p>Cashier: {sale.user?.name}</p>
                              <p>Time: {formatDate(sale.createdAt)}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="py-4 text-center text-muted-foreground">No recent sales found</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-soft border-0">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Users className="h-5 w-5 text-[#0C2C8A]" />
                      <span>Recent Customers</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(branchDetails.recentCustomers?.length ?? 0) > 0 ? (
                        branchDetails.recentCustomers.map((customer: any, index: number) => (
                          <div key={index} className="rounded-lg bg-muted/30 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-sm font-medium text-foreground">{customer.name}</p>
                              <Badge variant="outline" className="text-xs">
                                {formatCurrency(customer.totalPurchases || 0)}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <p>Phone: {customer.phone}</p>
                              <p>Points: {customer.loyaltyPoints || 0}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="py-4 text-center text-muted-foreground">No customers found</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="shadow-soft border-0">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                    <span>Low Stock Alert - {branchDetails.branchInfo?.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(branchDetails.lowStockProducts?.length ?? 0) > 0 ? (
                      branchDetails.lowStockProducts.map((product: any, index: number) => (
                        <div
                          key={index}
                          className="rounded-lg border border-warning/20 bg-warning/10 p-3"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">{product.name}</p>
                            <Badge
                              variant="outline"
                              className="border-warning/30 bg-warning/20 text-xs text-warning"
                            >
                              {product.stock} {product.unitType}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <p>
                              Min Stock: {product.minStock} {product.unitType}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                          <CheckCircle className="h-8 w-8 text-success" />
                        </div>
                        <p className="text-lg font-medium text-success">All products are well stocked!</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          No low stock alerts for this branch
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              </div>
            </div>
          </div>,

          document.body,
        )}
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(BusinessDashboard);

