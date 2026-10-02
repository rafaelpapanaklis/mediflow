import { suplantacionDeEstaPeticion } from "@/lib/admin/suplantacion";
import { HoraLocal } from "./aviso-suplantacion-hora";

/**
 * Barra de «Ver como clínica» (ws1-t11). Solo aparece en el navegador del admin
 * de plataforma que entró con el botón de /admin: la sesión de esta petición
 * está en admin_impersonation_sessions. El dueño y su equipo nunca la ven (sus
 * sesiones no están en esa tabla). Dice hasta cuándo dura y lleva de vuelta a
 * /admin cerrando solo la sesión de suplantación.
 */
export async function AvisoSuplantacion({ clinicName }: { clinicName: string }) {
  const s = await suplantacionDeEstaPeticion();
  if (!s) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "8px 16px", background: "#f59e0b", color: "#1f1300", fontSize: 13, fontWeight: 600,
      }}
    >
      <span>
        Estás viendo como «{clinicName}» (soporte de {s.adminEmail}). La clínica no ve nada de lo que hagas aquí.
        {" "}La sesión se cierra sola a las <HoraLocal fecha={new Date(s.expiresAt).toISOString()} />.
      </span>
      <form method="POST" action="/api/admin/impersonate/salir">
        <button
          type="submit"
          style={{
            padding: "4px 12px", borderRadius: 6, border: "1px solid #1f1300", background: "#1f1300",
            color: "#fef3c7", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          Salir y volver a /admin
        </button>
      </form>
    </div>
  );
}
