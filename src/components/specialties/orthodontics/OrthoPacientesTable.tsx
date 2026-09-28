"use client";
// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). Tabla con buscador
// de los casos, con su cobranza real (decisión 1: factura del tratamiento,
// nunca OrthoPaymentPlan).
//
// Diseño (ws1-t3): el nombre es un enlace de verdad (se llega con Tab y se
// abre con Enter) y, en el teléfono, cada paciente pasa a ser una tarjeta en
// vez de una tabla que se desliza. Los `role` van escritos porque, pintada
// como tarjetas, algunos lectores de pantalla dejan de leerla como tabla.
//
// ws1-t4 ronda 6 (revisión de lógica de uso, filas 18 a 20):
//  - La tabla era casi la de Cobranza (saldo vencido y próxima mensualidad) y
//    no decía nada clínico. Ahora dice por dónde va el caso, qué aparatología
//    lleva y cuándo fue y cuándo es su control. De dinero, una sola columna.
//  - Filtro por estado y por doctor tratante: antes solo salían los casos en
//    curso y no había forma de encontrar a quien está en retención, en pausa,
//    terminó o abandonó.
//  - Un caso sin plan de pago dice «Sin plan de pago», no «Al día».
// Las filas y los filtros los decide `pacientes-modulo.ts` (puro, con tests).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SearchX, Users } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fechaEnZona } from "@/components/specialties/orthodontics/modulo/fechas";
import { Vacio } from "@/components/specialties/orthodontics/modulo/piezas";
import { AbrirCasoBoton } from "@/components/specialties/orthodontics/modulo/abrir-caso";
import {
  ETIQUETA_VER,
  OPCIONES_DE_ESTADO,
  contarPorEstado,
  doctoresDeLaLista,
  filtrarCasos,
  type FilaDeCaso,
  type FiltroEstado,
  type FiltroVer,
} from "@/lib/orthodontics/pacientes-modulo";
import type { EstadoCasoOrto } from "@/lib/orthodontics/resumen-para-ficha";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

const TONO_ESTADO: Record<EstadoCasoOrto, "success" | "brand" | "warning" | "info" | "neutral" | "danger"> = {
  planeado: "brand",
  "en-curso": "success",
  pausado: "warning",
  retencion: "info",
  terminado: "neutral",
  abandonado: "danger",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

export function OrthoPacientesTable({
  rows,
  puedeAbrirCaso = false,
  zonaHoraria = null,
  estadoInicial = "activos",
  verInicial = null,
}: {
  rows: FilaDeCaso[];
  /** `medicalRecord.edit`, decidido en el servidor: sin él no sale «Abrir caso». */
  puedeAbrirCaso?: boolean;
  /** `clinic.timezone`: el día de cada control se pinta en la zona de la clínica. */
  zonaHoraria?: string | null;
  /** Lo que pidió la dirección (`?estado=`), ya saneado en el servidor. */
  estadoInicial?: FiltroEstado;
  /** Lo que pidió la dirección (`?ver=`): «colocados / retirados este mes». */
  verInicial?: FiltroVer | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [estado, setEstado] = useState<FiltroEstado>(estadoInicial);
  const [doctor, setDoctor] = useState<string>("");
  const [ver, setVer] = useState<FiltroVer | null>(verInicial);

  const cuentas = useMemo(() => contarPorEstado(rows), [rows]);
  const doctores = useMemo(() => doctoresDeLaLista(rows), [rows]);
  const filtered = useMemo(
    () => filtrarCasos(rows, { estado, doctor: doctor || null, ver, consulta: query }),
    [rows, estado, doctor, ver, query],
  );

  // El día de un control es un INSTANTE: se pinta en la zona de la clínica.
  const dia = (iso: string | null) => (iso ? fechaEnZona(new Date(iso), zonaHoraria) : null);

  const hayFiltros = query.trim() !== "" || estado !== "activos" || doctor !== "" || ver !== null;
  const limpiar = () => {
    setQuery("");
    setEstado("activos");
    setDoctor("");
    setVer(null);
  };

  if (rows.length === 0) {
    return (
      <Vacio
        alto
        icono={Users}
        titulo="Aún no hay casos de ortodoncia"
        pista={
          puedeAbrirCaso
            ? "Pulsa «Abrir caso» y elige al paciente: se abre su ficha con el formulario del caso. En cuanto esté abierto, aparece aquí con su etapa y sus controles."
            : "Un caso lo abre el doctor desde la ficha del paciente, en su pestaña Ortodoncia. En cuanto esté abierto, aparece aquí con su etapa y sus controles."
        }
      >
        {puedeAbrirCaso && <AbrirCasoBoton />}
        <Link href="/dashboard/patients" className={s.boton}>
          <Users size={15} strokeWidth={1.9} aria-hidden />
          Ir a Pacientes
        </Link>
      </Vacio>
    );
  }

  return (
    <section className={s.tarjeta} aria-label="Casos de ortodoncia">
      <div className={s.barraHerramientas}>
        <div className={s.buscador}>
          <Search size={15} strokeWidth={1.9} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar paciente o doctor…"
            aria-label="Buscar paciente o doctor"
            className={s.buscadorEntrada}
          />
        </div>
        <select
          className={`${s.campoEntrada} ${s.filtro}`}
          aria-label="Estado del caso"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value as FiltroEstado);
            // Elegir un estado quita «colocados / retirados este mes»: ese
            // filtro manda sobre el estado y los dos a la vez confunden.
            setVer(null);
          }}
        >
          {OPCIONES_DE_ESTADO.map((o) => (
            <option key={o.id} value={o.id}>
              {o.etiqueta} ({cuentas[o.id]})
            </option>
          ))}
        </select>
        {doctores.length > 1 && (
          <select
            className={`${s.campoEntrada} ${s.filtro}`}
            aria-label="Doctor tratante"
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
          >
            <option value="">Todos los doctores</option>
            {doctores.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        )}
        {ver && (
          <button type="button" className={`${s.etiqueta} ${s.etiquetaVioleta} ${s.filtroActivo}`} onClick={() => setVer(null)}>
            {ETIQUETA_VER[ver]}
            <span aria-hidden> ×</span>
            <span className={s.soloLector}> · quitar este filtro</span>
          </button>
        )}
        <span className={s.conteo} role="status">
          {filtered.length === rows.length
            ? `${rows.length} caso${rows.length === 1 ? "" : "s"}`
            : `${filtered.length} de ${rows.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className={s.tarjetaCuerpo}>
          <Vacio
            icono={SearchX}
            tono="neutro"
            titulo={
              query.trim()
                ? `Ningún caso coincide con «${query.trim()}»`
                : "Ningún caso coincide con estos filtros"
            }
            pista="Se busca por nombre del paciente o del doctor, dentro del estado elegido."
          >
            {hayFiltros && (
              <ButtonNew type="button" variant="secondary" size="sm" onClick={limpiar}>
                Quitar filtros
              </ButtonNew>
            )}
          </Vacio>
        </div>
      ) : (
        <div className={s.tablaCaja}>
          <table className={s.tabla} role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">Paciente</th>
                <th scope="col" role="columnheader">Estado del caso</th>
                <th scope="col" role="columnheader">Aparatología</th>
                <th scope="col" role="columnheader">Último control</th>
                <th scope="col" role="columnheader">Próximo control</th>
                <th scope="col" role="columnheader" className={s.num}>Cobranza</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {filtered.map((r) => {
                const href = `/dashboard/patients/${r.patientId}?tab=ortodoncia`;
                const abierto = r.estado !== "terminado" && r.estado !== "abandonado";
                return (
                  <tr key={r.planId} role="row" onClick={() => router.push(href)}>
                    <td role="cell">
                      <div className={s.paciente}>
                        <AvatarNew name={r.patientName} size="sm" />
                        <div className={s.pacienteTextos}>
                          <Link href={href} className={s.nombre} onClick={(e) => e.stopPropagation()}>
                            {r.patientName}
                          </Link>
                          <div className={s.detalle}>{r.treatingDoctorName ?? "Sin doctor tratante"}</div>
                        </div>
                      </div>
                    </td>
                    <td role="cell" className={s.estado} data-etiqueta="Estado del caso">
                      <BadgeNew tone={TONO_ESTADO[r.estado]}>{r.etiquetaEstado}</BadgeNew>
                      {r.etapa && <div className={s.detalle}>{r.etapa}</div>}
                    </td>
                    <td role="cell" data-etiqueta="Aparatología">
                      {r.aparatologia}
                    </td>
                    <td role="cell" data-etiqueta="Último control">
                      {dia(r.ultimoControl) ?? <span className={s.importeApagado}>Sin controles</span>}
                    </td>
                    <td role="cell" data-etiqueta="Próximo control">
                      {dia(r.proximoControl) ??
                        (abierto && r.estado !== "pausado" ? (
                          <span className={s.detallePeligro}>Sin agendar</span>
                        ) : (
                          <span className={s.importeApagado}>—</span>
                        ))}
                    </td>
                    <td role="cell" className={s.num} data-etiqueta="Cobranza">
                      {r.cobranza === "vencido" ? (
                        <span className={`${s.importe} ${s.importePeligro}`}>{fmtMoney(r.vencidoMxn)} vencido</span>
                      ) : r.cobranza === "sin-plan" ? (
                        <span className={`${s.importe} ${s.importeApagado}`}>Sin plan de pago</span>
                      ) : (
                        <span className={`${s.importe} ${s.importeApagado}`}>Al día</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
