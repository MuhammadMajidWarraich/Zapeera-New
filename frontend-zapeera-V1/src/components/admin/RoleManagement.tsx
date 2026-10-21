import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Shield,
  UserCog,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Edit,
  Loader2,
  KeyRound
} from 'lucide-react';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { apiService } from '@/services/api';
import { useAdmin } from '@/contexts/useAdmin';

/**
 * Role Management — rebuilt on the real role endpoints (audit A8):
 * - Roles + their resource permissions: GET /api/roles
 * - Per-role permission detail:        GET /api/roles/roles/:role/permissions
 * - Members of the selected business:  GET /api/companies/:id/members
 *   (falls back to GET /api/users when no business is selected)
 * - Change a member's role:            PUT /api/roles/users/:userId/role
 *
 * The backend has no tenant endpoint for creating custom roles or editing
 * role permission policies (policy publishing lives in the Backoffice), so
 * this page intentionally offers neither — no fake controls.
 */

interface RolePermission {
  resource: string;
  actions: string[];
  conditions?: Record<string, any>;
}

interface RoleInfo {
  role: string;
  description?: string;
  permissions: RolePermission[];
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  branch?: string;
  isActive: boolean;
  createdAt?: string;
}

// Roles the role-change endpoint accepts (business-scoped only).
const ASSIGNABLE_ROLES = ['OWNER', 'USER', 'MANAGER', 'CASHIER'];

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-orange-100 text-orange-800',
  USER: 'bg-slate-100 text-slate-800',
  MANAGER: 'bg-blue-100 text-blue-800',
  CASHIER: 'bg-yellow-100 text-yellow-800'
};

const RoleManagement: React.FC = () => {
  const navigate = useNavigate();
  const { selectedCompanyId, selectedCompany } = useAdmin();
  const [roles, setRoles] = useState<Record<string, RoleInfo>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [accessibleResources, setAccessibleResources] = useState<string[] | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [newRole, setNewRole] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);

  const loadRoles = useCallback(async () => {
    try {
      const response = await apiService.getAllRoles();
      if (response.success && response.data) {
        setRoles(response.data as Record<string, RoleInfo>);
      } else {
        setError(response.message || 'Failed to load roles');
      }
    } catch (err: any) {
      console.error('Error loading roles:', err);
      setError(err?.message || 'Failed to load roles');
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      if (selectedCompanyId) {
        const response = await apiService.getCompanyMembers(selectedCompanyId, {
          page: 1,
          limit: 500
        });
        const rows = Array.isArray((response as any).data) ? (response as any).data : [];
        const mapped: Member[] = rows
          .filter((source: any) => {
            const globalRole = String(source.role || source.user?.role || '').toUpperCase();
            return globalRole !== 'ADMIN' && globalRole !== 'SUPER_ADMIN';
          })
          .map((source: any) => ({
            id: String(source.userId || source.user?.id || source.id || ''),
            name: source.user?.name || source.name || 'Unknown',
            email: source.user?.email || source.email || '',
            role: String(
              source.staffListRole || source.roleName || source.role || source.user?.role || 'CASHIER'
            ).toUpperCase(),
            branch: source.branch?.name || source.user?.branch?.name || undefined,
            isActive: source.user?.isActive ?? source.isActive ?? true,
            createdAt: source.createdAt || source.user?.createdAt
          }))
          .filter((m: Member) => m.id);
        setMembers(mapped);
      } else {
        const response = await apiService.getUsers({ page: 1, limit: 500 });
        if (response.success && response.data) {
          const users = (response.data as any).users || [];
          setMembers(
            users.map((u: any) => ({
              id: String(u.id),
              name: u.name || 'Unknown',
              email: u.email || '',
              role: String(u.staffListRole || u.role || 'CASHIER').toUpperCase(),
              branch: u.branch?.name,
              isActive: u.isActive ?? true,
              createdAt: u.createdAt
            }))
          );
        }
      }
    } catch (err) {
      console.error('Error loading members:', err);
      setMembers([]);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRoles(), loadMembers()]).finally(() => setLoading(false));
  }, [loadRoles, loadMembers]);

  // Load the selected role's accessible resources (real per-role endpoint).
  useEffect(() => {
    if (!selectedRole) {
      setAccessibleResources(null);
      return;
    }
    let cancelled = false;
    setPermissionsLoading(true);
    apiService
      .getRolePermissions(selectedRole)
      .then((response) => {
        if (cancelled) return;
        if (response.success && response.data) {
          setAccessibleResources(response.data.accessibleResources || []);
        } else {
          setAccessibleResources(null);
        }
      })
      .catch(() => {
        if (!cancelled) setAccessibleResources(null);
      })
      .finally(() => {
        if (!cancelled) setPermissionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRole]);

  const handleRoleChange = async () => {
    if (!selectedMember || !newRole || newRole === selectedMember.role) return;
    if (!selectedCompanyId) {
      toast.error('Select a business first — role changes are business-scoped.');
      return;
    }
    try {
      setIsUpdating(true);
      const response = await apiService.updateUserRole(
        selectedMember.id,
        newRole,
        selectedCompanyId
      );
      if (response.success) {
        toast.success(`${selectedMember.name} is now ${newRole}`);
        setSelectedMember(null);
        setNewRole('');
        await loadMembers();
      } else {
        toast.error(response.message || 'Failed to update role');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update role');
    } finally {
      setIsUpdating(false);
    }
  };

  const getRoleBadge = (role: string) => (
    <Badge className={ROLE_COLORS[role] || 'bg-gray-100 text-gray-800'}>
      {role.charAt(0) + role.slice(1).toLowerCase()}
    </Badge>
  );

  const roleEntries = Object.entries(roles);
  const selectedRoleInfo = selectedRole ? roles[selectedRole] : undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading roles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Role Management</h1>
          <p className="text-muted-foreground">
            Roles and member assignments
            {selectedCompany ? ` for ${selectedCompany.name}` : ''} — role permission
            policies are published from the Backoffice.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/admin/users')}>
          <UserCog className="w-4 h-4 mr-2" />
          Manage Staff
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">{error}</p>
          <p className="text-red-700 text-sm mt-1">
            Role data is restricted to business owners. If you are not the owner of the
            selected business, ask the owner to open this page.
          </p>
        </div>
      )}

      {/* Role Overview Cards — from GET /api/roles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {roleEntries.map(([key, info]) => (
          <Card
            key={key}
            className={`cursor-pointer transition-shadow hover:shadow-md ${
              selectedRole === key ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setSelectedRole(selectedRole === key ? '' : key)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-primary" />
                <CardTitle className="text-sm">
                  {key.charAt(0) + key.slice(1).toLowerCase()}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-2 line-clamp-3">
                {info.description || 'No description provided.'}
              </p>
              <div className="text-2xl font-bold text-foreground">
                {members.filter((m) => m.role === key).length}
              </div>
              <p className="text-xs text-muted-foreground">members</p>
              <p className="text-xs text-primary mt-2">
                {selectedRole === key ? 'Hide permissions' : 'View permissions'}
              </p>
            </CardContent>
          </Card>
        ))}
        {roleEntries.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No roles were returned by the API.</p>
        )}
      </div>

      {/* Selected role permissions — real data from the roles endpoints */}
      {selectedRoleInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <KeyRound className="w-5 h-5" />
              <span>
                {selectedRole.charAt(0) + selectedRole.slice(1).toLowerCase()} Permissions
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedRoleInfo.description && (
              <p className="text-sm text-muted-foreground">{selectedRoleInfo.description}</p>
            )}
            <div className="space-y-2">
              {(selectedRoleInfo.permissions || []).map((perm) => (
                <div
                  key={perm.resource}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2"
                >
                  <span className="text-sm font-medium capitalize">
                    {perm.resource.replace(/_/g, ' ')}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {perm.actions.map((action) => (
                      <Badge key={action} variant="outline" className="text-xs capitalize">
                        {action}
                      </Badge>
                    ))}
                  </span>
                </div>
              ))}
              {(selectedRoleInfo.permissions || []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No resource permissions listed for this role.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Accessible Resources</p>
              {permissionsLoading ? (
                <p className="text-sm text-muted-foreground flex items-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading...
                </p>
              ) : accessibleResources && accessibleResources.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {accessibleResources.map((resource) => (
                    <Badge key={resource} variant="secondary" className="text-xs capitalize">
                      {resource.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Accessible-resource detail is not available for this role.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members Table — real business members */}
      <Card>
        <CardHeader>
          <CardTitle>Business Members</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No members found for the selected business.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Member Since</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{member.name}</div>
                        <div className="text-sm text-muted-foreground">{member.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(member.role)}</TableCell>
                    <TableCell>{member.branch || '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {member.isActive ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="text-sm">
                          {member.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.createdAt
                        ? new Date(member.createdAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <RoleGuard roles={['OWNER']}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedMember(member);
                            setNewRole(member.role);
                          }}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Role
                        </Button>
                      </RoleGuard>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Role Change Modal */}
      {selectedMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-96">
            <CardHeader>
              <CardTitle>Change Member Role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Changing role for: <strong>{selectedMember.name}</strong>
                </p>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  Current role: {getRoleBadge(selectedMember.role)}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">New Role</label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.filter((key) => roles[key]).map((key) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center space-x-2">
                          <Badge className={ROLE_COLORS[key]}>
                            {key.charAt(0) + key.slice(1).toLowerCase()}
                          </Badge>
                          <span className="text-sm">{roles[key].description}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {newRole && newRole !== selectedMember.role && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium">Role Change Warning</p>
                      <p className="text-muted-foreground">
                        This changes the member&apos;s permissions and access in this
                        business. The business creator cannot be demoted from OWNER.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedMember(null);
                    setNewRole('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRoleChange}
                  disabled={!newRole || newRole === selectedMember.role || isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Update Role'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;
