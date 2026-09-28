"use client";
// Módulo de Ortodoncia — la vista de «Cobranza de mensualidades» (ws1-t3, H16
// de la QA en vivo del 28-sep-2026: el apartado decía «Próximamente»).
//
// Solo pinta y filtra. El dinero llega ya calculado desde la página
// (`cobranza/page.tsx` → `loadOrthoCases` → `cobranzaDelCasoUnificada`), igual
// que en el Tablero, Alertas y Pacientes en tratamiento: esta pantalla no
// puede decir un número distinto al de las demás.
//
// Tres pisos:
//  1. Cuatro cuadros con los totales, que además son el filtro de la tabla.
//  2. «Por cobrar ahora»: la MISMA lista de Caja (`ListaMensualidades`), con
//     su botón Cobrar y su cobro a hermanos. Se pide sola y exige el permiso
//     de Caja; sin él no sale y aquí se dice por qué.
//  3. El estado de cuenta de cada caso: qué debe, desde cuándo, qué sigue.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Lock,
  Search,
  SearchX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { ListaMensualidades } from "@/components/specialties/orthodontics/cobranza/ListaMensualidades";
import {
  HORIZONTE_POR_VENCER_DIAS,
  filtrarCobranza,
  fraseDeAtraso,
  fraseDeProxima,
  fraseDeVencidos,
  type FilaCobranza,
  type FiltroCobranza,
  type ResumenDeCobranza,
  type SituacionCobranza,
} from "@/lib/orthodontics/cobranza-modulo";
import { fechaEnZona } from "./fechas";
import { Pantalla, Vacio, type Tono } from "./piezas";
import s from "./modulo.module.css";

/** «$2,000» si es cerrado; «$1,499.50» si lleva centavos (nunca «$1,499.5»). */
function fmtMoney(n: number): string {
  const centavos = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: centavos,
    maximumFractionDigits: centavos,
  }).format(n);
}

// Fecha de calendario ("YYYY-MM-DD"): se pinta tal cual, sin zona horaria.
const fmtDate = (iso: string | null) => fechaEnZona(iso, null);

const CLASE_TONO: Record<Tono, string> = {
  violeta: "",
  exito: s.tonoExito,
  alerta: s.tonoAlerta,
  peligro: s.tonoPeligro,
  neutro: s.tonoNeutro,
};

const SITUACION: Record<SituacionCobranza, { texto: string; tono: "danger" | "warning" | "success" | "neutral" }> = {
  vencido: { texto: "Vencido", tono: "danger" },
  "por-vencer": { texto: "Por vencer", tono: "warning" },
  "al-corriente": { texto: "Al corriente", tono: "success" },
  saldado: { texto: "Saldado", tono: "success" },
  "sin-plan": { texto: "Sin plan de pago", tono: "neutral" },
};

const ESTADO_CERRADO: Partial<Record<FilaCobranza["status"], string>> = {
  COMPLETED: "Caso terminado",
  DROPPED_OUT: "Caso abandonado",
};

export function VistaCobranza({
  filas,
  resumen,
  puedeCobrar,
}: {
  filas: FilaCobranza[];
  resumen: ResumenDeCobranza;
  /** Permiso de Caja (`billing.view`), decidido en el servidor: sin él la lista de cobro no sale. */
  puedeCobrar: boolean;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<FiltroCobranza>("todos");
  const [consulta, setConsulta] = useState("");

  const visibles = useMemo(() => filtrarCobranza(filas, filtro, consulta), [filas, filtro, consulta]);
  const hayQueCobrarAhora = resumen.vencido.casos + resumen.porVencer.casos > 0;

  const cuadros: { id: FiltroCobranza; valor: string; etiqueta: string; icono: LucideIcon; tono: Tono }[] = [
    {
      id: "vencido",
      valor: fmtMoney(resumen.vencido.importe),
      etiqueta:
        resumen.vencido.casos === 0
          ? "Vencido · nadie debe"
          : `Vencido · ${resumen.vencido.casos} caso${resumen.vencido.casos === 1 ? "" : "s"}`,
      icono: AlertTriangle,
      tono: resumen.vencido.casos > 0 ? "peligro" : "neutro",
    },
    {
      id: "por-vencer",
      valor: fmtMoney(resumen.porVencer.importe),
      etiqueta:
        resumen.porVencer.casos === 0
          ? `Por vencer en ${HORIZONTE_POR_VENCER_DIAS} días · ninguno`
          : `Por vencer en ${HORIZONTE_POR_VENCER_DIAS} días · ${resumen.porVencer.casos} caso${resumen.porVencer.casos === 1 ? "" : "s"}`,
      icono: CalendarClock,
      tono: resumen.porVencer.casos > 0 ? "alerta" : "neutro",
    },
    {
      id: "al-corriente",
      valor: String(resumen.alCorriente + resumen.sinPlan),
      etiqueta: `Al corriente${resumen.sinPlan > 0 ? ` · ${resumen.sinPlan} sin plan de pago` : ""}`,
      icono: CheckCircle2,
      tono: "exito",
    },
    {
      id: "todos",
      valor: fmtMoney(resumen.porCobrar),
      etiqueta: `Por cobrar en total · ${resumen.total} caso${resumen.total === 1 ? "" : "s"}`,
      icono: Wallet,
      tono: "violeta",
    },
  ];

  if (filas.length === 0) {
    return (
      <Pantalla titulo="Cobranza de mensualidades" sub="Quién debe, cuánto y desde cuándo, caso por caso.">
        <Vacio
          alto
          icono={Wallet}
          titulo="Aún no hay casos con cobranza"
          pista="En cuanto un caso de ortodoncia esté activo aparece aquí, con lo que debe y su próximo pago. Los casos se abren en «Pacientes en tratamiento»; el plan de pago, desde la ficha del paciente, en «Cobro del tratamiento»."
        />
      </Pantalla>
    );
  }

  return (
    <Pantalla
      titulo="Cobranza de mensualidades"
      sub={
        resumen.vencido.casos > 0
          ? `${resumen.vencido.casos} caso${resumen.vencido.casos === 1 ? "" : "s"} con ${fraseDeVencidos(resumen.vencido.cuotas)} por ${fmtMoney(resumen.vencido.importe)}.`
          : "Nadie debe pagos vencidos."
      }
    >
      <div className={s.cuadros} role="group" aria-label="Filtrar los casos por su situación">
        {cuadros.map((c) => {
          const activo = filtro === c.id;
          return (
            <button
              key={c.id}
              type="button"
              className={activo ? `${s.resumenItem} ${s.cuadro} ${s.cuadroActivo}` : `${s.resumenItem} ${s.cuadro}`}
              aria-pressed={activo}
              onClick={() => setFiltro(c.id)}
            >
              <span className={`${s.tarjetaIcono} ${CLASE_TONO[c.tono]}`} aria-hidden>
                <c.icono size={15} strokeWidth={1.9} />
              </span>
              <span className={s.resumenTextos}>
                <span className={s.resumenValor}>{c.valor}</span>
                <span className={s.resumenEtiqueta}>{c.etiqueta}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Por cobrar ahora: la lista de Caja, tal cual. Al cobrar se vuelve a
          pedir la pantalla para que los totales y la tabla digan lo nuevo. */}
      {puedeCobrar ? (
        hayQueCobrarAhora ? (
          <ListaMensualidades alCobrar={() => router.refresh()} />
        ) : (
          <p className={`${s.enOrden} ${s.enOrdenSuelto}`}>
            <CheckCircle2 size={15} strokeWidth={1.9} aria-hidden />
            No hay pagos vencidos ni por vencer en los próximos {HORIZONTE_POR_VENCER_DIAS} días.
          </p>
        )
      ) : (
        <p className={`${s.enOrden} ${s.enOrdenSuelto} ${s.enOrdenAviso}`}>
          <Lock size={15} strokeWidth={1.9} aria-hidden />
          Para cobrar desde aquí hace falta el permiso de Caja. Pídeselo a quien administra la clínica.
        </p>
      )}

      <section className={s.tarjeta} aria-label="Estado de cuenta por caso">
        <div className={s.barraHerramientas}>
          <div className={s.buscador}>
            <Search size={15} strokeWidth={1.9} aria-hidden />
            <input
              type="search"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="Buscar paciente o doctor…"
              aria-label="Buscar paciente o doctor"
              className={s.buscadorEntrada}
            />
          </div>
          <span className={s.conteo} role="status">
            {visibles.length === filas.length
              ? `${filas.length} caso${filas.length === 1 ? "" : "s"}`
              : `${visibles.length} de ${filas.length}`}
          </span>
        </div>

        {visibles.length === 0 ? (
          <div className={s.tarjetaCuerpo}>
            <Vacio
              icono={consulta.trim() ? SearchX : CheckCircle2}
              tono="neutro"
              titulo={
                consulta.trim()
                  ? `Ningún caso coincide con «${consulta.trim()}»`
                  : filtro === "vencido"
                    ? "Ningún caso tiene pagos vencidos"
                    : filtro === "por-vencer"
                      ? `Ningún caso vence en los próximos ${HORIZONTE_POR_VENCER_DIAS} días`
                      : "Ningún caso en esta situación"
              }
              pista={consulta.trim() ? "Se busca por el nombre del paciente o de su doctor tratante." : undefined}
            >
              <ButtonNew
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConsulta("");
                  setFiltro("todos");
                }}
              >
                Ver todos los casos
              </ButtonNew>
            </Vacio>
          </div>
        ) : (
          <div className={s.tablaCaja}>
            <table className={s.tabla} role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">Paciente</th>
                  <th scope="col" role="columnheader">Situación</th>
                  <th scope="col" role="columnheader" className={s.num}>Vencido</th>
                  <th scope="col" role="columnheader" className={s.num}>Próximo pago</th>
                  <th scope="col" role="columnheader" className={s.num}>Por cobrar</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {visibles.map((f) => {
                  const href = `/dashboard/patients/${f.patientId}?tab=ortodoncia`;
                  const situacion = SITUACION[f.situacion];
                  const cerrado = ESTADO_CERRADO[f.status];
                  return (
                    <tr key={f.planId} role="row" onClick={() => router.push(href)}>
                      <td role="cell">
                        <div className={s.paciente}>
                          <AvatarNew name={f.patientName} size="sm" />
                          <div className={s.pacienteTextos}>
                            <Link href={href} className={s.nombre} onClick={(e) => e.stopPropagation()}>
                              {f.patientName}
                            </Link>
                            <div className={s.detalle}>
                              {[f.treatingDoctorName, cerrado].filter(Boolean).join(" · ") || "Sin doctor tratante"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td role="cell" className={s.estado} data-etiqueta="Situación">
                        <BadgeNew tone={situacion.tono} dot={f.situacion === "vencido"}>
                          {situacion.texto}
                        </BadgeNew>
                      </td>
                      <td role="cell" className={s.num} data-etiqueta="Vencido">
                        {f.situacion === "vencido" ? (
                          <>
                            <span className={`${s.importe} ${s.importePeligro}`}>{fmtMoney(f.vencido)}</span>
                            <div className={s.detalle}>
                              {fraseDeVencidos(f.cuotasVencidas)}
                              {f.vencidoDesde ? ` · desde el ${fmtDate(f.vencidoDesde)}` : ""}
                            </div>
                            {fraseDeAtraso(f.diasDeAtraso) && (
                              <div className={`${s.detalle} ${s.detallePeligro}`}>{fraseDeAtraso(f.diasDeAtraso)}</div>
                            )}
                          </>
                        ) : (
                          <span className={`${s.importe} ${s.importeApagado}`}>
                            {f.situacion === "sin-plan" ? "—" : "Al día"}
                          </span>
                        )}
                      </td>
                      <td role="cell" className={s.num} data-etiqueta="Próximo pago">
                        {f.proximaFecha ? (
                          <>
                            <span className={s.importe}>{fmtMoney(f.proximoImporte ?? 0)}</span>
                            <div className={s.detalle}>
                              {fmtDate(f.proximaFecha)}
                              {f.situacion === "por-vencer" && fraseDeProxima(f.diasParaLaProxima)
                                ? ` · ${fraseDeProxima(f.diasParaLaProxima)}`
                                : ""}
                            </div>
                          </>
                        ) : (
                          <span className={`${s.importe} ${s.importeApagado}`}>
                            {f.situacion === "sin-plan" ? "Sin plan de pago" : "—"}
                          </span>
                        )}
                      </td>
                      <td role="cell" className={s.num} data-etiqueta="Por cobrar">
                        {f.situacion === "sin-plan" ? (
                          <span className={`${s.importe} ${s.importeApagado}`}>—</span>
                        ) : (
                          <>
                            <span className={s.importe}>{fmtMoney(f.porCobrar)}</span>
                            <div className={s.detalle}>
                              {f.cuotasPagadas} de {f.cuotasTotales} pago{f.cuotasTotales === 1 ? "" : "s"} cubierto
                              {f.cuotasTotales === 1 ? "" : "s"}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={s.pieTabla}>
          Pulsa un caso para abrir su ficha: ahí están su calendario de pagos, los abonos y el convenio.
          <ChevronRight size={13} strokeWidth={1.9} aria-hidden />
        </p>
      </section>
    </Pantalla>
  );
}
