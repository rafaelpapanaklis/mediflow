"use client";

// ═══════════════════════════════════════════════════════════════════════
// /admin/barberias/soporte — bandeja de tickets de TODAS las barberías.
//
// Filtros de estado y prioridad (y categoría / barbería), ordenada por el
// más viejo sin responder: el server pone arriba los que esperan a
// DaleControl, con más espera primero. Fila clicable → hilo del ticket.
//
// API: GET /api/admin/barberias/soporte?status=&priority=&category=&barbershopId=&q=&metrics=1
// Consume BarberSupportTicket / BarberSupportMessage, los MISMOS modelos que
// usa el lado de la barbería. No hay un modelo paralelo de admin.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowLeft, Clock, Hourglass, Inbox, LifeBuoy, Search, Store } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import {
  BARBER_TICKET_CATEGORIES,
  BARBER_TICKET_CATEGORY_LABELS,
  type BarberTicketCategory,
  type BarberTicketPriority,
} from "@/lib/barber/types";
import type { AdminBarberSupportMetrics, AdminBarberTicketRow } from "@/lib/barber/admin";
import {
  TICKET_PRIORITY_FACE,
  TICKET_STATUS_FACE,
  TICKET_STATUS_SEGMENTS,
  formatInt,
  fullDate,
  shortDate,
} from "@/components/admin/barberias/shared";
import "@/components/admin/barberias/barberias.css";

const PRIORITIES: BarberTicketPriority[] = ["HIGH", "NORMAL", "LOW"];

export function AdminBarberSoporteClient({
  initialBarbershopId,
}: {
  initialBarbershopId?: string;
}) {
  const router = useRouter();

  const [status, setStatus] = useState("OPEN");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [barbershopId] = useState(initialBarbershopId ?? "");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [shopQ, setShopQ] = useState("");

  const [tickets, setTickets] = useState<AdminBarberTicketRow[]>([]);
  const [metrics, setMetrics] = useState<AdminBarberSupportMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const fetchSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const seq = ++fetchSeq.current;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (priority) params.set("priority", priority);
        if (category) params.set("category", category);
        if (barbershopId) params.set("barbershopId", barbershopId);
        const term = appliedQ.trim();
        if (term) params.set("q", term);
        params.set("metrics", "1");

        const res = await fetch(`/api/admin/barberias/soporte?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (seq !== fetchSeq.current) return;
        if (res.status === 401) {
          setError(true);
          toast.error("Tu sesión de admin expiró. Vuelve a iniciar sesión.");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (seq !== fetchSeq.current) return;
        setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
        if (data?.metrics) setMetrics(data.metrics);
        setError(false);
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || seq !== fetchSeq.current) return;
        setError(true);
        toast.error("No se pudieron cargar los tickets");
      } finally {
        if (seq === fetchSeq.current) {
          setLoading(false);
          setLoadedOnce(true);
        }
      }
    })();
    return () => controller.abort();
  }, [status, priority, category, barbershopId, appliedQ, refreshKey]);

  // Filtro por barbería: client-side sobre el nombre ya cargado.
  const visible = useMemo(() => {
    const term = shopQ.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((t) => t.barbershopName.toLowerCase().includes(term));
  }, [tickets, shopQ]);

  const hasFilters = Boolean(priority || category || appliedQ.trim() || shopQ.trim());
  const showEmpty = loadedOnce && !loading && !error && tickets.length === 0 && !hasFilters;

  return (
    <div className="dcba">
      <Link href="/admin/barberias" className="dcba-backlink">
        <ArrowLeft size={14} />
        Barberías
      </Link>

      <div className="dcba-head">
        <div>
          <h1 className="dcba-title">Soporte de barberías</h1>
          <p className="dcba-sub">
            Tickets del vertical barber, el más viejo sin responder arriba.
            {barbershopId ? " Filtrado a una sola barbería." : ""}
          </p>
        </div>
        {barbershopId && (
          <Link href="/admin/barberias/soporte" style={{ textDecoration: "none" }}>
            <ButtonNew size="sm" variant="secondary">
              Ver todas las barberías
            </ButtonNew>
          </Link>
        )}
      </div>

      <div className="dcba-kpis">
        <KpiCard label="Abiertos" value={metrics ? formatInt(metrics.open) : "—"} icon={Inbox} hero />
        <KpiCard
          label="Sin responder"
          value={metrics ? formatInt(metrics.pendingReply) : "—"}
          icon={Hourglass}
          tone={metrics && metrics.pendingReply > 0 ? "danger" : undefined}
          hint="Su último mensaje no es nuestro."
        />
        <KpiCard
          label="Sin responder >24h"
          value={metrics ? formatInt(metrics.unanswered24h) : "—"}
          icon={AlertTriangle}
          tone={metrics && metrics.unanswered24h > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Cerrados este mes"
          value={metrics ? formatInt(metrics.closedThisMonth) : "—"}
          icon={Clock}
        />
      </div>

      <div className="dcba-controls">
        <div className="segment-new" style={{ display: "inline-flex", gap: 2, flexWrap: "wrap" }}>
          {TICKET_STATUS_SEGMENTS.map((s) => (
            <button
              key={s.value || "ALL"}
              onClick={() => setStatus(s.value)}
              className={`segment-new__btn ${status === s.value ? "segment-new__btn--active" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select
          className="input-new dcba-control"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          aria-label="Filtrar por prioridad"
        >
          <option value="">Todas las prioridades</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TICKET_PRIORITY_FACE[p].label}
            </option>
          ))}
        </select>

        <select
          className="input-new dcba-control"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {BARBER_TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BARBER_TICKET_CATEGORY_LABELS[c as BarberTicketCategory] ?? c}
            </option>
          ))}
        </select>

        <div className="search-field dcba-control">
          <Search size={14} />
          <input
            placeholder="Asunto…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setAppliedQ(q);
            }}
            aria-label="Buscar por asunto"
          />
        </div>

        <div className="search-field dcba-control">
          <Store size={14} />
          <input
            placeholder="Barbería…"
            value={shopQ}
            onChange={(e) => setShopQ(e.target.value)}
            aria-label="Filtrar por barbería"
          />
        </div>
      </div>

      <CardNew noPad>
        {error && !loading ? (
          <div className="dcba-empty">
            <div className="dcba-empty__icon">
              <AlertTriangle size={20} style={{ color: "var(--danger)" }} />
            </div>
            <div className="dcba-empty__title">No se pudo cargar la bandeja</div>
            <div className="dcba-empty__body">
              Revisa tu conexión o tu sesión de admin e inténtalo otra vez.
            </div>
            <ButtonNew size="sm" variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
              Reintentar
            </ButtonNew>
          </div>
        ) : showEmpty ? (
          <div className="dcba-empty">
            <div className="dcba-empty__icon">
              <LifeBuoy size={20} style={{ color: "var(--text-3)" }} />
            </div>
            <div className="dcba-empty__title">
              {status === "OPEN" ? "No hay tickets abiertos" : "Todavía no hay tickets"}
            </div>
            <div className="dcba-empty__body">
              {status === "OPEN"
                ? "La bandeja está al día. Cuando una barbería escriba, su ticket aparece aquí."
                : "Cuando una barbería escriba a soporte, su ticket aparece aquí."}
            </div>
            {status === "OPEN" && (
              <ButtonNew size="sm" variant="secondary" onClick={() => setStatus("")}>
                Ver todos los tickets
              </ButtonNew>
            )}
          </div>
        ) : (
          <div className="dcba-tablewrap">
            <table
              className="table-new"
              style={{ opacity: loading && loadedOnce ? 0.6 : 1, transition: "opacity .15s" }}
            >
              <thead>
                <tr>
                  <th>Barbería</th>
                  <th>Asunto</th>
                  <th className="dcba-col-wide">Categoría</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Espera</th>
                  <th className="dcba-col-wide">Último mensaje</th>
                </tr>
              </thead>
              <tbody>
                {loading && !loadedOnce
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`skel-${i}`}>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <td key={j} className={j === 2 || j === 6 ? "dcba-col-wide" : undefined}>
                            <span className="skel-new" style={{ width: 110, maxWidth: "100%", height: 12 }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : visible.map((t) => {
                      const go = () => router.push(`/admin/barberias/soporte/${t.id}`);
                      return (
                        <tr
                          key={t.id}
                          className="dcba-row"
                          tabIndex={0}
                          onClick={go}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") go();
                          }}
                        >
                          {/* Acento a la izquierda cuando espera nuestra respuesta. */}
                          <td style={{ borderLeft: `3px solid ${t.needsReply ? "var(--danger)" : "transparent"}` }}>
                            <div className="dcba-ellipsis" style={{ fontSize: 12.5, color: "var(--text-1)", fontWeight: 500 }} title={t.barbershopName}>
                              {t.barbershopName}
                            </div>
                            {t.createdByName && <div className="dcba-note">{t.createdByName}</div>}
                          </td>
                          <td>
                            <div className="dcba-ellipsis" style={{ maxWidth: 280, fontSize: 12, color: "var(--text-2)" }} title={t.subject}>
                              {t.subject}
                            </div>
                            <div className="dcba-note">
                              {formatInt(t.messages)} {t.messages === 1 ? "mensaje" : "mensajes"}
                            </div>
                          </td>
                          <td className="dcba-col-wide">
                            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                              {BARBER_TICKET_CATEGORY_LABELS[t.category as BarberTicketCategory] ?? t.category}
                            </span>
                          </td>
                          <td>
                            <BadgeNew tone={TICKET_PRIORITY_FACE[t.priority].tone}>
                              {TICKET_PRIORITY_FACE[t.priority].label}
                            </BadgeNew>
                          </td>
                          <td>
                            <BadgeNew tone={TICKET_STATUS_FACE[t.status].tone} dot>
                              {TICKET_STATUS_FACE[t.status].label}
                            </BadgeNew>
                          </td>
                          <td>
                            {t.needsReply ? (
                              <BadgeNew tone={t.waitingHours != null && t.waitingHours > 24 ? "danger" : "neutral"}>
                                {t.waitingHours != null ? `${Math.round(t.waitingHours)} h` : "—"}
                              </BadgeNew>
                            ) : (
                              <span style={{ color: "var(--text-3)" }}>—</span>
                            )}
                          </td>
                          <td className="dcba-col-wide">
                            <span className="dcba-nowrap" style={{ fontSize: 12, color: "var(--text-2)" }} title={fullDate(t.lastMessageAt)}>
                              {shortDate(t.lastMessageAt)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                {!loading && visible.length === 0 && !showEmpty && (
                  <tr>
                    <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                      Sin tickets con estos filtros
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>
    </div>
  );
}
