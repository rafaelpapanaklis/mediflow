import { HoraLocal } from "@/components/dashboard/aviso-suplantacion-hora";

/**
 * Barra de «Ver como barbería» (ws6-t1, 16-nov): la de «Ver como clínica» del
 * dental en el panel /barber. Solo aparece en el navegador del admin de
 * plataforma que entró con el botón de /admin/barberias (la sesión está en
 * barber_admin_impersonation_sessions); el dueño y su equipo nunca la ven.
 * Dice hasta cuándo dura y lleva de vuelta a la ficha cerrando SOLO la sesión
 * de inspección. Server component: el layout ya trae el contexto y los textos.
 */
export function VerComoBarra({
  shopName,
  adminEmail,
  expiresAt,
  labels,
}: {
  shopName: string;
  adminEmail: string;
  expiresAt: string;
  labels: { before: string; middle: string; until: string; exit: string };
}) {
  return (
    <div
      role="status"
      data-ver-como-barberia=""
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 16px",
        background: "var(--warning-soft)",
        borderBottom: "2px solid var(--warning)",
        color: "var(--text-1)",
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.45,
      }}
    >
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {labels.before} «{shopName}» ({labels.middle} {adminEmail}). {labels.until}{" "}
        <HoraLocal fecha={expiresAt} />.
      </span>
      <form method="POST" action="/api/admin/barberias/ver-como/salir">
        <button
          type="submit"
          style={{
            padding: "6px 12px",
            minHeight: 32,
            borderRadius: "var(--radius, 8px)",
            border: "1px solid var(--warning)",
            background: "var(--warning)",
            color: "var(--bg-elev)",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {labels.exit}
        </button>
      </form>
    </div>
  );
}
