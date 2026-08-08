import React, { useState, useEffect, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Settings as SettingsIcon,
  User,
  Wifi,
  WifiOff,
  Printer,
  Smartphone,
  Monitor,
  Save,
  RefreshCw,
  Upload,
  Edit,
  X,
  Battery,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { apiService } from "@/services/api";
import { config } from "@/lib/config";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

type DeviceIcon = ComponentType<{ className?: string; strokeWidth?: string | number }>;

function ZV3DeviceStat({
  icon: Icon,
  iconClass,
  value,
  label,
}: {
  icon: DeviceIcon;
  iconClass: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl px-4 py-7 transition-colors hover:bg-[#1a52c5]/[0.02]">
      <div className={cn("grid h-12 w-12 place-items-center rounded-[14px]", iconClass)}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
      </div>
      <div className="text-center text-[15px] font-bold text-[#0a1128]">{value}</div>
      <div className="text-center text-xs font-medium text-[#8c95b0]">{label}</div>
    </div>
  );
}

const ZV3_POS_SWITCH =
  "h-6 w-11 shrink-0 border-0 shadow-none data-[state=unchecked]:bg-[#d1d5db] data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#1a52c5] data-[state=checked]:to-[#28c2ce] data-[state=checked]:shadow-[0_2px_8px_rgba(26,82,197,0.25)]";

const Settings = () => {
  const { user } = useAuth();
  const { selectedCompanyId } = useAdmin();
  const [isOnline, setIsOnline] = useState(true);
  const [isEditingBusiness, setIsEditingBusiness] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isEditingPOS, setIsEditingPOS] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [importedSettings, setImportedSettings] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [userProfile, setUserProfile] = useState({
    name: '',
    email: '',
    username: '',
    role: '',
    branchName: ''
  });
  const [originalBusinessSettings, setOriginalBusinessSettings] = useState({
    name: "My Business",
    address: "Block A, Gulberg III, Lahore",
    phone: "+92 42 1234567",
    email: "info@mybusiness.com",
    license: "BUS-LHR-2024-001",
    taxNumber: "1234567890123"
  });
  const [settings, setSettings] = useState({
    business: {
      name: "My Business",
      address: "Block A, Gulberg III, Lahore",
      phone: "+92 42 1234567",
      email: "info@mybusiness.com",
      license: "BUS-LHR-2024-001",
      taxNumber: "1234567890123"
    },
    pos: {
      autoSync: true,
      offlineMode: true,
      receiptPrinter: "EPSON TM-T20II",
      barcodePrinter: "Zebra ZD220",
      defaultTax: 17,
      lowStockAlert: 20,
      expiryAlert: 30
    },
    user: {
      name: userProfile.name || user?.name || "Loading...",
      email: userProfile.email || "Loading...",
      role: userProfile.role || user?.membership?.roleName || user?.role || "Loading...",
      deviceId: "TABLET-001",
      lastLogin: "2024-01-15 10:30 AM"
    },
    security: {
      autoLogout: 30,
      requirePin: true,
      encryptData: true,
      backupEnabled: true,
      auditLog: true
    },
    notifications: {
      lowStock: true,
      expiry: true,
      sales: false,
      sync: true,
      errors: true
    }
  });

  const deviceStatus = {
    connectivity: isOnline ? "Online" : "Offline",
    lastSync: "2 minutes ago",
    storage: "2.3 GB / 32 GB",
    battery: "78%",
    printer: "Connected"
  };

  useEffect(() => {
    loadSettings();
    loadUserProfile();
  }, []);

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  const loadUserProfile = async () => {
    try {
      const response = await apiService.getProfile();
      if (response.success && response.data) {
        setUserProfile({
          name: response.data.name,
          email: response.data.email,
          username: response.data.username,
          role: response.data.role,
          branchName: response.data.branch?.name || 'Unknown Branch'
        });
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      // Fallback to auth context data
      if (user) {
        setUserProfile({
          name: user.name,
          email: 'N/A',
          username: 'N/A',
          role: user.membership?.roleName || user.role,
          branchName: 'Unknown Branch'
        });
      }
    }
  };

  const handlePOSEdit = () => {
    setIsEditingPOS(true);
  };

  const handlePOSSave = async () => {
    try {
      // POS settings caching disabled

      // Also save to a global variable for easy access in POS
      (window as any).globalPOSSettings = settings.pos;

      // Dispatch a custom event to notify other components about settings change
      window.dispatchEvent(new CustomEvent('posSettingsUpdated', {
        detail: settings.pos
      }));

      setIsEditingPOS(false);
      console.log('POS settings saved:', settings.pos);

      // Show success message
      toast({
        title: "Settings Saved",
        description: `POS settings saved successfully! Tax rate set to ${settings.pos.defaultTax}%`,
        variant: "success",
      });
    } catch (error) {
      console.error('Error saving POS settings:', error);
      toast({
        title: "Error",
        description: "Error saving settings. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePOSCancel = () => {
    setIsEditingPOS(false);
    // Reload settings from localStorage or reset to default
    loadSettings();
  };

  const handleSettingChange = (section: string, key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [key]: value
      }
    }));
  };

  const loadSettings = async () => {
    try {
      // Settings caching disabled - load directly from backend
      const settingsHeaders: any = {};
      if (selectedCompanyId) settingsHeaders['X-Business-ID'] = selectedCompanyId;

      const settingsResponse = await fetch(`${config.api.baseUrl}/settings`, {
        headers: settingsHeaders,
        credentials: 'include',
      });

      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();
        if (settingsData.success && settingsData.data) {
          setSettings(prev => ({
            ...prev,
            pos: {
              ...prev.pos,
              defaultTax: parseFloat(settingsData.data.defaultTax) || 17,
              autoSync: settingsData.data.autoSync === 'true',
              offlineMode: settingsData.data.offlineMode === 'true',
              receiptPrinter: settingsData.data.receiptPrinter || 'EPSON TM-T20II'
            },
            business: {
              ...prev.business,
              name: settingsData.data.businessName || 'My Business',
              address: settingsData.data.businessAddress || 'Block A, Gulberg III, Lahore',
              phone: settingsData.data.businessPhone || '+92 42 1234567',
              email: settingsData.data.businessEmail || 'info@mybusiness.com',
              license: settingsData.data.businessLicense || 'BUS-LHR-2024-001',
              taxNumber: settingsData.data.businessTaxNumber || '1234567890123'
            }
          }));
        }
      }

      // Load user profile
      const profileHeaders: any = {};
      if (selectedCompanyId) profileHeaders['X-Business-ID'] = selectedCompanyId;

      const userResponse = await fetch(`${config.api.baseUrl}/auth/profile`, {
        headers: profileHeaders,
        credentials: 'include',
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        if (userData.success && userData.data) {
          setSettings(prev => ({
            ...prev,
            user: {
              ...prev.user,
              name: userData.data.name || prev.user.name,
              email: userData.data.email || prev.user.email,
              role: userData.data.membership?.roleName || userData.data.role || prev.user.role,
              lastLogin: userData.data.lastLogin || prev.user.lastLogin
            }
          }));
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSyncNow = async () => {
    await Promise.all([loadSettings(), loadUserProfile()]);
    toast({
      title: "Synced",
      description: "Settings and profile have been refreshed.",
    });
  };

  const handleSaveSettings = async () => {
    try {
      const saveHeaders: any = {
        'Content-Type': 'application/json',
      };
      if (selectedCompanyId) saveHeaders['X-Business-ID'] = selectedCompanyId;

      const response = await fetch(`${config.api.baseUrl}/settings`, {
        method: 'PUT',
        headers: saveHeaders,
        credentials: 'include',
        body: JSON.stringify({
          defaultTax: settings.pos.defaultTax,
          lowStockAlert: settings.pos.lowStockAlert,
          expiryAlert: settings.pos.expiryAlert,
          autoSync: settings.pos.autoSync,
          offlineMode: settings.pos.offlineMode,
          receiptPrinter: settings.pos.receiptPrinter,
          businessName: settings.business.name,
          businessAddress: settings.business.address,
          businessPhone: settings.business.phone,
          businessEmail: settings.business.email,
          businessLicense: settings.business.license,
          businessTaxNumber: settings.business.taxNumber
        })
      });

      if (response.ok) {
        toast({
          title: "Settings Saved",
          description: "Settings saved successfully!",
          variant: "success",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: `Failed to save settings: ${error.message}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: "Error",
        description: "Error saving settings. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleExportData = async () => {
    try {
      // Create comprehensive data export
      const exportData = {
        settings: settings,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        business: settings.business
      };

      // Convert to JSON
      const jsonString = JSON.stringify(exportData, null, 2);

      // Create and download file
      const blob = new Blob([jsonString], { type: 'application/json' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `business_backup_${new Date().toISOString().split('T')[0]}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Successful",
        description: "Data exported successfully!",
        variant: "success",
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleImportData = () => {
    // Create file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importedData = JSON.parse(text);

        // Validate imported data
        if (importedData.settings && importedData.business) {
          // Show confirmation modal
          setImportedSettings(importedData);
          setShowImportConfirm(true);
        } else {
          toast({
            title: "Invalid File",
            description: "Invalid backup file format.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Import error:', error);
        toast({
          title: "Import Failed",
          description: "Failed to import data. Please check the file format.",
          variant: "destructive",
        });
      }
    };

    input.click();
  };

  const handleConfirmImport = () => {
    if (importedSettings) {
      setSettings(importedSettings.settings);
      toast({
        title: "Import Successful",
        description: "Data imported successfully!",
        variant: "success",
      });
      setImportedSettings(null);
    }
    setShowImportConfirm(false);
  };

  const handleFactoryReset = () => {
    setShowFactoryResetConfirm(true);
  };

  const handleConfirmFactoryReset = () => {
    // Reset to default settings
    setSettings({
      business: {
        name: "My Business",
        address: "Block A, Gulberg III, Lahore",
        phone: "+92 42 1234567",
        email: "info@mybusiness.com",
        license: "PHR-LHR-2024-001",
        taxNumber: "1234567890123"
      },
      pos: {
        autoSync: true,
        offlineMode: true,
        receiptPrinter: "EPSON TM-T20II",
        barcodePrinter: "Zebra ZD220",
        defaultTax: 17,
        lowStockAlert: 20,
        expiryAlert: 30
      },
      user: {
        name: userProfile.name || user?.name || "Loading...",
        email: userProfile.email || "Loading...",
        role: userProfile.role || user?.membership?.roleName || user?.role || "Loading...",
        deviceId: "TABLET-001",
        lastLogin: "2024-01-15 10:30 AM"
      },
      security: {
        autoLogout: 30,
        requirePin: true,
        encryptData: true,
        backupEnabled: true,
        auditLog: true
      },
      notifications: {
            lowStock: true,
            expiry: true,
            sales: false,
            sync: true,
            errors: true
          }
        });

toast({
          title: "Settings Reset",
          description: "Settings have been reset to default values.",
          variant: "success",
        });
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: "Required fields missing",
        description: "Please fill in all password fields.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match. Please try again.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }

    try {
      const pwdHeaders: any = {
        'Content-Type': 'application/json',
      };
      if (selectedCompanyId) pwdHeaders['X-Business-ID'] = selectedCompanyId;

      const response = await fetch(`${config.api.baseUrl}/auth/change-password`, {
        method: 'POST',
        headers: pwdHeaders,
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      if (response.ok) {
        toast({
          title: "✅ Success",
          description: "Password changed successfully!",
          variant: "success",
          duration: 4000,
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setIsChangingPassword(false);
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: `Failed to change password: ${error.message}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error changing password:', error);
      toast({
        title: "Error",
        description: "Error changing password. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateProfile = async () => {
    try {
      const upHeaders: any = {
        'Content-Type': 'application/json',
      };
      if (selectedCompanyId) upHeaders['X-Business-ID'] = selectedCompanyId;

      const response = await fetch(`${config.api.baseUrl}/auth/update-profile`, {
        method: 'PUT',
        headers: upHeaders,
        credentials: 'include',
        body: JSON.stringify({
          name: settings.user.name,
          email: settings.user.email,
          profileImage: user?.profileImage
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // User data caching disabled

          toast({
            title: "✅ Success",
            description: "Profile updated successfully!",
            variant: "success",
            duration: 2000,
          });
          setIsEditingProfile(false);

          // Safe to reload — auth is handled by httpOnly cookies
          setTimeout(() => window.location.reload(), 1500);
        }
      } else {
        const error = await response.json();
        toast({
          title: "Update Failed",
          description: error.message || "Failed to update profile.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Error",
        description: "Error updating profile. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateProfilePicture = () => {
    // Create file input element for image selection
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid File",
          description: "Please select a valid image file.",
          variant: "destructive",
        });
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Image size must be less than 5MB.",
          variant: "destructive",
        });
        return;
      }

      try {
        // Convert file to base64
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
          const base64String = reader.result as string;

          // Update profile with image
          const picHeaders: any = {
            'Content-Type': 'application/json',
          };
          if (selectedCompanyId) picHeaders['X-Business-ID'] = selectedCompanyId;

          const response = await fetch(`${config.api.baseUrl}/auth/update-profile`, {
            method: 'PUT',
            headers: picHeaders,
            credentials: 'include',
            body: JSON.stringify({
              profileImage: base64String
            })
          });

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              // User data caching disabled

              // Safe to reload — auth is handled by httpOnly cookies
              toast({
                title: "✅ Success",
                description: "Profile picture updated successfully!",
                variant: "success",
                duration: 2000,
              });
              setTimeout(() => window.location.reload(), 1500);
            } else {
              toast({
                title: "Update Failed",
                description: "Failed to update profile picture.",
                variant: "destructive",
              });
            }
          } else {
            toast({
              title: "Update Failed",
              description: "Failed to update profile picture.",
              variant: "destructive",
            });
          }
        };
      } catch (error) {
        console.error('Profile picture update error:', error);
        toast({
          title: "Error",
          description: "Failed to update profile picture. Please try again.",
          variant: "destructive",
        });
      }
    };

    input.click();
  };

  // All dashboard users see the same settings
  return (
    <>
      <div className="min-h-full bg-[#f0f2f7]">
      <div className="px-11 pb-14 pt-9">
        {/* Page header — zapeera-settings.html */}
        <div className="zv3-settings-block mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Settings</h1>
            <p className="text-sm text-[#8c95b0]">Manage your business POS configuration</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleSyncNow}
              className="h-11 gap-2 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-[22px] text-sm font-semibold text-[#4a5578] shadow-none transition-all hover:border-black/10 hover:bg-white hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            >
              <RefreshCw className="h-[17px] w-[17px]" strokeWidth={2} />
              Sync Now
            </Button>
            <Button
              type="button"
              onClick={handleSaveSettings}
              className="h-11 gap-2 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(26,82,197,0.35)]"
            >
              <Save className="h-[17px] w-[17px]" strokeWidth={2} />
              Save Changes
            </Button>
          </div>
        </div>

        {/* Device Status */}
        <section
          className="zv3-settings-block mb-[22px] overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "0ms" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <Monitor className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              Device Status
            </div>
          </div>
          <div className="grid grid-cols-2 gap-0 p-2 sm:grid-cols-3 lg:grid-cols-5">
            <ZV3DeviceStat
              icon={isOnline ? Wifi : WifiOff}
              iconClass={
                isOnline
                  ? "bg-green-600/10 text-green-600"
                  : "bg-amber-500/10 text-amber-600"
              }
              value={deviceStatus.connectivity}
              label="Connection"
            />
            <ZV3DeviceStat
              icon={RefreshCw}
              iconClass="bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]"
              value={deviceStatus.lastSync}
              label="Last Sync"
            />
            <ZV3DeviceStat
              icon={Smartphone}
              iconClass="bg-indigo-500/10 text-indigo-600"
              value={deviceStatus.storage}
              label="Storage"
            />
            <ZV3DeviceStat
              icon={Battery}
              iconClass="bg-amber-500/10 text-amber-600"
              value={deviceStatus.battery}
              label="Battery"
            />
            <ZV3DeviceStat
              icon={Printer}
              iconClass="bg-[rgba(40,194,206,0.12)] text-[#1aa8b3]"
              value={deviceStatus.printer}
              label="Printer"
            />
          </div>
        </section>

        {/* User Profile */}
        <section
          className="zv3-settings-block mb-[22px] overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <User className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              User Profile
            </div>
            <button
              type="button"
              onClick={() => setIsEditingProfile(!isEditingProfile)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent px-4 py-1.5 text-[13px] font-semibold text-[#4a5578] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
            >
              <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
              {isEditingProfile ? "Cancel" : "Edit"}
            </button>
          </div>
          <div className="px-[30px] py-[30px]">
            <div className="mb-6 flex flex-wrap items-center gap-5">
              <div className="relative shrink-0">
                <div className="relative h-16 w-16 overflow-hidden rounded-[18px] shadow-[0_4px_16px_rgba(26,82,197,0.25)]">
                  {user?.profileImage ? (
                    <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-2xl font-extrabold text-white">
                      {(settings.user.name?.charAt(0) || "?").toUpperCase()}
                    </div>
                  )}
                </div>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-[3px] border-white bg-green-600"
                  aria-hidden
                />
                <Button
                  size="icon"
                  className="absolute -right-1 -top-1 h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] p-0 text-white shadow-md hover:opacity-95"
                  onClick={handleUpdateProfilePicture}
                  title="Change profile photo"
                >
                  <Upload className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2.5">
                  <span className="text-lg font-bold text-[#0a1128]">{settings.user.name}</span>
                  <span className="inline-flex rounded-md border border-[rgba(26,82,197,0.1)] bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#1a52c5]">
                    {settings.user.role}
                  </span>
                </div>
                <p className="text-[13px] text-[#8c95b0]">Device: {settings.user.deviceId}</p>
              </div>
            </div>

            {isEditingProfile && (
              <div className="mb-6 space-y-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f0f2f7]/60 p-5">
                <div className="space-y-2">
                  <Label htmlFor="user-name" className="text-sm font-semibold text-[#0a1128]">
                    Full Name
                  </Label>
                  <Input
                    id="user-name"
                    value={settings.user.name}
                    onChange={(e) => handleSettingChange("user", "name", e.target.value)}
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-[#0a1128] transition-all focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-email" className="text-sm font-semibold text-[#0a1128]">
                    Email
                  </Label>
                  <Input
                    id="user-email"
                    type="email"
                    value={settings.user.email || ""}
                    onChange={(e) => handleSettingChange("user", "email", e.target.value)}
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-[#0a1128] transition-all focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleUpdateProfile}
                    className="flex-1 gap-2 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px hover:opacity-95"
                  >
                    <Save className="h-4 w-4" />
                    Save Changes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditingProfile(false)}
                    className="gap-2 rounded-[10px] border-[rgba(15,23,60,0.06)]"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-10 border-t border-[rgba(15,23,60,0.06)] pt-5">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Last Login</div>
                <div className="text-sm font-semibold text-[#0a1128]">{settings.user.lastLogin}</div>
              </div>
              {userProfile.branchName ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Branch</div>
                  <div className="text-sm font-semibold text-[#0a1128]">{userProfile.branchName}</div>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col gap-4 border-t border-[rgba(15,23,60,0.06)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Change Password</h4>
                <p className="text-[13px] text-[#8c95b0]">Update your account password</p>
              </div>
              <button
                type="button"
                onClick={() => setIsChangingPassword(!isChangingPassword)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-5 py-2 text-[13px] font-semibold text-[#4a5578] transition-all hover:border-black/10 hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
              >
                {isChangingPassword ? "Cancel" : "Change"}
              </button>
            </div>

            {isChangingPassword && (
              <div className="mt-5 space-y-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f0f2f7]/60 p-5">
                <div className="space-y-2">
                  <Label htmlFor="current-password" className="text-sm font-semibold text-[#0a1128]">
                    Current Password
                  </Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-sm font-semibold text-[#0a1128]">
                    New Password
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm font-semibold text-[#0a1128]">
                    Confirm New Password
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleChangePassword}
                  className="w-full gap-2 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                >
                  <Save className="h-4 w-4" />
                  Update Password
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* POS Configuration */}
        <section
          className="zv3-settings-block overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "160ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <SettingsIcon className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              POS Configuration
            </div>
            <div className="flex flex-wrap gap-2">
              {!isEditingPOS ? (
                <button
                  type="button"
                  onClick={handlePOSEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent px-4 py-1.5 text-[13px] font-semibold text-[#4a5578] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                >
                  <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                  Edit
                </button>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={handlePOSSave}
                    className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button type="button" onClick={handlePOSCancel} variant="outline" className="rounded-lg border-[rgba(15,23,60,0.06)]">
                    <X className="mr-1 h-4 w-4" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col px-[30px] py-[30px]">
            <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px] first:pt-0">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Auto Sync</h4>
                <p className="text-[13px] text-[#8c95b0]">Automatically sync when online</p>
              </div>
              <Switch
                id="auto-sync"
                className={ZV3_POS_SWITCH}
                checked={settings.pos.autoSync}
                onCheckedChange={(checked) => handleSettingChange("pos", "autoSync", checked)}
                disabled={!isEditingPOS}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Offline Mode</h4>
                <p className="text-[13px] text-[#8c95b0]">Allow operations without internet</p>
              </div>
              <Switch
                id="offline-mode"
                className={ZV3_POS_SWITCH}
                checked={settings.pos.offlineMode}
                onCheckedChange={(checked) => handleSettingChange("pos", "offlineMode", checked)}
                disabled={!isEditingPOS}
              />
            </div>
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px] last:border-b-0">
              <Label htmlFor="receipt-printer" className="mb-2 block text-sm font-bold text-[#0a1128]">
                Receipt Printer
              </Label>
              <Input
                id="receipt-printer"
                value={settings.pos.receiptPrinter}
                onChange={(e) => handleSettingChange("pos", "receiptPrinter", e.target.value)}
                disabled={!isEditingPOS}
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
            </div>
            <div className="py-[18px]">
              <Label htmlFor="default-tax" className="mb-2 block text-sm font-bold text-[#0a1128]">
                Default Tax (%)
              </Label>
              <Input
                id="default-tax"
                type="number"
                value={settings.pos.defaultTax || ""}
                onChange={(e) => handleSettingChange("pos", "defaultTax", parseFloat(e.target.value) || 0)}
                disabled={!isEditingPOS}
                placeholder="Enter tax percentage (e.g., 17 for 17%)"
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                This tax rate will be automatically applied to all sales. Set to 0 for no tax.
              </p>
            </div>
          </div>
        </section>
      </div>

    {/* Import Settings Confirmation Modal */}
    <ConfirmationModal
      isOpen={showImportConfirm}
      onClose={() => { setShowImportConfirm(false); setImportedSettings(null); }}
      onConfirm={handleConfirmImport}
      title="Import Settings"
      description="This will replace your current settings with the imported data. Are you sure you want to continue?"
      confirmText="Import Settings"
      cancelText="Cancel"
      variant="warning"
      icon={<Upload className="w-4 h-4" />}
    />

    {/* Factory Reset Confirmation Modal */}
    <ConfirmationModal
      isOpen={showFactoryResetConfirm}
      onClose={() => setShowFactoryResetConfirm(false)}
      onConfirm={handleConfirmFactoryReset}
      title="Factory Reset"
      description="This will reset ALL settings to default values. This action cannot be undone and will permanently delete all your custom settings. Are you absolutely sure?"
      confirmText="Reset Everything"
      cancelText="Cancel"
      variant="danger"
      isLoading={false}
      icon={<RefreshCw className="w-4 h-4" />}
    />
    </div>
    </>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Settings);