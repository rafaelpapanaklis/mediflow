import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";

/**
 * Topbar del panel barber — espejo de LabTopbar (crumbs simples).
 * `branch` es el rótulo de la sede activa (BarberBranchBadge): se pinta a la
 * derecha de las migas y solo existe en cadenas con más de una sede.
 */
export function BarberTopbar({
  rootLabel,
  shopName,
  branch,
}: {
  rootLabel: string;
  shopName: string;
  branch?: ReactNode;
}) {
  const crumbs = [rootLabel, shopName];

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
      {branch}
    </div>
  );
}
