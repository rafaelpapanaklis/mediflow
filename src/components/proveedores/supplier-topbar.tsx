import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

export function SupplierTopbar({ businessName }: { businessName: string }) {
  const crumbs = ["Proveedor", businessName];

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
    </div>
  );
}
