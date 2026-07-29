import {
  LayoutDashboard,
  Building2,
  Users,
  ShirtIcon as Shirt,
  Puzzle,
  FileStack,
  Shield,
  DollarSign,
  HeadphonesIcon,
  Activity,
  ScrollText,
  FileText,
  Settings,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';
import { BackofficeRole, hasPermission } from '../permissions';

export interface NavSection {
  title: string;
  items: NavItem[];
}

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission?: string;
  badge?: string;
}

export function getNavigation(role: BackofficeRole): NavSection[] {
  const can = (perm: string) => hasPermission(role, perm);

  return [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', path: '/backoffice/dashboard', icon: LayoutDashboard, permission: 'dashboard.read' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Tenant Management',
      items: [
        { label: 'Businesses', path: '/backoffice/businesses', icon: Building2, permission: 'business.read' },
        { label: 'Users', path: '/backoffice/users', icon: Users, permission: 'user.read' },
        { label: 'Memberships', path: '/backoffice/memberships', icon: Shirt, permission: 'business.read' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Platform',
      items: [
        { label: 'Business Types', path: '/backoffice/business-types', icon: FileStack, permission: 'business-type.manage' },
        { label: 'Modules', path: '/backoffice/modules', icon: Puzzle, permission: 'module.manage' },
        { label: 'Plans', path: '/backoffice/plans', icon: DollarSign, permission: 'plan.manage' },
        { label: 'Roles', path: '/backoffice/roles', icon: Shield, permission: 'role.manage' },
        { label: 'Feature Flags', path: '/backoffice/feature-flags', icon: Settings, permission: 'feature-flags.manage' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Finance',
      items: [
        { label: 'Finance Dashboard', path: '/backoffice/finance', icon: DollarSign, permission: 'finance.read' },
        { label: 'Payment Proofs', path: '/backoffice/payment-proofs', icon: FileText, permission: 'finance.read' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Support',
      items: [
        { label: 'Support Dashboard', path: '/backoffice/support', icon: HeadphonesIcon, permission: 'support.read' },
        { label: 'Tickets', path: '/backoffice/support/tickets', icon: HeadphonesIcon, permission: 'support.manage' },
        { label: 'Announcements', path: '/backoffice/announcements', icon: FileText, permission: 'support.manage' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Monitoring',
      items: [
        { label: 'System Health', path: '/backoffice/monitoring', icon: Activity, permission: 'monitoring.read' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Audit',
      items: [
        { label: 'Audit Logs', path: '/backoffice/audit', icon: ScrollText, permission: 'audit.read' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Content',
      items: [
        { label: 'Content Manager', path: '/backoffice/content', icon: FileText, permission: 'content.manage' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'System',
      items: [
        { label: 'Settings', path: '/backoffice/settings', icon: Settings, permission: 'settings.manage' },
        { label: 'System Overview', path: '/backoffice/system', icon: Settings, permission: 'system.manage' },
      ].filter(i => !i.permission || can(i.permission)),
    },
    {
      title: 'Profile',
      items: [
        { label: 'My Profile', path: '/backoffice/profile', icon: UserCircle },
      ],
    },
  ].filter(section => section.items.length > 0);
}
