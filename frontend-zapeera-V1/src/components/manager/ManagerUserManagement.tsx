import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  UserCheck,
  Users,
  RefreshCw,
  AlertCircle
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { getMissingRequiredFields } from "@/lib/required-fields";

interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  staffListRole?: string;
  isActive: boolean;
  businessAccessGranted?: boolean;
  createdAt: string;
  branchId?: string;
  branch?: {
    id: string;
    name: string;
  };
}

interface Branch {
  id: string;
  name: string;
}

const ManagerUserManagement = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Define available roles for manager to create (managers can only create cashiers)
  const availableRoles = [
    { id: "CASHIER", label: "Cashier", description: "Sales and billing operations" }
  ];

  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    username: "",
    branchId: currentUser?.branchId || "",
    role: "CASHIER",
    password: ""
  });

  // Load data on component mount
  useEffect(() => {
    loadUsers();
    loadBranches();
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const response = companyIdForStaff
        ? await apiService.getCompanyMembers(companyIdForStaff, { page: 1, limit: 100, search: searchTerm })
        : await apiService.getUsers({ page: 1, limit: 100 });

      if (response.success && (Array.isArray(response.data) || (response.data as any)?.users)) {
        const sourceUsers = Array.isArray(response.data) ? response.data : ((response.data as any)?.users || []);
        const cashierUsers = sourceUsers
          .map((item: any) => {
            const userItem = Array.isArray(response.data) ? item : item;
            return {
              id: String(userItem.userId || userItem.id || ''),
              username: userItem.user?.username || userItem.username || '',
              name: userItem.user?.name || userItem.name || '',
              email: userItem.user?.email || userItem.email || '',
              role: userItem.role || userItem.user?.role || 'CASHIER',
              staffListRole: userItem.role || (userItem as any).staffListRole,
              isActive: userItem.user?.isActive ?? userItem.isActive ?? true,
              branchId: userItem.branchId || userItem.user?.branchId || '',
              branch: userItem.branch || userItem.user?.branch,
              businessAccessGranted: true,
              createdAt: userItem.createdAt || userItem.user?.createdAt || '',
            } as User;
          })
          .filter((user: User) => (user.staffListRole || user.role) === 'CASHIER');
        setUsers(cashierUsers);
      } else {
        setError("Failed to load staff");
      }
    } catch (err) {
      console.error("Error loading users:", err);
      setError("Failed to load staff");
    } finally {
      setIsLoading(false);
    }
  };

  const loadBranches = async () => {
    try {
      const response = await apiService.getBranches();
      if (response.success && response.data?.branches) {
        setBranches(response.data.branches);
      }
    } catch (err) {
      console.error("Error loading branches:", err);
    }
  };

  const handleCreateUser = async () => {
    try {
      setError("");
      setSuccess("");

      const missing = getMissingRequiredFields(newUser as any, {
        name: 'Name',
        email: 'Email',
        username: 'Username',
        password: 'Password',
      });
      if (missing.length > 0) {
        const errorMessage = `Please fill in all required fields: ${missing.join(', ')}`;
        setError(errorMessage);
        toast({
          title: "Required fields missing",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }

      const response = await apiService.createUser({
        ...newUser,
        role: newUser.role as "CASHIER" | "MANAGER" | "OWNER",
        branchId: newUser.branchId || currentUser?.branchId || ""
      });

      if (response.success) {
        setSuccess("Staff created successfully");
        setIsCreateDialogOpen(false);
        setNewUser({
          name: "",
          email: "",
          username: "",
          branchId: currentUser?.branchId || "",
          role: "CASHIER",
          password: ""
        });
        loadUsers();
      } else {
        setError(response.message || "Failed to create staff");
        toast({
          title: "Error",
          description: response.message || "Failed to create staff",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Error creating user:", err);
      setError("Failed to create staff");
      toast({
        title: "Error",
        description: "Failed to create staff",
        variant: "destructive",
      });
    }
  };

  const companyIdForStaff = currentUser?.companyId;

  const handleDeleteUser = async (userId: string) => {
    try {
      setError("");
      setSuccess("");

      if (!companyIdForStaff) {
        toast({
          title: "Missing business",
          description: "Cannot remove staff without an assigned company.",
          variant: "destructive",
        });
        return;
      }

      const response = await apiService.removeCompanyMember(companyIdForStaff, userId);
      if (response && (response as { success?: boolean }).success !== false) {
        setSuccess("Staff removed from this business. Their platform account is unchanged.");
        setIsDeleteDialogOpen(false);
        setSelectedUser(null);
        toast({
          title: "Removed from business",
          description: "This person no longer has access to this business. Their login account remains.",
        });
        loadUsers();
      } else {
        setError((response as any)?.message || "Failed to remove staff");
      }
    } catch (err: any) {
      console.error("Error removing staff:", err);
      setError(err?.response?.data?.message || err?.message || "Failed to remove staff");
      toast({
        title: "Error",
        description: err?.response?.data?.message || err?.message || "Failed to remove staff",
        variant: "destructive",
      });
    }
  };

  const handleToggleBusinessAccess = async (user: User) => {
    try {
      setError("");
      setSuccess("");

      if (!companyIdForStaff) {
        toast({
          title: "Missing business",
          description: "Cannot update access without an assigned company.",
          variant: "destructive",
        });
        return;
      }

      const currentAccess = user.businessAccessGranted !== false;
      const nextGranted = !currentAccess;

      if (!nextGranted) {
        const response = await apiService.removeCompanyMember(companyIdForStaff, user.id);
        if (response && (response as { success?: boolean }).success !== false) {
          setSuccess(`Access removed for ${user.name} for this business only.`);
          setUsers((prev) => prev.filter((item) => item.id !== user.id));
          toast({
            title: "Access updated",
            description: `${user.name} no longer has access to this business.`,
          });
          loadUsers();
        } else {
          setError((response as any)?.message || "Failed to remove access");
        }
        return;
      }

      // Managers only manage cashiers in this screen; re-grant must stay CASHIER.
      const response = await apiService.addCompanyMember(companyIdForStaff, {
        userId: user.id,
        role: "CASHIER",
        branchId: user.branchId || currentUser?.branchId || undefined,
      });
      if (response && (response as { success?: boolean }).success !== false) {
        setSuccess(`Business access for ${user.name} granted for this branch.`);
        setUsers((prev) =>
          prev.map((item) =>
            item.id === user.id ? { ...item, businessAccessGranted: true } : item
          )
        );
        loadUsers();
      } else {
        setError((response as any)?.message || "Failed to restore access");
      }
    } catch (err: any) {
      console.error("Error updating business access:", err);
      setError(err?.response?.data?.message || err?.message || "Failed to update business access");
      toast({
        title: "Error",
        description: err?.response?.data?.message || err?.message || "Failed to update access",
        variant: "destructive",
      });
    }
  };

  // Filter users based on search term
  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get role color
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'MANAGER':
        return 'bg-blue-100 text-blue-800';
      case 'CASHIER':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Cashier Management</h1>
          <p className="text-gray-600 mt-1">Manage cashiers for your branch</p>
        </div>

        {/* Alerts */}
        {error && (
          <Alert className="mb-6" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="mb-6" variant="default">
            <UserCheck className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {/* Main Content */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-primary" />
                <span>Cashiers</span>
              </CardTitle>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search cashiers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add Cashier
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add New Cashier</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="name">Full Name *</Label>
                        <Input
                          id="name"
                          value={newUser.name}
                          onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                          placeholder="Enter full name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="email">Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={newUser.email}
                          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                          placeholder="Enter email address"
                        />
                      </div>
                      <div>
                        <Label htmlFor="username">Username *</Label>
                        <Input
                          id="username"
                          value={newUser.username}
                          onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                          placeholder="Enter username"
                        />
                      </div>
                      <div>
                        <Label htmlFor="role">Role *</Label>
                        <Select
                          value={newUser.role}
                          onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableRoles.map((role) => (
                              <SelectItem key={role.id} value={role.id}>
                                {role.label} - {role.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="password">Password *</Label>
                        <Input
                          id="password"
                          type="password"
                          value={newUser.password}
                          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                          placeholder="Enter password"
                        />
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          onClick={() => setIsCreateDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button onClick={handleCreateUser}>
                          Create Staff
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length > 0 ? (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>
                        <Badge className={getRoleColor(user.role)}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.businessAccessGranted !== false ? "default" : "secondary"}>
                          {user.businessAccessGranted !== false ? "Access Granted" : "Access Removed"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user);
                                setIsViewDialogOpen(true);
                              }}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleToggleBusinessAccess(user)}
                            >
                              <UserCheck className="w-4 h-4 mr-2" />
                              {user.businessAccessGranted !== false ? "Remove Access" : "Allow Access"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove from business
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="text-muted-foreground">
                        <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No Staff found</p>
                        <p className="text-sm">Add your first Staff member to get started</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* View User Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>User Details</DialogTitle>
            </DialogHeader>
            {selectedUser && (
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <p className="text-sm font-medium">{selectedUser.name}</p>
                </div>
                <div>
                  <Label>Email</Label>
                  <p className="text-sm">{selectedUser.email}</p>
                </div>
                <div>
                  <Label>Username</Label>
                  <p className="text-sm">{selectedUser.username}</p>
                </div>
                <div>
                  <Label>Role</Label>
                  <Badge className={getRoleColor(selectedUser.role)}>
                    {selectedUser.role}
                  </Badge>
                </div>
                <div>
                  <Label>Business Access</Label>
                  <Badge variant={selectedUser.businessAccessGranted !== false ? "default" : "secondary"}>
                    {selectedUser.businessAccessGranted !== false ? "Access Granted" : "Access Removed"}
                  </Badge>
                </div>
                <div>
                  <Label>Branch</Label>
                  <p className="text-sm">{selectedUser.branch?.name || "No branch assigned"}</p>
                </div>
                <div>
                  <Label>Created</Label>
                  <p className="text-sm">{new Date(selectedUser.createdAt).toLocaleString()}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Staff Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove from this business</DialogTitle>
            </DialogHeader>
            {selectedUser && (
              <div className="space-y-4">
                <p>
                  Remove <strong>{selectedUser.name}</strong> from this business? Their Zapeera account stays
                  active.
                </p>
                <p className="text-sm text-muted-foreground">
                  They will lose access to this company only—not to the whole platform.
                </p>
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsDeleteDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleDeleteUser(selectedUser.id)}
                  >
                    Remove from business
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default ManagerUserManagement;
