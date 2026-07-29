import { createContext } from "react";

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  // Some endpoints return branches without isActive in the shape
  isActive?: boolean;
  companyId?: string;
}

export interface Company {
  id: string;
  name: string;
  /** URL-safe unique segment for /business/:slug/... routes */
  slug?: string | null;
  description?: string;
  address?: string;
  phone?: string;
  email?: string;
  businessType?: string;
  createdBy?: string;
  accessType?: 'owned' | 'shared';
  memberRole?: 'MANAGER' | 'CASHIER';
  memberBranchId?: string;
  isActive: boolean;
  branches?: Branch[];
}

export interface AdminContextType {
  selectedCompanyId: string | null;
  setSelectedCompanyId: (companyId: string | null) => void;
  selectedBusinessId: string | null;
  setSelectedBusinessId: (businessId: string | null) => void;
  selectedBranchId: string | null;
  setSelectedBranchId: (branchId: string | null) => void;
  effectiveCompanyId: string | null;
  effectiveBusinessId: string | null;
  effectiveBranchId: string | null;
  allCompanies: Company[];
  allBusinesses: Company[];
  ownedCompanies: Company[];
  ownedBusinesses: Company[];
  sharedCompanies: Company[];
  sharedBusinesses: Company[];
  allBranches: Branch[];
  selectedCompany: Company | null;
  selectedBusiness: Company | null;
  selectedBranch: Branch | null;
  isLoading: boolean;
  error: string | null;
  refreshCompanies: () => Promise<void>;
  refreshBusinesses: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  getMembershipRole: () => string | null;
}

export const AdminContext = createContext<AdminContextType | undefined>(undefined);
