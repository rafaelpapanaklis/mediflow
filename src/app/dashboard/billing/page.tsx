import { redirect } from "next/navigation";

// La página general /dashboard/billing se reconvirtió en "Caja" (/dashboard/caja)
// (WS1-T2). El listado global de facturas vive ahora en la pestaña "Facturas"
// de Caja. Este redirect evita 404 en enlaces/bookmarks viejos.
export default function BillingRedirect() {
  redirect("/dashboard/caja");
}
