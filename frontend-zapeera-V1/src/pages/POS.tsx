import CreateInvoice from "@/pages/CreateInvoice";
import { useEffect } from "react";

const POS = () => {
  useEffect(() => {
    // Prevent background scrolling when POS modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  // POS redesign: the register carries its own dark POS header bar
  // (branding, cashier context, clock, register actions) inside
  // CreateInvoice's register layout — this shell is just the
  // full-screen frame. The bar's Back button exits to the dashboard.
  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="w-full h-screen bg-white flex flex-col">
        <div className="flex-1 overflow-auto">
          <CreateInvoice registerLayout />
        </div>
      </div>
    </div>
  );
};

export default POS;
