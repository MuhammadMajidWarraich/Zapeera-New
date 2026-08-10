import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, UserPlus, Check, ArrowRight, Loader2, Mail, Phone } from 'lucide-react';
import { apiService } from '@/services/api';

interface AddStaffModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  businessId: string;
  branches: Array<{ id: string; name: string }>;
}

const AddStaffModal: React.FC<AddStaffModalProps> = ({
  open,
  onClose,
  onSuccess,
  businessId,
  branches,
}) => {
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'email' | 'phone'>('email');
  const [isSearching, setIsSearching] = useState(false);
  const [existingUser, setExistingUser] = useState<any>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [newUserData, setNewUserData] = useState({ name: '', email: '', phone: '', password: '' });
  const [role, setRole] = useState('MANAGER');
  const [branchId, setBranchId] = useState('');
  const [hrData, setHrData] = useState({
    designation: '',
    department: '',
    salary: '',
    employmentType: 'FULL_TIME',
    joiningDate: new Date().toISOString().split('T')[0],
    bankName: '',
    bankAccountNumber: '',
    cnicNumber: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setStep(1);
    setSearchQuery('');
    setSearchType('email');
    setIsSearching(false);
    setExistingUser(null);
    setIsNewUser(false);
    setNewUserData({ name: '', email: '', phone: '', password: '' });
    setRole('MANAGER');
    setBranchId('');
    setHrData({
      designation: '',
      department: '',
      salary: '',
      employmentType: 'FULL_TIME',
      joiningDate: new Date().toISOString().split('T')[0],
      bankName: '',
      bankAccountNumber: '',
      cnicNumber: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
    });
    setIsSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error('Please enter an email or phone number');
      return;
    }

    setIsSearching(true);
    try {
      const response = await apiService.searchUser(searchQuery);
      if (!response.success) {
        toast.error(response.message || 'Search failed. Please try again.');
        return;
      }

      // Backend returns { found, user }; tolerate a raw user object too
      const payload = response.data as any;
      const user = payload?.user || (payload && payload.id ? payload : null);

      if (user) {
        setExistingUser(user);
        setIsNewUser(false);
        toast.success('User found');
      } else {
        setExistingUser(null);
        setIsNewUser(true);
        setNewUserData((prev) => ({
          ...prev,
          email: searchType === 'email' ? searchQuery : '',
          phone: searchType === 'phone' ? searchQuery : '',
        }));
        toast.info('User not found. You can create a new account.');
      }
      setStep(2);
    } catch (error: any) {
      toast.error(error?.message || 'Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSubmit = async () => {
    if (!branchId) {
      toast.error('Please select a branch');
      return;
    }
    if (isNewUser && (!newUserData.name || !newUserData.email)) {
      toast.error('Please fill in name and email for new user');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: any = {
        role,
        branchId,
        designation: hrData.designation,
        department: hrData.department,
        employmentType: hrData.employmentType,
      };

      if (existingUser) {
        // Existing user found via search — link them by userId
        payload.userId = existingUser.id;
        payload.name = existingUser.name;
        payload.email = existingUser.email;
      } else {
        // New user — backend creates the account
        payload.name = newUserData.name;
        payload.email = newUserData.email;
        payload.phone = newUserData.phone;
        if (newUserData.password) payload.password = newUserData.password;
      }

      if (hrData.salary) payload.salary = parseFloat(hrData.salary);
      if (hrData.joiningDate) payload.joiningDate = hrData.joiningDate;
      if (hrData.bankName) payload.bankName = hrData.bankName;
      if (hrData.bankAccountNumber) payload.bankAccountNumber = hrData.bankAccountNumber;
      if (hrData.cnicNumber) payload.cnicNumber = hrData.cnicNumber;
      if (hrData.emergencyContactName) payload.emergencyContactName = hrData.emergencyContactName;
      if (hrData.emergencyContactPhone) payload.emergencyContactPhone = hrData.emergencyContactPhone;

      const response = await apiService.createStaff(payload);
      if (response.success) {
        toast.success('Staff member added successfully!');
        resetState();
        onSuccess();
        handleClose();
      } else {
        toast.error(response.message || 'Failed to add staff member');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add staff member');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabels = ['Search', 'User', 'Role', 'HR Details', 'Review'];

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-6">
      {stepLabels.map((label, index) => {
        const stepNum = index + 1;
        const isCompleted = step > stepNum;
        const isCurrent = step === stepNum;

        return (
          <React.Fragment key={stepNum}>
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isCompleted
                    ? 'bg-green-500 text-white'
                    : isCurrent
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
              </div>
              <span
                className={`text-[10px] mt-1 ${
                  isCurrent ? 'text-blue-600 font-medium' : isCompleted ? 'text-green-600' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {index < stepLabels.length - 1 && (
              <div
                className={`w-8 h-0.5 mt-[-14px] ${
                  step > stepNum ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-[#0a1128]">Search User</h3>
        <p className="text-sm text-[#8c95b0]">Enter email or phone to check if user exists</p>
      </div>

      <div className="flex gap-2 mb-2">
        <Button
          type="button"
          variant={searchType === 'email' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSearchType('email')}
          className="gap-1"
        >
          <Mail className="w-4 h-4" />
          Email
        </Button>
        <Button
          type="button"
          variant={searchType === 'phone' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSearchType('phone')}
          className="gap-1"
        >
          <Phone className="w-4 h-4" />
          Phone
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="searchQuery">
          {searchType === 'email' ? 'Email Address' : 'Phone Number'}
        </Label>
        <div className="flex gap-2">
          <Input
            id="searchQuery"
            type={searchType === 'email' ? 'email' : 'tel'}
            placeholder={searchType === 'email' ? 'user@example.com' : '+92 300 1234567'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()}>
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Search
          </Button>
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => {
    if (existingUser && !isNewUser) {
      return (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-[#0a1128]">User Found</h3>
            <p className="text-sm text-[#8c95b0]">This user already has a Zapeera account</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                {existingUser.profileImage ? (
                  <img
                    src={existingUser.profileImage}
                    alt={existingUser.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-lg font-semibold text-blue-600">
                    {existingUser.name?.charAt(0)?.toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <h4 className="font-medium text-[#0a1128]">{existingUser.name}</h4>
                <p className="text-sm text-[#8c95b0]">{existingUser.email}</p>
                {existingUser.phone && (
                  <p className="text-sm text-[#8c95b0]">{existingUser.phone}</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
              Back
            </Button>
            <Button onClick={() => setStep(3)} className="flex-1 gap-1">
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="text-center mb-4">
          <h3 className="text-lg font-semibold text-[#0a1128]">Create New User</h3>
          <p className="text-sm text-[#8c95b0]">Fill in the details for the new account</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="newUserName">Full Name *</Label>
            <Input
              id="newUserName"
              placeholder="John Doe"
              value={newUserData.name}
              onChange={(e) => setNewUserData((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newUserEmail">Email *</Label>
            <Input
              id="newUserEmail"
              type="email"
              placeholder="user@example.com"
              value={newUserData.email}
              onChange={(e) => setNewUserData((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newUserPhone">Phone</Label>
            <Input
              id="newUserPhone"
              type="tel"
              placeholder="+92 300 1234567"
              value={newUserData.phone}
              onChange={(e) => setNewUserData((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newUserPassword">Temporary Password *</Label>
            <Input
              id="newUserPassword"
              type="password"
              placeholder="Min 8 characters"
              value={newUserData.password}
              onChange={(e) => setNewUserData((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
            Back
          </Button>
          <Button
            onClick={() => setStep(3)}
            className="flex-1 gap-1"
            disabled={!newUserData.name || !newUserData.email}
          >
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderStep3 = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-[#0a1128]">Role Assignment</h3>
        <p className="text-sm text-[#8c95b0]">Assign role and branch access</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Role *</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MANAGER">Manager</SelectItem>
              <SelectItem value="CASHIER">Cashier</SelectItem>
              <SelectItem value="INVENTORY">Inventory Staff</SelectItem>
              <SelectItem value="VIEWER">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Branch *</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Status</Label>
          <Select value="ACTIVE" disabled>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-[#8c95b0]">Staff member is added with immediate access to the selected branch.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
          Back
        </Button>
        <Button onClick={() => setStep(4)} className="flex-1 gap-1" disabled={!branchId}>
          Continue <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-[#0a1128]">Employment Details</h3>
        <p className="text-sm text-[#8c95b0]">HR and employment information</p>
      </div>

      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
        <div className="space-y-2">
          <Label htmlFor="designation">Designation *</Label>
          <Input
            id="designation"
            placeholder="e.g. Store Manager"
            value={hrData.designation}
            onChange={(e) => setHrData((prev) => ({ ...prev, designation: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="department">Department</Label>
          <Input
            id="department"
            placeholder="e.g. Operations"
            value={hrData.department}
            onChange={(e) => setHrData((prev) => ({ ...prev, department: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Employment Type</Label>
            <Select
              value={hrData.employmentType}
              onValueChange={(v) => setHrData((prev) => ({ ...prev, employmentType: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL_TIME">Full Time</SelectItem>
                <SelectItem value="PART_TIME">Part Time</SelectItem>
                <SelectItem value="CONTRACT">Contract</SelectItem>
                <SelectItem value="INTERN">Intern</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Joining Date</Label>
            <Input
              type="date"
              value={hrData.joiningDate}
              onChange={(e) => setHrData((prev) => ({ ...prev, joiningDate: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="salary">Salary (Monthly)</Label>
          <Input
            id="salary"
            type="number"
            placeholder="0.00"
            value={hrData.salary}
            onChange={(e) => setHrData((prev) => ({ ...prev, salary: e.target.value }))}
          />
        </div>

        <div className="pt-2 border-t">
          <p className="text-xs font-medium text-[#8c95b0] uppercase tracking-wide mb-3">Optional Details</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="bankName">Bank Name</Label>
            <Input
              id="bankName"
              placeholder="e.g. HBL"
              value={hrData.bankName}
              onChange={(e) => setHrData((prev) => ({ ...prev, bankName: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bankAccountNumber">Account Number</Label>
            <Input
              id="bankAccountNumber"
              placeholder="Account number"
              value={hrData.bankAccountNumber}
              onChange={(e) => setHrData((prev) => ({ ...prev, bankAccountNumber: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cnicNumber">CNIC Number</Label>
          <Input
            id="cnicNumber"
            placeholder="e.g. 35202-1234567-1"
            value={hrData.cnicNumber}
            onChange={(e) => setHrData((prev) => ({ ...prev, cnicNumber: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="emergencyContactName">Emergency Contact</Label>
            <Input
              id="emergencyContactName"
              placeholder="Contact name"
              value={hrData.emergencyContactName}
              onChange={(e) => setHrData((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergencyContactPhone">Emergency Phone</Label>
            <Input
              id="emergencyContactPhone"
              placeholder="Phone number"
              value={hrData.emergencyContactPhone}
              onChange={(e) => setHrData((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(3)} className="flex-1">
          Back
        </Button>
        <Button onClick={() => setStep(5)} className="flex-1 gap-1" disabled={!hrData.designation}>
          Continue <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  const renderStep5 = () => {
    const user = existingUser && !isNewUser ? existingUser : newUserData;
    const branchName = branches.find((b) => b.id === branchId)?.name || '';

    return (
      <div className="space-y-4">
        <div className="text-center mb-4">
          <h3 className="text-lg font-semibold text-[#0a1128]">Review & Add</h3>
          <p className="text-sm text-[#8c95b0]">Confirm all details before adding the staff member</p>
        </div>

        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h4 className="text-xs font-medium text-[#8c95b0] uppercase tracking-wide mb-2">User</h4>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="text-sm font-semibold text-blue-600">
                  {(user as any).name?.charAt(0)?.toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-medium text-[#0a1128]">{(user as any).name}</p>
                <p className="text-sm text-[#8c95b0]">{(user as any).email}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h4 className="text-xs font-medium text-[#8c95b0] uppercase tracking-wide mb-2">Role & Branch</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-[#8c95b0]">Role:</span>
                <span className="ml-2 font-medium text-[#0a1128]">{role}</span>
              </div>
              <div>
                <span className="text-[#8c95b0]">Branch:</span>
                <span className="ml-2 font-medium text-[#0a1128]">{branchName}</span>
              </div>
              <div>
                <span className="text-[#8c95b0]">Status:</span>
                <span className="ml-2 font-medium text-[#0a1128]">Active</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h4 className="text-xs font-medium text-[#8c95b0] uppercase tracking-wide mb-2">Employment</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-[#8c95b0]">Designation:</span>
                <span className="ml-2 font-medium text-[#0a1128]">{hrData.designation}</span>
              </div>
              {hrData.department && (
                <div>
                  <span className="text-[#8c95b0]">Department:</span>
                  <span className="ml-2 font-medium text-[#0a1128]">{hrData.department}</span>
                </div>
              )}
              <div>
                <span className="text-[#8c95b0]">Type:</span>
                <span className="ml-2 font-medium text-[#0a1128]">{hrData.employmentType.replace('_', ' ')}</span>
              </div>
              {hrData.salary && (
                <div>
                  <span className="text-[#8c95b0]">Salary:</span>
                  <span className="ml-2 font-medium text-[#0a1128]">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'PKR' }).format(
                      parseFloat(hrData.salary)
                    )}
                  </span>
                </div>
              )}
              {hrData.joiningDate && (
                <div>
                  <span className="text-[#8c95b0]">Joining:</span>
                  <span className="ml-2 font-medium text-[#0a1128]">{hrData.joiningDate}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep(4)} className="flex-1">
            Back
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 gap-1">
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Add Staff Member
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  const renderCurrentStep = () => {
    switch (step) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      case 5:
        return renderStep5();
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            Add Staff Member
          </DialogTitle>
        </DialogHeader>

        {renderStepIndicator()}
        {renderCurrentStep()}
      </DialogContent>
    </Dialog>
  );
};

export default AddStaffModal;
