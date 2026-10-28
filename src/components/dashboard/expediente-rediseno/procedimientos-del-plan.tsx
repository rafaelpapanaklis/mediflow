"use client";

// «Hecho» desde la TARJETA DEL PLAN (v11, decisión de Rafael, 27-oct-2026): la doctora hizo la resina
// pero no abrió la consulta en el sistema; aquí la marca y en ese momento «Debe» sube (lo hecho − lo
// pagado; con cuotas acordadas sigue mandando la cuota, v10), igual que si la marcara al completar la
// consulta. Con «Deshacer» vuelve a por hacer y la deuda baja.
//
// La acción es la de siempre (PATCH /api/treatments/[id], `marcar_hecho` / `deshacer_hecho`,
// `lib/treatments/aplicar-hecho.server.ts`): bitácora con quién y cuándo, y el odontograma como la
// decisión del 20-oct (con su deshacer exacto). Aquí solo se llama y se avisa a la ficha (`onCambio`),
// que relee cuentas, «Estado de cuenta» y el odontograma sin recargar la página.
//
// Quién: `treatments.edit` (el doctor, en sus planes) o SUPER_ADMIN — lo decide el servidor; `puede`
// solo esconde los botones. Un plan cerrado (Abandonado) no se marca.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CheckCircle2, Circle, RotateCcw } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { fechaPanel } from "@/lib/formato-fecha-panel";
import { avisoDeDeshacer, avisoDeHecho, ayudaHablaDeDebe, deshacerHecho, errorDeHecho, ESTADOS_DE_PLAN_SIN_HECHO, marcarHecho } from "@/lib/treatments/marcar-hecho-cliente";
import { CONDITIONS } from "@/components/dashboard/odontogram-v2/data";
import type { FilaDto } from "@/lib/treatments/items";
import type { PlanConCuenta } from "@/lib/treatments/sin-doble-cobro";
import s from "./expediente.module.css";

/**
 * Las filas de los planes del paciente (GET /api/treatments, `treatments.view`): `planId` → filas.
 * No depende de ver dinero. `clave` cambia cuando la ficha relee los planes.
 */
export function useFilasDePlanes(patientId: string | undefined, clave: unknown): {
  filas: Map<string, FilaDto[]>;
  poner: (planId: string, filas: FilaDto[]) => void;
} {
  const [filas, setFilas] = useState<Map<string, FilaDto[]>>(new Map());
  useEffect(() => {
    if (!patientId) return;
    let vivo = true;
    fetch(`/api/treatments?patientId=${encodeURIComponent(patientId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((planes: Array<{ id: string; items?: FilaDto[] }> | null) => {
        if (!vivo || !Array.isArray(planes)) return;
        setFilas(new Map(planes.map((p) => [p.id, Array.isArray(p.items) ? p.items : []])));
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [patientId, clave]);
  return {
    filas,
    poner: (planId, nuevas) => setFilas((prev) => new Map(prev).set(planId, nuevas)),
  };
}

const nombreDe = (f: Pick<FilaDto, "nombre" | "dientes" | "caras">) =>
  `${f.nombre}${f.dientes.length ? ` ${f.dientes.join(", ")}` : ""}${f.caras.length ? ` (${f.caras.join("")})` : ""}`;

export function ProcedimientosDelPlan({ planId, estadoDelPlan, filas, puede, debeSigueLoHecho = false, onFilas, onCuenta, onCambio }: {
  planId: string;
  estadoDelPlan: string;
  /**
   * v12 (t5, m2): solo si se SABE que el plan cobra lo hecho (cuenta leída y sin cuotas acordadas) la
   * ayuda dice que lo hecho pasa a «Debe». Con cuotas manda la mensualidad (v10) y sin ver dinero no
   * se habla de «Debe»: solo del odontograma.
   */
  debeSigueLoHecho?: boolean;
  filas: FilaDto[] | undefined;
  /** `treatments.edit` o SUPER_ADMIN (el servidor lo vuelve a mirar). */
  puede: boolean;
  /** Las filas como quedaron (la respuesta del servidor), para pintarlas al momento. */
  onFilas: (filas: FilaDto[]) => void;
  /** v14: la cuenta del plan que devuelve el servidor con «Hecho» / «Deshacer»: la ficha la pinta al momento. */
  onCuenta?: (cuenta: PlanConCuenta) => void;
  /** Cambió lo hecho: la ficha relee cuentas, «Estado de cuenta» y el odontograma. */
  onCambio?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const nombreDeHallazgo = (id: string) => {
    const c = CONDITIONS.find((x) => x.id === id);
    return c ? (locale === "en" ? c.en : c.es) : id;
  };
  const vivas = (filas ?? []).filter((f) => f.estado !== "cancelado");
  if (vivas.length === 0) return null;
  const cerrado = ESTADOS_DE_PLAN_SIN_HECHO.includes(estadoDelPlan);
  const conBotones = puede && !cerrado;
  // v13 (t5, n1): «pasa a Debe» solo si lo que falta por hacer ya está en una nota de cobro.
  const conDebe = ayudaHablaDeDebe(debeSigueLoHecho, vivas);

  async function marcar(f: FilaDto) {
    if (ocupada) return;
    setOcupada(f.id);
    try {
      const r = await marcarHecho(planId, [f.id], null);
      if (!r.ok) {
        toast.error(errorDeHecho(t, r, "marcar"));
        return;
      }
      onFilas(vivas.map((x) => (x.id === f.id ? { ...x, estado: "hecho", hechoEn: new Date().toISOString() } : x)));
      if (r.cuenta) onCuenta?.(r.cuenta);
      // v12 (t5, m3): en el idioma de la pantalla, por lo que pasó (no el texto español del servidor).
      toast.success(avisoDeHecho(t, r));
      onCambio?.();
    } finally {
      setOcupada(null);
    }
  }

  async function deshacer(f: FilaDto) {
    if (ocupada) return;
    setOcupada(f.id);
    try {
      const r = await deshacerHecho(planId, f.id);
      if (!r.ok) {
        toast.error(errorDeHecho(t, r, "deshacer"));
        return;
      }
      const vuelve = r.estado === "en_curso" ? "en_curso" : "pendiente";
      onFilas(vivas.map((x) => (x.id === f.id ? { ...x, estado: vuelve, hechoEn: null } : x)));
      if (r.cuenta) onCuenta?.(r.cuenta);
      toast.success(avisoDeDeshacer(t, r, nombreDeHallazgo), { duration: 8000 });
      onCambio?.();
    } finally {
      setOcupada(null);
    }
  }

  return (
    // La tarjeta entera abre el plan: ni el clic ni el teclado de aquí llegan a ella.
    <div className={s.procPlan} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-procedimientos-plan={planId}>
      <div className={s.cuentaPlanTitulo}>{t("planTratamiento.hecho.procedimientos")}</div>
      <ul className={s.procPlanLista}>
        {vivas.map((f) => {
          const hecha = f.estado === "hecho";
          const nombre = nombreDe(f);
          return (
            <li key={f.id} className={s.procPlanFila} data-fila-plan={f.id} data-estado={f.estado}>
              <span className={`${s.procPlanIcono} ${hecha ? s.procPlanIconoHecho : ""}`} aria-hidden>
                {hecha ? <CheckCircle2 size={14} strokeWidth={2} /> : <Circle size={14} strokeWidth={1.75} />}
              </span>
              <span className={s.procPlanNombre}>{nombre}</span>
              <span className={s.procPlanEstado}>
                {hecha
                  ? t("planTratamiento.hecho.estadoHecho", { fecha: f.hechoEn ? fechaPanel(f.hechoEn, null, locale) : "" })
                  : f.estado === "en_curso" ? t("planTratamiento.hecho.estadoEnCurso") : t("planTratamiento.hecho.estadoPorHacer")}
              </span>
              {conBotones && (hecha ? (
                <button
                  type="button"
                  className={`${s.boton} ${s.botonChico}`}
                  onClick={() => void deshacer(f)}
                  disabled={!!ocupada}
                  aria-label={t("planTratamiento.hecho.deshacerAria", { nombre })}
                  data-fila-deshacer={f.id}
                >
                  <RotateCcw size={13} strokeWidth={2} aria-hidden />
                  {t("planTratamiento.hecho.deshacer")}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${s.boton} ${s.botonChico}`}
                  onClick={() => void marcar(f)}
                  disabled={!!ocupada}
                  aria-label={t("planTratamiento.hecho.marcarAria", { nombre })}
                  data-fila-hecho={f.id}
                >
                  <CheckCircle2 size={13} strokeWidth={2} aria-hidden />
                  {ocupada === f.id ? t("planTratamiento.hecho.marcando") : t("planTratamiento.hecho.botonHecho")}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
      {conBotones && vivas.some((f) => f.estado !== "hecho") && (
        <p className={s.cuentaPlanAyuda} data-procedimientos-ayuda={conDebe ? "debe" : "odontograma"}>
          {t(conDebe ? "planTratamiento.hecho.ayudaTarjeta" : "planTratamiento.hecho.ayudaTarjetaSinDebe")}
        </p>
      )}
      {puede && cerrado && <p className={s.cuentaPlanAyuda} data-procedimientos-cerrado>{t("planTratamiento.hecho.planCerrado")}</p>}
    </div>
  );
}
