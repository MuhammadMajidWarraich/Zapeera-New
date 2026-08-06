import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Clock,
  User,
  Bell,
  Calendar,
  CheckCircle,
  LogIn,
  LogOut,
  FileText,
  AlertCircle,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiService } from '@/services/api';
import { toast } from 'sonner';

interface EmployeePortalProps {
  businessId: string;
  businessName: string;
  membershipId: string;
}

interface AttendanceRecord {
  id: string;
  staffProfileId: string;
  checkIn: string;
  checkOut?: string;
  totalHours?: number;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'LEAVE';
  notes?: string;
  branch: {
    id: string;
    name: string;
  };
  staffProfile: {
    id: string;
    employeeId: string;
    designation: string;
    membership: {
      user: {
        id: string;
        name: string;
      };
    };
  };
}

interface ScheduledShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  date: string;
  branchId: string;
  branchName: string;
  assignedUsers: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  maxUsers: number;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  notes?: string;
}

interface StaffProfile {
  id: string;
  employeeId: string;
  designation: string;
  department?: string;
  salary?: number;
  joiningDate: string;
  status: string;
  isActive: boolean;
  membership: {
    id: string;
    role: { id: string; name: string } | null;
    user: {
      id: string;
      name: string;
      email: string;
      phone?: string;
      profileImage?: string;
    };
    branches: Array<{ id: string; name: string }>;
  };
}

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'PRESENT':
    case 'completed':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-300">{status === 'completed' ? 'Completed' : 'Present'}</Badge>;
    case 'ABSENT':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-200 border-red-300">Absent</Badge>;
    case 'LATE':
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-300">Late</Badge>;
    case 'HALF_DAY':
      return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-300">Half Day</Badge>;
    case 'LEAVE':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-300">Leave</Badge>;
    case 'scheduled':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-300">Scheduled</Badge>;
    case 'active':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-300">Active</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

const EmployeePortal: React.FC<EmployeePortalProps> = ({ businessId, businessName, membershipId }) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');

  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const [attendanceStats, setAttendanceStats] = useState({ present: 0, absent: 0, late: 0, total: 0 });
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShift[]>([]);
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  const staffProfileId = membershipId;

  useEffect(() => {
    loadAllData();
  }, [staffProfileId, businessId]);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        loadTodayAttendance(),
        loadAttendanceHistory(),
        loadScheduledShifts(),
        loadStaffProfile(),
        loadNotifications(),
      ]);
    } catch (err) {
      console.error('Error loading portal data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTodayAttendance = async () => {
    try {
      const response = await apiService.getTodayAttendance(staffProfileId);
      if (response.success && response.data) {
        setTodayAttendance(response.data as unknown as AttendanceRecord);
      } else {
        setTodayAttendance(null);
      }
    } catch {
      setTodayAttendance(null);
    }
  };

  const loadAttendanceHistory = async () => {
    try {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];

      const response = await apiService.getAttendance({
        staffProfileId,
        startDate,
        endDate,
        limit: 31,
      });

      if (response.success && response.data) {
        const data = response.data as any;
        const records = data.attendance || [];
        setAttendanceHistory(records);
        setAttendanceStats({
          present: records.filter((r: AttendanceRecord) => r.status === 'PRESENT').length,
          absent: records.filter((r: AttendanceRecord) => r.status === 'ABSENT').length,
          late: records.filter((r: AttendanceRecord) => r.status === 'LATE').length,
          total: records.length,
        });
      }
    } catch {
      setAttendanceHistory([]);
    }
  };

  const loadScheduledShifts = async () => {
    try {
      const response = await apiService.getScheduledShifts();
      if (response.success && response.data) {
        const allShifts = response.data as unknown as ScheduledShift[];
        const myShifts = allShifts.filter(shift =>
          shift.assignedUsers.some(u => u.id === user?.id)
        );
        setScheduledShifts(myShifts);
      }
    } catch {
      setScheduledShifts([]);
    }
  };

  const loadStaffProfile = async () => {
    try {
      const response = await apiService.getStaffMember(staffProfileId);
      if (response.success && response.data) {
        setStaffProfile(response.data as unknown as StaffProfile);
      }
    } catch {
      setStaffProfile(null);
    }
  };

  const loadNotifications = async () => {
    try {
      const response = await apiService.getNotifications({
        businessId,
        limit: 10,
      });
      if (response.success && response.data) {
        const data = response.data as any;
        setNotifications(data.notifications || []);
      }
    } catch {
      setNotifications([]);
    }
  };

  const handleCheckIn = async () => {
    const branchId = user?.membership?.branchIds?.[0] || user?.branchId || '';
    if (!branchId) {
      toast.error('No branch assigned', { description: 'Please contact your manager.' });
      return;
    }

    try {
      setIsChecking(true);
      const response = await apiService.checkIn({ staffProfileId, branchId });
      if (response.success && response.data) {
        setTodayAttendance(response.data as unknown as AttendanceRecord);
        toast.success('Checked in successfully!');
      } else {
        toast.error(response.message || 'Failed to check in');
      }
    } catch {
      toast.error('Failed to check in');
    } finally {
      setIsChecking(false);
    }
  };

  const handleCheckOut = async () => {
    if (!todayAttendance?.id) return;

    try {
      setIsChecking(true);
      const response = await apiService.checkOut({ attendanceId: todayAttendance.id });
      if (response.success && response.data) {
        setTodayAttendance(response.data as unknown as AttendanceRecord);
        toast.success('Checked out successfully!');
      } else {
        toast.error(response.message || 'Failed to check out');
      }
    } catch {
      toast.error('Failed to check out');
    } finally {
      setIsChecking(false);
    }
  };

  const isCheckedIn = !!todayAttendance && !todayAttendance.checkOut;
  const userName = user?.name || staffProfile?.membership?.user?.name || 'Employee';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{businessName}</h1>
        <p className="text-muted-foreground">Employee Portal</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dashboard" className="text-xs md:text-sm">
            <CheckCircle className="h-4 w-4 mr-1 hidden md:block" />Dashboard
          </TabsTrigger>
          <TabsTrigger value="attendance" className="text-xs md:text-sm">
            <Clock className="h-4 w-4 mr-1 hidden md:block" />Attendance
          </TabsTrigger>
          <TabsTrigger value="shifts" className="text-xs md:text-sm">
            <Calendar className="h-4 w-4 mr-1 hidden md:block" />Shifts
          </TabsTrigger>
          <TabsTrigger value="profile" className="text-xs md:text-sm">
            <User className="h-4 w-4 mr-1 hidden md:block" />Profile
          </TabsTrigger>
          <TabsTrigger value="announcements" className="text-xs md:text-sm">
            <Bell className="h-4 w-4 mr-1 hidden md:block" />Updates
          </TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-4">
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
            <CardContent className="p-6">
              <h2 className="text-xl font-semibold">{getGreeting()}, {userName}!</h2>
              <p className="text-muted-foreground mt-1">Here is your daily overview</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Today's Status</CardTitle>
              </CardHeader>
              <CardContent>
                {todayAttendance ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="font-semibold">{todayAttendance.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      In: {formatTime(todayAttendance.checkIn)}
                      {todayAttendance.checkOut && ` | Out: ${formatTime(todayAttendance.checkOut)}`}
                    </p>
                    {todayAttendance.totalHours && (
                      <p className="text-sm text-muted-foreground">{todayAttendance.totalHours}h worked</p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-500" />
                    <span className="text-muted-foreground">Not checked in</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Quick Action</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  size="lg"
                  className="w-full h-12 text-lg"
                  variant={isCheckedIn ? 'destructive' : 'default'}
                  onClick={isCheckedIn ? handleCheckOut : handleCheckIn}
                  disabled={isChecking}
                >
                  {isChecking ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : isCheckedIn ? (
                    <LogOut className="h-5 w-5 mr-2" />
                  ) : (
                    <LogIn className="h-5 w-5 mr-2" />
                  )}
                  {isCheckedIn ? 'Clock Out' : 'Clock In'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming Shift</CardTitle>
              </CardHeader>
              <CardContent>
                {scheduledShifts.filter(s => s.date >= new Date().toISOString().split('T')[0] && s.status === 'scheduled').length > 0 ? (
                  (() => {
                    const nextShift = scheduledShifts
                      .filter(s => s.date >= new Date().toISOString().split('T')[0] && s.status === 'scheduled')
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
                    return (
                      <div className="space-y-1">
                        <p className="font-semibold">{nextShift.name}</p>
                        <p className="text-sm text-muted-foreground">{formatDate(nextShift.date)}</p>
                        <p className="text-sm text-muted-foreground">{nextShift.startTime} - {nextShift.endTime}</p>
                      </div>
                    );
                  })()
                ) : (
                  <p className="text-muted-foreground">No shifts scheduled</p>
                )}
              </CardContent>
            </Card>
          </div>

          {notifications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Recent Announcements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {notifications.slice(0, 3).map(n => (
                  <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Bell className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">{formatDate(n.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Attendance Tab */}
        <TabsContent value="attendance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Today's Attendance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todayAttendance ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      {getStatusBadge(todayAttendance.status)}
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Check In</p>
                      <p className="font-medium">{formatTime(todayAttendance.checkIn)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Check Out</p>
                      <p className="font-medium">{todayAttendance.checkOut ? formatTime(todayAttendance.checkOut) : '--'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Hours</p>
                      <p className="font-medium">{todayAttendance.totalHours ? `${todayAttendance.totalHours}h` : '--'}</p>
                    </div>
                  </div>
                  <Button
                    size="lg"
                    className="w-full md:w-auto h-14 text-lg"
                    variant={isCheckedIn ? 'destructive' : 'default'}
                    onClick={isCheckedIn ? handleCheckOut : handleCheckIn}
                    disabled={isChecking}
                  >
                    {isChecking ? (
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    ) : isCheckedIn ? (
                      <LogOut className="h-5 w-5 mr-2" />
                    ) : (
                      <LogIn className="h-5 w-5 mr-2" />
                    )}
                    {isCheckedIn ? 'Clock Out' : 'Clock In'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertCircle className="h-5 w-5" />
                    <span>You haven't checked in today</span>
                  </div>
                  <Button
                    size="lg"
                    className="w-full md:w-auto h-14 text-lg"
                    onClick={handleCheckIn}
                    disabled={isChecking}
                  >
                    {isChecking ? (
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    ) : (
                      <LogIn className="h-5 w-5 mr-2" />
                    )}
                    Clock In
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Monthly Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 rounded-lg bg-green-50">
                  <p className="text-2xl font-bold text-green-600">{attendanceStats.present}</p>
                  <p className="text-sm text-muted-foreground">Present</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-red-50">
                  <p className="text-2xl font-bold text-red-600">{attendanceStats.absent}</p>
                  <p className="text-sm text-muted-foreground">Absent</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-yellow-50">
                  <p className="text-2xl font-bold text-yellow-600">{attendanceStats.late}</p>
                  <p className="text-sm text-muted-foreground">Late</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Attendance History</CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>In</TableHead>
                      <TableHead>Out</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceHistory.map(record => (
                      <TableRow key={record.id}>
                        <TableCell className="text-sm">{formatDate(record.checkIn)}</TableCell>
                        <TableCell>{getStatusBadge(record.status)}</TableCell>
                        <TableCell className="text-sm">{formatTime(record.checkIn)}</TableCell>
                        <TableCell className="text-sm">{record.checkOut ? formatTime(record.checkOut) : '--'}</TableCell>
                        <TableCell className="text-sm">{record.totalHours ? `${record.totalHours}h` : '--'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">No attendance records this month</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Shifts Tab */}
        <TabsContent value="shifts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                My Shifts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scheduledShifts.length > 0 ? (
                <div className="space-y-3">
                  {scheduledShifts
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map(shift => {
                      const isToday = shift.date === new Date().toISOString().split('T')[0];
                      const isPast = new Date(shift.date) < new Date(new Date().toDateString());
                      return (
                        <div
                          key={shift.id}
                          className={`flex items-center justify-between p-4 rounded-lg border ${isToday ? 'border-primary bg-primary/5' : 'bg-card'} ${isPast ? 'opacity-60' : ''}`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{shift.name}</p>
                              {isToday && <Badge variant="default">Today</Badge>}
                              {getStatusBadge(shift.status)}
                            </div>
                            <p className="text-sm text-muted-foreground">{formatDate(shift.date)}</p>
                            <p className="text-sm text-muted-foreground">
                              {shift.startTime} - {shift.endTime} | {shift.branchName}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No shifts assigned</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Personal Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              {staffProfile ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Name</p>
                      <p className="font-medium">{staffProfile.membership.user.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p className="font-medium">{staffProfile.membership.user.email || '--'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p className="font-medium">{staffProfile.membership.user.phone || '--'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Branch</p>
                      <p className="font-medium">{staffProfile.membership.branches.map(b => b.name).join(', ') || '--'}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">Profile data unavailable</p>
              )}
            </CardContent>
          </Card>

          {staffProfile && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  HR Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Employee ID</p>
                    <p className="font-medium">{staffProfile.employeeId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Designation</p>
                    <p className="font-medium">{staffProfile.designation}</p>
                  </div>
                  {staffProfile.department && (
                    <div>
                      <p className="text-sm text-muted-foreground">Department</p>
                      <p className="font-medium">{staffProfile.department}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Joining Date</p>
                    <p className="font-medium">{formatDate(staffProfile.joiningDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={staffProfile.isActive ? 'default' : 'destructive'}>
                      {staffProfile.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Role</p>
                    <p className="font-medium">{staffProfile.membership.role?.name || '--'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notifications & Announcements
              </CardTitle>
            </CardHeader>
            <CardContent>
              {notifications.length > 0 ? (
                <div className="space-y-3">
                  {notifications.map(notification => (
                    <div
                      key={notification.id}
                      className={`p-4 rounded-lg border ${!notification.read ? 'bg-primary/5 border-primary/20' : 'bg-card'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{notification.title}</p>
                            {!notification.read && (
                              <span className="h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{notification.body}</p>
                          <p className="text-xs text-muted-foreground mt-2">{formatDate(notification.createdAt)}</p>
                        </div>
                        {getStatusBadge(notification.type)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No notifications</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EmployeePortal;
