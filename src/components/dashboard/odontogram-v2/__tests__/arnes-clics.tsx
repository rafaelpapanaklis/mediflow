/**
 * Arnés de `clics-chromium.test.ts`: el OdontogramV2 de la pestaña, en modo
 * VIVO (autoguardado), con la sesión de la Dra. A. Lo empaqueta esbuild y lo
 * abre Chromium; cada fetch llega a las rutas reales de /api/odontogram.
 */
import { createRoot } from "react-dom/client";
import { OdontogramV2 } from "../App";

createRoot(document.getElementById("root")!).render(
  <OdontogramV2 patientId="pat_1" sesion={{ clinicId: "cli_1", userId: "u_dr" }} />,
);
