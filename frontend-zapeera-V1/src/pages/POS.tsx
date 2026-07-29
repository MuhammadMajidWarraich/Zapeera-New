import CreateInvoice from "@/pages/CreateInvoice";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

const POS = () => {
  const navigate = useNavigate();

  // Close POS modal when component unmounts or navigate back
  const handleClose = () => {
    navigate(-1); // Go back to previous page
  };

  useEffect(() => {
    // Prevent background scrolling when POS modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="w-full h-screen bg-white flex flex-col">
        {/* POS Header */}
        <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-[#1a52c5] to-[#28c2ce] shrink-0">
          <h1 className="text-xl font-bold text-white">Point of Sale</h1>
          <button
            onClick={handleClose}
            className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
            aria-label="Close POS"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* POS Content */}
        <div className="flex-1 overflow-auto">
          <CreateInvoice />
        </div>
      </div>
    </div>
  );
};

export default POS;