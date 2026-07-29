import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiService } from "@/services/api";
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  Search,
  Plus,
  Edit,
  Trash2,
  Eye,
  Mail,
  Phone,
  Calendar,
  Shield,
  Crown,
  UserCheck
} from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'ADMIN';
  lastActive: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

interface AdminUserManagementProps {
  adminId: string;
  adminName: string;
  branchId: string;
}

interface Company {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  isActive: boolean;
  adminId?: string;
  createdBy?: string;
  createdAt: string;
}

const AdminUserManagement = ({ adminId, adminName, branchId }: AdminUserManagementProps) => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branchId);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    role: "CASHIER" as 'MANAGER' | 'CASHIER',
    companyId: "",
    branchId: branchId
  });

  useEffect(() => {
    loadUsers();
    loadCompanies();
    loadBranches();
  }, [adminId]);

  const loadCompanies = async () => {
    try {
      const response = await apiService.getCompanies();
      if (response.success) {
        setCompanies(response.data);
      } else {
        toast.error(response.message || 'Failed to load businesses');
      }
    } catch (error) {
      console.error('Error loading companies:', error);
      toast.error('Failed to load businesses');
    }
  };

  const loadBranches = async () => {
    try {
      const response = await apiService.getBranches();
      if (response.success) {
        setBranches(response.data.branches);
      } else {
        toast.error(response.message || 'Failed to load branches');
      }
    } catch (error) {
      console.error('Error loading branches:', error);
      toast.error('Failed to load branches');
    }
  };

  const loadUsers = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await apiService.getAdminUsers(adminId);
      if (response.success) {
        setUsers(response.data);
      } else {
        toast.error(response.message || 'Failed to load users');
        setError('Failed to load users');
      }
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
      setError('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const createUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.username || !newUser.password || !newUser.companyId || !newUser.branchId) {
      toast.error("Please fill in all required fields including business and branch!");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiService.createUser({
        name: newUser.name,
        email: newUser.email,
        username: newUser.username,
        password: newUser.password,
        role: newUser.role,
        companyId: newUser.companyId,
        branchId: newUser.branchId
      });

      if (response.success) {
        toast.success("Staff created successfully!");
        loadUsers();
        setNewUser({
          name: "",
          email: "",
          username: "",
          password: "",
          role: "CASHIER",
          companyId: "",
          branchId: branchId
        });
        setIsCreateUserOpen(false);
      } else {
        toast.error(response.message || "Failed to create staff");
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error("Failed to create staff. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'ADMIN':
      case 'OWNER':
        return 'bg-orange-100 text-orange-800';
      case 'MANAGER': return 'bg-blue-100 text-blue-800';
      case 'CASHIER': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'ADMIN':
      case 'OWNER':
        return <Shield className="w-4 h-4" />;
      case 'MANAGER': return <UserCheck className="w-4 h-4" />;
      case 'CASHIER': return <Users className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Staff Management</h2>
          <p className="text-muted-foreground">Manage Staff for {adminName}</p>
        </div>
        <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all duration-200">
              <Plus className="w-4 h-4 mr-2" />
              Add Staff
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-primary" />
                <span>Add New Staff</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="userName">Full Name *</Label>
                <Input
                  id="userName"
                  placeholder="Enter full name"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="userEmail">Email Address *</Label>
                <Input
                  id="userEmail"
                  type="email"
                  placeholder="Enter email address"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="userUsername">Username *</Label>
                <Input
                  id="userUsername"
                  placeholder="Enter username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="userPassword">Password *</Label>
                <Input
                  id="userPassword"
                  type="password"
                  placeholder="Enter password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="userRole">Role *</Label>
                <Select value={newUser.role} onValueChange={(value: 'MANAGER' | 'CASHIER') => setNewUser({ ...newUser, role: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="MANAGER"
                      className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                    >
                      Manager
                    </SelectItem>
                    <SelectItem
                      value="CASHIER"
                      className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                    >
                      Cashier
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="userCompany">Business *</Label>
                <Select
                  value={newUser.companyId}
                  onValueChange={(value) => {
                    setNewUser({ ...newUser, companyId: value });
                    // Reset branch selection when company changes
                    setSelectedCompanyId(value);
                    setNewUser({ ...newUser, companyId: value, branchId: "" });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a business" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem
                        key={company.id}
                        value={company.id}
                        className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                      >
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="userBranch">Branch *</Label>
                <Select
                  value={newUser.branchId}
                  onValueChange={(value) => setNewUser({ ...newUser, branchId: value })}
                  disabled={!newUser.companyId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={newUser.companyId ? "Select a branch" : "Select a business first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches
                      .filter(branch => !newUser.companyId || branch.adminId === adminId || branch.createdBy === adminId)
                      .map((branch) => (
                        <SelectItem
                          key={branch.id}
                          value={branch.id}
                          className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                        >
                          {branch.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t">
              <Button variant="outline" onClick={() => setIsCreateUserOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={createUser}
                disabled={isSubmitting}
                className="bg-[linear-gradient(135deg,#1C623C_0%,#247449_50%,#6EB469_100%)] text-white hover:opacity-90"
              >
                {isSubmitting ? 'Creating...' : 'Create Staff'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadUsers}
            className="mt-2"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search staff by name, email, or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.map((user) => (
          <Card key={user.id} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    {getRoleIcon(user.role)}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{user.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                <div className="flex space-x-1">
                  <Button variant="ghost" size="sm">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{user.email}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">Last active: {user.lastActive}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className={`px-2 py-1 rounded text-xs ${getStatusColor(user.status)}`}>
                  {user.status.toUpperCase()}
                </span>
                <span className={`px-2 py-1 rounded text-xs ${getRoleColor(user.role)}`}>
                  {user.role}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredUsers.length === 0 && !isLoading && (
        <div className="text-center py-8">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No Staff found</p>
        </div>
      )}
    </div>
  );
};

export default AdminUserManagement;
