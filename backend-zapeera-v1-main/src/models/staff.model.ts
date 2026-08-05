export interface CreateStaffData {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  position: string;
  department?: string;
  salary?: number;
  hireDate: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ON_LEAVE';
  branchId: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

export interface UpdateStaffData {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  position?: string;
  department?: string;
  salary?: number;
  hireDate?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ON_LEAVE';
  branchId?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  isActive?: boolean;
}
