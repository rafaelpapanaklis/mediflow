import Link from "next/link";
import { CardNew } from "@/components/ui/design-system/card-new";
import type { TFunction } from "@/i18n/t";
import type { OrdersNotice } from "@/lib/barber/tienda-avisos";
import { fmtMoney } from "./format";

/** A dónde lleva «Ver pedidos»: Productos, ya en la pestaña «Pedidos». */
export const PEDIDOS_HREF = "/barber/productos?tab=pedidos";

/**
 * Inicio — «N pedidos de la tienda por atender» (16-nov-2026: «¿dónde le
 * llega al dueño?»). Los 3 más recientes con folio, cliente, total y si ya
 * está pagado en línea o paga en la barbería, y un solo botón a Productos →
 * Pedidos. Sin pedidos por atender NO se pinta nada.
 *
 * Componente de servidor, sin estado: el aviso ya viene resuelto (permiso,
 * plan, sede y la regla única de tienda-core.ts) en loadOrdersNotice.
 */
export function PedidosCard({ notice, t }: { notice: OrdersNotice | null | undefined; t: TFunction }) {
  if (!notice || notice.count <= 0) return null;
  const k = (key: string, vars?: Record<string, string | number>) => t(`barber.inicio.orders.${key}`, vars);
  const more = notice.count - notice.recent.length;
  return (
    <div data-pedidos-por-atender={notice.count}>
      <CardNew title={k("title", { count: notice.count })}>
        <ul className="bdash-upcoming bdash-orders" aria-label={k("listLabel")}>
          {notice.recent.map((o) => (
            <li key={o.id} className="bdash-upcoming__row bdash-orders__row" data-pedido={o.folio}>
              <span className="bdash-orders__folio">{o.folio}</span>
              <div className="bdash-row__main">
                <div className="bdash-row__name">{o.clientName}</div>
                <div className="bdash-row__meta">
                  <span className={o.paidOnline ? "bdash-orders__pay bdash-orders__pay--paid" : "bdash-orders__pay"}>
                    {k(o.paidOnline ? "paidOnline" : "payAtShop")}
                  </span>
                  {o.status === "READY" ? ` · ${k("ready")}` : ""}
                </div>
              </div>
              <span className="bdash-row__n">{fmtMoney(o.total)}</span>
            </li>
          ))}
        </ul>
        <div className="bdash-foot bdash-orders__foot">
          <span>{more > 0 ? k("more", { count: more }) : k("hint")}</span>
          <Link href={PEDIDOS_HREF} className="btn-new btn-new--sm barber-btn-primary">
            {k("cta")}
          </Link>
        </div>
      </CardNew>
    </div>
  );
}
