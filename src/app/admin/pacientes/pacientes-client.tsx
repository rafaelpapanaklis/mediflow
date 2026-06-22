"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Contact, Search, Building2, CalendarDays, ShieldCheck, ChevronLeft, ChevronRight, Layers,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { formatRelativeDate } from "@/lib/format";
import type { PacientesPage } from "@/lib/admin/pacientes";

export function PacientesClient({ data }: { data: PacientesPage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(data.search);
  // Evita disparar el push del debounce en el primer render (cuando el input ya
  // refleja lo que vino del server).
  const lastPushed = useRef(data.search);

  // Mantén el input en sync si el server devuelve otra búsqueda (navegación atrás).
  useEffect(() => {
    setSearch(data.search);
    lastPushed.current = data.search;
  }, [data.search]);

  // Debounce de la búsqueda → navega a ?q=...&page=1 (búsqueda server-side).
  useEffect(() => {
    const q = search.trim();
    if (q === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = q;
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      startTransition(() => {
        router.push(`/admin/pacientes${params.toString() ? `?${params.toString()}` : ""}`);
      });
    }, 350);
    return () => clearTimeout(t);
  }, [search, router]);

  function goToPage(p: number) {
    const params = new URLSearchParams();
    if (data.search) params.set("q", data.search);
    if (p > 1) params.set("page", String(p));
    startTransition(() => {
      router.push(`/admin/pacientes${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }

  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Pacientes
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: "4px 0 0", maxWidth: 620 }}>
            Base de datos global de personas que han agendado en cualquier clínica, agrupadas por
            identidad (correo o teléfono). Cruza datos de todas las clínicas — solo visible para el
            administrador de la plataforma.
          </p>
        </div>
      </div>

      {/* Buscador */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 280px", minWidth: 220, maxWidth: 460 }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }}
          />
          <input
            className="input-new"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono…"
            style={{ width: "100%", paddingLeft: 30 }}
            aria-label="Buscar pacientes"
          />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-3)", opacity: pending ? 1 : 0.85 }}>
          {pending ? "Buscando…" : `${data.total} ${data.total === 1 ? "persona" : "personas"}`}
        </span>
      </div>

      {/* Tabla */}
      <CardNew noPad>
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Cuenta DaleControl</th>
                <th>Clínicas</th>
                <th>Citas</th>
                <th>Última cita</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AvatarNew name={p.name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <Link
                          href={`/admin/pacientes/${p.id}`}
                          style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none", display: "block" }}
                        >
                          {p.name}
                        </Link>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {p.email || p.phone || "Sin contacto"}
                        </div>
                        {p.email && p.phone && (
                          <div style={{ fontSize: 10, color: "var(--text-4)" }}>{p.phone}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.hasAccount ? (
                      <BadgeNew tone={p.accountVerified ? "success" : "warning"} dot>
                        {p.accountVerified ? "Verificada" : "Sin verificar"}
                      </BadgeNew>
                    ) : (
                      <BadgeNew tone="neutral">Solo invitada</BadgeNew>
                    )}
                  </td>
                  <td>
                    <BadgeNew tone={p.clinicsCount > 1 ? "brand" : "neutral"}>
                      {p.clinicsCount} {p.clinicsCount === 1 ? "clínica" : "clínicas"}
                    </BadgeNew>
                  </td>
                  <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                    {p.appointmentsCount}
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {p.lastAppointment ? formatRelativeDate(p.lastAppointment) : "—"}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    {data.search
                      ? "Sin pacientes que coincidan con la búsqueda"
                      : "Aún no hay pacientes registrados"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardNew>

      {/* Pie: rango + paginación */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-3)", fontSize: 12 }}>
          <Layers size={13} />
          {data.total > 0 ? `${from}–${to} de ${data.total}` : "0 resultados"}
        </div>
        {data.totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-new btn-new--secondary btn-new--sm"
              disabled={data.page <= 1 || pending}
              onClick={() => goToPage(data.page - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
              {data.page} / {data.totalPages}
            </span>
            <button
              type="button"
              className="btn-new btn-new--secondary btn-new--sm"
              disabled={data.page >= data.totalPages || pending}
              onClick={() => goToPage(data.page + 1)}
              aria-label="Página siguiente"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Leyenda de columnas (accesibilidad/contexto) */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "var(--text-4)", fontSize: 11 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Contact size={12} /> Persona = expedientes agrupados por identidad
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <ShieldCheck size={12} /> Cuenta = registro en el portal del paciente
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Building2 size={12} /> Clínicas donde agendó
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <CalendarDays size={12} /> Citas totales
        </span>
      </div>
    </div>
  );
}
