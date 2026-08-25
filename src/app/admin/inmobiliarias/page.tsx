export const dynamic = "force-dynamic";

import { AdminInmobiliariasClient } from "./inmobiliarias-client";

/**
 * /admin/inmobiliarias — el vertical INMUEBLES visto desde DaleControl.
 *
 * Cascarón: la guarda de sesión de admin la hace src/app/admin/layout.tsx
 * (tres estados: ok / anónimo / error de BD) y el listado lo consume el
 * cliente contra /api/admin/inmobiliarias, que vuelve a exigir sesión.
 */
export default function AdminInmobiliariasPage() {
  return <AdminInmobiliariasClient />;
}
