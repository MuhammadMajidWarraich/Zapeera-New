import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  CalendarDays,
  CheckSquare,
  Clock,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdmin } from "@/contexts/useAdmin";
import { apiService } from "@/services/api";
import { withBusinessSlug } from "@/utils/business-routes";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId?: string;
}

interface StaffMember {
  id: string;
  staffId: string;
  name: string;
  position: string;
  branchId: string;
  isActive: boolean;
}

interface ScheduledShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  date: string;
  branchId: string;
  branchName: string;
  assignedUsers: Array<{ id: string; name: string; role: string }>;
  maxUsers: number;
  status: "scheduled" | "active" | "completed" | "cancelled" | string;
  notes?: string;
}

interface ActiveShift {
  id: string;
  staffId: string;
  branchId: string;
  shiftDate: string;
  startTime: string;
  openingBalance: number;
  status: string;
  staff?: { id: string; name: string; staffId: string; position: string };
  branch?: { id: string; name: string };
}

const formatDateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const today = formatDateInput(new Date());

const statusClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "completed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (normalized === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
};

const responseMessage = (response: { message?: string; errors?: string[] }) =>
  response.errors?.length ? response.errors.join(", ") : response.message;

const ShiftManagement = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedCompanyId, selectedCompany, allCompanies, selectedBranchId, allBranches } = useAdmin();

  const businessSlug = useMemo(() => {
    const c =
      selectedCompany || allCompanies.find((x) => x.id === selectedCompanyId);
    return String((c as { slug?: string | null })?.slug || "").trim();
  }, [selectedCompany, allCompanies, selectedCompanyId]);

  const goToStaff = useCallback(() => {
    navigate(withBusinessSlug(businessSlug || null, "/staff"));
  }, [navigate, businessSlug]);
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShift[]>([]);
  const [activeShifts, setActiveShifts] = useState<ActiveShift[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newShift, setNewShift] = useState({
    name: "",
    date: today,
    startTime: "09:00",
    endTime: "17:00",
    branchId: selectedBranchId || "",
    maxUsers: "1",
    notes: "",
    assignedUserIds: [] as string[],
  });
  const [assignment, setAssignment] = useState({ shiftId: "", userId: "" });
  const [swap, setSwap] = useState({ firstShiftId: "", firstUserId: "", secondShiftId: "", secondUserId: "" });
  const [startShiftForm, setStartShiftForm] = useState({
    staffId: "",
    branchId: selectedBranchId || "",
    openingBalance: "0",
  });

  const branchOptions = useMemo(() => {
    if (!selectedCompanyId) return allBranches || [];
    return (allBranches || []).filter((branch: any) => (branch.companyId || branch.company?.id) === selectedCompanyId);
  }, [allBranches, selectedCompanyId]);

  const defaultBranchId = selectedBranchId || branchOptions[0]?.id || "";

  useEffect(() => {
    if (!newShift.branchId && defaultBranchId) setNewShift((current) => ({ ...current, branchId: defaultBranchId }));
    if (!startShiftForm.branchId && defaultBranchId) setStartShiftForm((current) => ({ ...current, branchId: defaultBranchId }));
  }, [defaultBranchId, newShift.branchId, startShiftForm.branchId]);

  const getBranchName = (branchId: string) =>
    branchOptions.find((branch: any) => branch.id === branchId)?.name || "Branch";

  const visibleScheduledShifts = useMemo(() => {
    if (!selectedBranchId) return scheduledShifts;
    return scheduledShifts.filter((shift) => shift.branchId === selectedBranchId);
  }, [scheduledShifts, selectedBranchId]);

  const todaysScheduledShifts = useMemo(
    () => visibleScheduledShifts.filter((shift) => shift.date === today),
    [visibleScheduledShifts],
  );

  const activeToday = useMemo(
    () => activeShifts.filter((shift) => shift.status === "ACTIVE" || shift.status === "active"),
    [activeShifts],
  );

  const availableStaff = useMemo(() => {
    if (!newShift.branchId) return staff;
    return staff.filter((user) => !user.branchId || user.branchId === newShift.branchId);
  }, [staff, newShift.branchId]);

  const loadShiftData = async () => {
    try {
      setIsLoading(true);
      const [scheduledResponse, activeResponse, usersResponse, staffResponse] = await Promise.all([
        apiService.getScheduledShifts(),
        apiService.getShifts({
          page: 1,
          limit: 100,
          status: "ACTIVE",
          startDate: today,
          endDate: today,
          branchId: selectedBranchId || undefined,
        }),
        apiService.getUsers({ page: 1, limit: 100, branchId: selectedBranchId || undefined }),
        apiService.getStaff({ page: 1, limit: 100, isActive: true, branchId: selectedBranchId || undefined }),
      ]);

      if (scheduledResponse.success && scheduledResponse.data) setScheduledShifts(scheduledResponse.data as ScheduledShift[]);
      if (activeResponse.success && activeResponse.data) setActiveShifts(activeResponse.data.shifts as ActiveShift[]);
      if (usersResponse.success && usersResponse.data) setStaff(usersResponse.data.users as StaffUser[]);
      if (staffResponse.success && staffResponse.data) setStaffMembers(staffResponse.data.staff as StaffMember[]);
    } catch (error) {
      console.error("Failed to load shift management data:", error);
      toast({ title: "Could not load shift data" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadShiftData();
  }, [selectedBranchId]);

  const toggleAssignedUser = (userId: string) => {
    setNewShift((current) => ({
      ...current,
      assignedUserIds: current.assignedUserIds.includes(userId)
        ? current.assignedUserIds.filter((id) => id !== userId)
        : [...current.assignedUserIds, userId],
    }));
  };

  const handleCreateShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!newShift.name.trim() || !newShift.branchId || !newShift.date || !newShift.startTime || !newShift.endTime) {
      toast({ title: "Shift name, date, branch, start, and end time are required" });
      return;
    }

    const maxUsers = Math.max(1, Number.parseInt(newShift.maxUsers || "1", 10));
    if (newShift.assignedUserIds.length > maxUsers) {
      toast({ title: "Assigned staff exceeds shift capacity" });
      return;
    }

    try {
      setIsSaving(true);
      const response = await apiService.createShift({
        name: newShift.name.trim(),
        date: newShift.date,
        startTime: newShift.startTime,
        endTime: newShift.endTime,
        branchId: newShift.branchId,
        maxUsers,
        notes: newShift.notes.trim() || undefined,
        assignedUserIds: newShift.assignedUserIds,
      });

      if (!response.success) {
        toast({ title: responseMessage(response) || "Failed to add shift" });
        return;
      }

      setNewShift({
        name: "",
        date: today,
        startTime: "09:00",
        endTime: "17:00",
        branchId: defaultBranchId,
        maxUsers: "1",
        notes: "",
        assignedUserIds: [],
      });
      toast({ title: "Shift added" });
      await loadShiftData();
    } catch (error) {
      console.error("Failed to create shift:", error);
      toast({ title: "Failed to add shift" });
    } finally {
      setIsSaving(false);
    }
  };

  const updateShiftAssignments = async (shift: ScheduledShift, assignedUserIds: string[]) => {
    return apiService.updateScheduledShift(shift.id, {
      name: shift.name,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      branchId: shift.branchId,
      maxUsers: shift.maxUsers,
      notes: shift.notes,
      assignedUserIds,
    });
  };

  const handleAssignStaff = async (event: FormEvent) => {
    event.preventDefault();
    const shift = scheduledShifts.find((item) => item.id === assignment.shiftId);
    if (!shift || !assignment.userId) {
      toast({ title: "Choose a shift and staff member" });
      return;
    }

    const currentIds = shift.assignedUsers.map((user) => user.id);
    if (currentIds.includes(assignment.userId)) {
      toast({ title: "Staff member is already assigned" });
      return;
    }
    if (currentIds.length >= shift.maxUsers) {
      toast({ title: "Shift capacity is full" });
      return;
    }

    try {
      setIsSaving(true);
      const response = await updateShiftAssignments(shift, [...currentIds, assignment.userId]);
      if (!response.success) {
        toast({ title: responseMessage(response) || "Failed to assign shift" });
        return;
      }
      setAssignment({ shiftId: "", userId: "" });
      toast({ title: "Shift assigned" });
      await loadShiftData();
    } catch (error) {
      console.error("Failed to assign shift:", error);
      toast({ title: "Failed to assign shift" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSwapShifts = async (event: FormEvent) => {
    event.preventDefault();
    const firstShift = scheduledShifts.find((shift) => shift.id === swap.firstShiftId);
    const secondShift = scheduledShifts.find((shift) => shift.id === swap.secondShiftId);
    if (!firstShift || !secondShift || !swap.firstUserId || !swap.secondUserId) {
      toast({ title: "Choose two shifts and staff members to swap" });
      return;
    }

    const firstIds = firstShift.assignedUsers.map((user) => user.id);
    const secondIds = secondShift.assignedUsers.map((user) => user.id);
    if (!firstIds.includes(swap.firstUserId) || !secondIds.includes(swap.secondUserId)) {
      toast({ title: "Selected staff must already be assigned to the selected shifts" });
      return;
    }

    const nextFirstIds = Array.from(new Set(firstIds.map((id) => (id === swap.firstUserId ? swap.secondUserId : id))));
    const nextSecondIds = Array.from(new Set(secondIds.map((id) => (id === swap.secondUserId ? swap.firstUserId : id))));

    try {
      setIsSaving(true);
      const [firstResponse, secondResponse] = await Promise.all([
        updateShiftAssignments(firstShift, nextFirstIds),
        updateShiftAssignments(secondShift, nextSecondIds),
      ]);
      if (!firstResponse.success || !secondResponse.success) {
        toast({ title: "Failed to swap shift assignments" });
        return;
      }
      setSwap({ firstShiftId: "", firstUserId: "", secondShiftId: "", secondUserId: "" });
      toast({ title: "Shifts swapped" });
      await loadShiftData();
    } catch (error) {
      console.error("Failed to swap shifts:", error);
      toast({ title: "Failed to swap shifts" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartActiveShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!startShiftForm.staffId || !startShiftForm.branchId) {
      toast({ title: "Choose staff and branch" });
      return;
    }

    try {
      setIsSaving(true);
      const response = await apiService.startShift({
        staffId: startShiftForm.staffId,
        branchId: startShiftForm.branchId,
        shiftDate: new Date(`${today}T00:00:00`).toISOString(),
        startTime: new Date().toISOString(),
        openingBalance: Number.parseFloat(startShiftForm.openingBalance || "0"),
      });
      if (!response.success) {
        toast({ title: responseMessage(response) || "Failed to start active shift" });
        return;
      }
      setStartShiftForm({ staffId: "", branchId: defaultBranchId, openingBalance: "0" });
      toast({ title: "Active shift started" });
      await loadShiftData();
    } catch (error) {
      console.error("Failed to start active shift:", error);
      toast({ title: "Failed to start active shift" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    try {
      setIsSaving(true);
      const response = await apiService.deleteShift(shiftId);
      if (!response.success) {
        toast({ title: response.message || "Failed to delete shift" });
        return;
      }
      toast({ title: "Shift deleted" });
      await loadShiftData();
    } catch (error) {
      console.error("Failed to delete shift:", error);
      toast({ title: "Failed to delete shift" });
    } finally {
      setIsSaving(false);
    }
  };

  const firstSwapShift = scheduledShifts.find((shift) => shift.id === swap.firstShiftId);
  const secondSwapShift = scheduledShifts.find((shift) => shift.id === swap.secondShiftId);

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-6 w-6 text-[#1a52c5]" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Shift Management</h1>
          </div>
          <p className="max-w-3xl text-sm text-slate-600">
            Add shifts, assign staff, swap shift assignments, and monitor today's active shifts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={goToStaff}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Staff
          </Button>
          <Button variant="outline" onClick={() => document.getElementById("assign-shift")?.scrollIntoView({ behavior: "smooth" })}>
            <CheckSquare className="mr-2 h-4 w-4" />
            Assign Shift
          </Button>
          <Button onClick={() => navigate("/checkin")}>
            <Eye className="mr-2 h-4 w-4" />
            View Attendance
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-0 shadow-sm"><CardContent className="p-5"><p className="text-sm font-medium text-slate-500">Today's Scheduled</p><p className="mt-1 text-2xl font-bold text-slate-950">{todaysScheduledShifts.length}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-5"><p className="text-sm font-medium text-slate-500">Active Shifts</p><p className="mt-1 text-2xl font-bold text-slate-950">{activeToday.length}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-5"><p className="text-sm font-medium text-slate-500">Staff Assigned Today</p><p className="mt-1 text-2xl font-bold text-slate-950">{todaysScheduledShifts.reduce((sum, shift) => sum + shift.assignedUsers.length, 0)}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-5"><p className="text-sm font-medium text-slate-500">Branches</p><p className="mt-1 text-2xl font-bold text-slate-950">{branchOptions.length}</p></CardContent></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="h-5 w-5 text-[#1a52c5]" />
              Add Shift
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateShift} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Shift Name</Label>
                <Input value={newShift.name} onChange={(event) => setNewShift((current) => ({ ...current, name: event.target.value }))} placeholder="Morning Shift, Closing Shift" />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={newShift.date} onChange={(event) => setNewShift((current) => ({ ...current, date: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={newShift.branchId} onValueChange={(value) => setNewShift((current) => ({ ...current, branchId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branchOptions.map((branch: any) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input type="time" value={newShift.startTime} onChange={(event) => setNewShift((current) => ({ ...current, startTime: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input type="time" value={newShift.endTime} onChange={(event) => setNewShift((current) => ({ ...current, endTime: event.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Staff Capacity</Label>
                <Input type="number" min="1" value={newShift.maxUsers} onChange={(event) => setNewShift((current) => ({ ...current, maxUsers: event.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Assign Staff</Label>
                <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-2">
                  {availableStaff.length === 0 ? (
                    <p className="text-sm text-slate-500">No staff available for this branch.</p>
                  ) : availableStaff.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={newShift.assignedUserIds.includes(user.id)} onChange={() => toggleAssignedUser(user.id)} className="h-4 w-4" />
                      <span className="truncate">{user.name}</span>
                      <span className="ml-auto text-xs text-slate-500">{user.role}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea value={newShift.notes} onChange={(event) => setNewShift((current) => ({ ...current, notes: event.target.value }))} placeholder="Coverage notes, handover details, or opening instructions" />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={isSaving || !defaultBranchId}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Add Shift
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm" id="assign-shift">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><CheckSquare className="h-5 w-5 text-[#1a52c5]" />Assign Shift to Staff</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleAssignStaff} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Shift</Label>
                  <Select value={assignment.shiftId} onValueChange={(value) => setAssignment((current) => ({ ...current, shiftId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                    <SelectContent>{visibleScheduledShifts.map((shift) => <SelectItem key={shift.id} value={shift.id}>{shift.name} - {shift.date}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Staff</Label>
                  <Select value={assignment.userId} onValueChange={(value) => setAssignment((current) => ({ ...current, userId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                    <SelectContent>{staff.map((user) => <SelectItem key={user.id} value={user.id}>{user.name} - {user.role}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2"><Button type="submit" disabled={isSaving}>Assign Shift</Button></div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ArrowLeftRight className="h-5 w-5 text-[#1a52c5]" />Swap Shifts</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSwapShifts} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>First Shift</Label>
                  <Select value={swap.firstShiftId} onValueChange={(value) => setSwap((current) => ({ ...current, firstShiftId: value, firstUserId: "" }))}>
                    <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                    <SelectContent>{visibleScheduledShifts.map((shift) => <SelectItem key={shift.id} value={shift.id}>{shift.name} - {shift.date}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>First Staff</Label>
                  <Select value={swap.firstUserId} onValueChange={(value) => setSwap((current) => ({ ...current, firstUserId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Assigned staff" /></SelectTrigger>
                    <SelectContent>{(firstSwapShift?.assignedUsers || []).map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Second Shift</Label>
                  <Select value={swap.secondShiftId} onValueChange={(value) => setSwap((current) => ({ ...current, secondShiftId: value, secondUserId: "" }))}>
                    <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                    <SelectContent>{visibleScheduledShifts.map((shift) => <SelectItem key={shift.id} value={shift.id}>{shift.name} - {shift.date}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Second Staff</Label>
                  <Select value={swap.secondUserId} onValueChange={(value) => setSwap((current) => ({ ...current, secondUserId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Assigned staff" /></SelectTrigger>
                    <SelectContent>{(secondSwapShift?.assignedUsers || []).map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2"><Button type="submit" variant="outline" disabled={isSaving}>Swap Shifts</Button></div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-[#1a52c5]" />
              Today's Active Shifts
            </CardTitle>
            <Button variant="outline" onClick={loadShiftData} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={handleStartActiveShift} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Staff</Label>
              <Select value={startShiftForm.staffId} onValueChange={(value) => setStartShiftForm((current) => ({ ...current, staffId: value }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  {staffMembers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name} - {member.position}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={startShiftForm.branchId} onValueChange={(value) => setStartShiftForm((current) => ({ ...current, branchId: value }))}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branchOptions.map((branch: any) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Opening Balance</Label>
              <Input type="number" min="0" value={startShiftForm.openingBalance} onChange={(event) => setStartShiftForm((current) => ({ ...current, openingBalance: event.target.value }))} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isSaving} className="w-full">Start Active Shift</Button>
            </div>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Start Time</TableHead>
                <TableHead>Opening Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeToday.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-slate-500">No active shifts for today.</TableCell></TableRow>
              ) : activeToday.map((shift) => (
                <TableRow key={shift.id}>
                  <TableCell className="font-medium">{shift.staff?.name || "Staff"}</TableCell>
                  <TableCell>{shift.branch?.name || getBranchName(shift.branchId)}</TableCell>
                  <TableCell>{new Date(shift.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell>Rs. {Number(shift.openingBalance || 0).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline" className={statusClass(shift.status)}>{shift.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-[#1a52c5]" />
            Scheduled Shifts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Assigned Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[56px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleScheduledShifts.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-slate-500">No scheduled shifts found.</TableCell></TableRow>
              ) : visibleScheduledShifts.map((shift) => (
                <TableRow key={shift.id}>
                  <TableCell>{shift.date}</TableCell>
                  <TableCell className="font-medium">{shift.name}</TableCell>
                  <TableCell>{shift.startTime} - {shift.endTime}</TableCell>
                  <TableCell>{shift.branchName || getBranchName(shift.branchId)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {shift.assignedUsers.length === 0 ? (
                        <span className="text-sm text-slate-500">Unassigned</span>
                      ) : shift.assignedUsers.map((user) => (
                        <Badge key={user.id} variant="outline" className="border-slate-200 bg-white text-slate-700">
                          <Users className="mr-1 h-3 w-3" />{user.name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={statusClass(shift.status)}>{shift.status}</Badge></TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => handleDeleteShift(shift.id)} disabled={isSaving} aria-label="Delete shift">
                      <Trash2 className="h-4 w-4 text-slate-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ShiftManagement;
