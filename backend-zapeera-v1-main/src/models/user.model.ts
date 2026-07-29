// Enums removed - using string types for SQLite compatibility
export type UserRole = 'ADMIN' | 'OWNER' | 'MANAGER' | 'CASHIER';
export type ZapeeraAccountRole = 'USER'; // Registered account with no business yet

export interface CreateUserData {
  username: string;
  email: string;
  password: string;
  name: string;
  role: UserRole | string;
  branchId: string;
}

export interface UpdateUserData {
  username?: string;
  email?: string;
  password?: string;
  name?: string;
  role?: UserRole | string;
  branchId?: string;
  isActive?: boolean;
  businessAccessGranted?: boolean;
}

export interface LoginData {
  usernameOrEmail: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    username: string;
    name: string;
    role: string;
    branch: {
      id: string;
      name: string;
    };
  };
  token: string;
}
