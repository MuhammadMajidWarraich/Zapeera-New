import BusinessDashboard from "../BusinessDashboard";
import HotelDashboard from "./HotelDashboard";
import ClinicDashboard from "./ClinicDashboard";
import PharmacyExtras from "./PharmacyExtras";
import RetailExtras from "./RetailExtras";
import { useWorkspaceCompany } from "./useWorkspaceCompany";

// ─── Workspace dashboard composition (2026-10-22) ────────────────────
// The workspace dashboard is composed BY BUSINESS TYPE: a hotel gets
// the front-desk dashboard (occupancy / arrivals / folios), a clinic
// the OPD dashboard, a pharmacy the proven sales core PLUS pharmacy
// extras (prescriptions, expiry, reorder), a retail store the sales
// core PLUS retail extras (top variants, stock takes). Departmental
// stores and any custom/unknown type get the generic sales core —
// unchanged behaviour.
const WorkspaceDashboard = () => {
  const { businessType } = useWorkspaceCompany();

  switch (businessType) {
    case "HOTEL":
      return <HotelDashboard />;
    case "CLINIC":
      return <ClinicDashboard />;
    case "PHARMACY":
      return (
        <>
          <BusinessDashboard />
          <PharmacyExtras />
        </>
      );
    case "RETAIL_STORE":
      return (
        <>
          <BusinessDashboard />
          <RetailExtras />
        </>
      );
    default:
      return <BusinessDashboard />;
  }
};

export default WorkspaceDashboard;
