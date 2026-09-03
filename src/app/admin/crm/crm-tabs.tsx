// ═══════════════════════════════════════════════════════════════════════
// Las dos mitades del CRM: los prospectos y los textos que se les mandan.
//
// Van como pestañas y no como dos items del menú lateral porque son la
// misma herramienta: se escribe un texto para usarlo con los prospectos de
// al lado, y el menú de /admin ya tiene 28 entradas. Además el `isActive`
// del sidebar empareja por segmento, así que /admin/crm/textos deja
// encendido "CRM de ventas" — que es justo lo correcto.
//
// Sin "use client": no hay estado ni hooks. Cuál está activa la dice quien
// la monta, no `usePathname` — así el servidor pinta la pestaña correcta
// desde el primer byte y no hay un parpadeo al hidratar.
// ═══════════════════════════════════════════════════════════════════════
import Link from "next/link";

const PESTANAS = [
  { id: "prospectos", href: "/admin/crm", label: "Prospectos" },
  { id: "textos", href: "/admin/crm/textos", label: "Mis textos" },
] as const;

export function CrmTabs({ activo }: { activo: "prospectos" | "textos" }) {
  return (
    <nav className="tabs-new" style={{ marginBottom: 18 }} aria-label="Secciones del CRM">
      {PESTANAS.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          className={`tab-new${p.id === activo ? " tab-new--active" : ""}`}
          style={{ textDecoration: "none" }}
          aria-current={p.id === activo ? "page" : undefined}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
