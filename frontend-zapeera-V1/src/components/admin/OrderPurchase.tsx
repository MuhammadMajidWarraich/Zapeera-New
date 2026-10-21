import Purchases from "@/pages/Purchases";

// Order Purchase (Roadmap A10)
//
// This route used to render a low-stock workspace that restocked batches
// and generated purchase-order PDFs locally without ever persisting a
// purchase order — while the real purchase system (list/create/edit over
// the /purchases API) lived on the Purchases page. Two divergent surfaces
// for one job is how the update-contract mismatch happened (the page sent
// line items the backend update schema rejected).
//
// The fix is one coherent surface: Order Purchase IS the Purchases module —
// the same API-backed list/create/edit/delete experience, including the
// A10 line-replacement contract on update (the backend reconciles the
// stock of replaced lines). Printing is available from a saved purchase's
// detail view; nothing here fabricates an unsaved PO document any more.
const OrderPurchase = () => <Purchases />;

export default OrderPurchase;
