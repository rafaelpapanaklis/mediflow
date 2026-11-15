import Link from "next/link";
import type { TiendaBranch, TiendaProduct } from "@/lib/barber/tienda";
import { rutaProductoTienda } from "@/lib/barber/tienda-core";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Precio en MXN (mismo formato que el panel). */
export function precioMx(n: number): string {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function branchLabel(b: Pick<TiendaBranch, "name" | "branchName">): string {
  return b.branchName ? `${b.name} · ${b.branchName}` : b.name;
}

/**
 * Las tarjetas de la tienda pública (sin estado: sirve en servidor). `t` es
 * el t() del vertical con prefijo `barber.tienda.`.
 */
export function TiendaGrid({
  products,
  slug,
  branches,
  showBranch,
  t,
}: {
  products: TiendaProduct[];
  slug: string;
  branches: TiendaBranch[];
  showBranch: boolean;
  t: T;
}) {
  const byId = new Map(branches.map((b) => [b.id, b]));
  return (
    <div className="dct-grid" data-tienda-rejilla>
      {products.map((p) => {
        const cls = p.tag === "out" ? "dct-tag dct-tag--out" : p.tag === "low" ? "dct-tag dct-tag--low" : "dct-tag";
        const label = p.tag === "out" ? t("tagOut") : p.tag === "low" ? t("tagLow") : t("tagAvailable");
        const b = byId.get(p.branchId);
        return (
          <Link key={p.id} href={rutaProductoTienda(slug, p.id)} className="dct-card" data-producto={p.id}>
            <div className="dct-photo">
              {p.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photoUrl} alt={p.name} loading="lazy" />
              ) : (
                <div className="dct-ph" aria-hidden="true">{(p.name.trim().charAt(0) || "?").toUpperCase()}</div>
              )}
              <span className={cls}>{label}</span>
            </div>
            <div className="dct-body">
              {p.category ? <span className="dct-cat">{p.category}</span> : null}
              <span className="dct-name">{p.name}</span>
              <span className="dct-price">{precioMx(p.price)}</span>
              {showBranch && b ? <span className="dct-branch">{branchLabel(b)}</span> : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
