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
  //
  // h-dvh, NOT h-screen (bug fix 2026-10-30): 100vh is the LARGE
  // viewport on mobile browsers — with Chrome's URL bar visible the
  // visible area is ~60-110px shorter, so an h-screen column put the
  // sale rail's footer (Cash/Card + Proceed to Payment) below the
  // visible fold on phones, and the scroller below wraps content
  // sized exactly h-full (scrollHeight == clientHeight), so the
  // button could never be scrolled back into view. 100dvh tracks
  // the visible viewport as browser chrome shows/hides; on desktop
  // and in the desktop app it is identical to 100vh.
  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="w-full h-dvh bg-white flex flex-col">
        <div className="flex-1 overflow-auto">
          <CreateInvoice registerLayout />
        </div>
      </div>
    </div>
  );
};

export default POS;
