import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

/**
 * Topbar del panel de inmuebles — espejo de BarberTopbar, más la píldora
 * del MODO de la cuenta.
 *
 * La píldora no es un adorno: los tres modos enseñan menús distintos, así
 * que cuando alguien pregunte "¿por qué yo no tengo Prospectos?", la
 * respuesta está a la vista en su propia pantalla.
 */
export function RealtyTopbar({
  rootLabel,
  accountName,
  modeLabel,
}: {
  rootLabel: string;
  accountName: string;
  modeLabel: string;
}) {
  const crumbs = [rootLabel, accountName];

  return (
    <div className="topbar-new">
      <div className="topbar-new__crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={`${i}-${c}`}>
            {i > 0 && <ChevronRight size={12} style={{ color: "var(--text-4)" }} />}
            <span className={i === crumbs.length - 1 ? "topbar-new__crumb--current" : ""}>
              {c}
            </span>
          </Fragment>
        ))}
      </div>
      <span className="realty-mode-chip">{modeLabel}</span>
    </div>
  );
}
