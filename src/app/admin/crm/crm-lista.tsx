"use client";

// ═══════════════════════════════════════════════════════════════════════
// La vista de lista: la misma información del tablero, pero comparable
// entre sí, ordenable y accesible con teclado (la etapa se cambia con un
// selector, no arrastrando).
//
// Es la vista por defecto en cuanto la libreta crece, porque es la única
// que contesta de un vistazo la pregunta con la que se abre esta pantalla
// por la mañana: a quién hay que llamar hoy. Tres cosas la hacen contestar:
//
//  1. LA BARRA DE COLOR DE LA IZQUIERDA. Vencido, hoy, enfriándose y
//     nunca contactado se distinguen SIN leer: es el triaje que antes
//     había que reconstruir mirando dos columnas.
//  2. LAS CABECERAS ORDENAN. "Quién lleva más tiempo abandonado" es un
//     clic, no un viaje al selector de orden.
//  3. EL PRÓXIMO PASO SE CAMBIA AQUÍ. Posponer a mañana o darlo por
//     hecho no obliga a abrir la ficha y volver — que es donde se pierden
//     el filtro, el scroll y las ganas.
// ═══════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import {
  crmDiaRelativo,
  crmDiasSinContacto,
  crmEstaFrio,
  crmEtapaEsTerminal,
  crmSemaforo,
  crmTelefonoLegible,
  crmVertical,
  CRM_DIAS_PARA_ENFRIARSE,
  type CrmOrden,
} from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import {
  CrmAccionesContacto,
  CrmAccionesFila,
  CrmAvatar,
  CrmEtapaSelect,
  CrmOrigenChip,
  CrmSemaforoChip,
  CrmVerticalChip,
  crmFmtMxn,
} from "./crm-ui";

/**
 * Qué columnas ordenan y con qué criterio. Cada una apunta a un orden del
 * catálogo de crm-core, así que la cabecera y el selector de orden de
 * arriba son el MISMO estado — no dos que se contradicen.
 *
 * Un clic ordena por esa columna; no hay ida y vuelta ascendente/
 * descendente porque cada criterio tiene una dirección que es la útil
 * (el más abandonado arriba, el de más valor arriba). Las dos direcciones
 * de verdad distintas —A-Z y por fecha de alta— están en el selector.
 */
const COLUMNAS_ORDENABLES: Partial<Record<string, { orden: CrmOrden; flecha: string }>> = {
  negocio: { orden: "nombre", flecha: "↑" },
  paso: { orden: "prioridad", flecha: "↑" },
  seguimiento: { orden: "sin-contacto", flecha: "↑" },
  valor: { orden: "valor", flecha: "↓" },
};

/** Los días de posponer que se ofrecen en la fila, sin abrir la ficha. */
const ATAJOS_PASO: { valor: string; texto: string; dias: number | null }[] = [
  { valor: "hoy", texto: "Para hoy", dias: 0 },
  { valor: "manana", texto: "Mañana", dias: 1 },
  { valor: "tres", texto: "En 3 días", dias: 3 },
  { valor: "semana", texto: "En 1 semana", dias: 7 },
  { valor: "quincena", texto: "En 15 días", dias: 15 },
  { valor: "quitar", texto: "Quitar el próximo paso", dias: null },
];

export function CrmLista({
  filas,
  ahora,
  orden,
  mover,
  alOrdenar,
  alProgramar,
  alEditar,
  alTextos,
  vacio,
}: {
  filas: CrmProspectoDTO[];
  ahora: Date;
  orden: CrmOrden;
  mover: (id: string, etapa: string) => void;
  /** Cambia el orden global (vive en la URL, como todo lo demás). */
  alOrdenar: (orden: CrmOrden) => void;
  /** Pone o quita el próximo paso. `null` lo quita. */
  alProgramar: (p: CrmProspectoDTO, fecha: string | null) => void;
  /** Abre el formulario EN SITIO, sin salir de la lista (ver crm-client). */
  alEditar: (p: CrmProspectoDTO) => void;
  alTextos?: (p: CrmProspectoDTO) => void;
  /** Qué pintar cuando no hay ninguna fila. Lo decide quien sabe por qué. */
  vacio: React.ReactNode;
}) {
  if (filas.length === 0) return <>{vacio}</>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table-new">
        <thead>
          <tr>
            <Cabecera id="negocio" orden={orden} alOrdenar={alOrdenar}>
              Negocio
            </Cabecera>
            <th>Contacto</th>
            <th style={{ width: 158 }}>Etapa</th>
            <Cabecera id="paso" orden={orden} alOrdenar={alOrdenar} ancho={250}>
              Próximo paso
            </Cabecera>
            <Cabecera id="seguimiento" orden={orden} alOrdenar={alOrdenar} derecha>
              Seguimiento
            </Cabecera>
            <Cabecera id="valor" orden={orden} alOrdenar={alOrdenar} derecha>
              Valor / mes
            </Cabecera>
            <th>Contactar</th>
            <th style={{ width: 210 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const dias = crmDiasSinContacto(p.lastContactAt, ahora);
            const v = crmVertical(p.vertical);
            const acento = colorDeAcento(p, ahora);
            return (
              <tr key={p.id}>
                <td
                  style={{
                    // La barra de triaje. Va como sombra interior y no
                    // como `border-left`: un borde le come 3 px al ancho
                    // de la celda y descuadra la cabecera con el cuerpo.
                    boxShadow: acento ? `inset 3px 0 0 ${acento}` : undefined,
                    paddingLeft: 14,
                  }}
                >
                  <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
                    <CrmAvatar name={p.name} vertical={p.vertical} size={30} />
                    <div style={{ minWidth: 0 }}>
                      <Link
                        href={`/admin/crm/${p.id}`}
                        className="crm-tarjeta-nombre"
                        style={{
                          color: "var(--text-1)",
                          fontWeight: 600,
                          textDecoration: "none",
                          display: "block",
                        }}
                      >
                        {p.name}
                      </Link>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <CrmVerticalChip vertical={p.vertical} />
                        {(p.city || p.state || p.country) && (
                          <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                            {[p.city, p.state, p.country].filter(Boolean).join(", ")}
                          </span>
                        )}
                        {p.size ? (
                          <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                            {p.size} {v.medida.toLowerCase()}
                          </span>
                        ) : null}
                        <CrmOrigenChip p={p} />
                      </div>
                    </div>
                  </div>
                </td>

                <td style={{ color: "var(--text-2)" }}>
                  {p.contactName && (
                    <div style={{ fontSize: 12 }}>
                      {p.contactName}
                      {p.contactRole && (
                        <span style={{ color: "var(--text-4)" }}> · {p.contactRole}</span>
                      )}
                    </div>
                  )}
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {p.phone ? crmTelefonoLegible(p.phone) : "sin teléfono"}
                  </div>
                  {p.email && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-4)",
                        maxWidth: 190,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.email}
                    >
                      {p.email}
                    </div>
                  )}
                </td>

                <td>
                  <CrmEtapaSelect stage={p.stage} mover={(etapa) => mover(p.id, etapa)} />
                </td>

                <td style={{ maxWidth: 260 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <CrmSemaforoChip fecha={p.nextActionAt} nota={p.nextActionNote} ahora={ahora} />
                  </div>
                  <ProximoPasoAtajo p={p} ahora={ahora} alProgramar={alProgramar} />
                </td>

                {/* Cuánto lleva abandonado Y si hay algo escrito. Juntos
                    contestan "¿ya le escribí?", que es la pregunta que
                    hace que un prospecto se pierda cuando nadie la puede
                    contestar. Se tiñen a partir del umbral de enfriarse:
                    un 21 en gris se lee igual que un 2. */}
                <td
                  style={{
                    textAlign: "right",
                    color:
                      dias !== null && dias >= CRM_DIAS_PARA_ENFRIARSE
                        ? "var(--warning)"
                        : "var(--text-3)",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontWeight: dias !== null && dias >= CRM_DIAS_PARA_ENFRIARSE ? 600 : 400,
                      whiteSpace: "nowrap",
                    }}
                    title={
                      dias === null
                        ? "Nadie le ha escrito ni le ha marcado nunca"
                        : `Último contacto hace ${dias} ${dias === 1 ? "día" : "días"}`
                    }
                  >
                    {dias === null ? (
                      <span style={{ color: "var(--info)" }}>nunca</span>
                    ) : dias === 0 ? (
                      "hoy"
                    ) : (
                      `${dias} d`
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--text-4)", whiteSpace: "nowrap" }}
                  >
                    {p.actividades ? `${p.actividades} anot.` : "sin bitácora"}
                  </div>
                </td>

                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)", fontWeight: 600 }}>
                  {p.monthlyValue ? crmFmtMxn(p.monthlyValue) : "—"}
                </td>

                <td>
                  <CrmAccionesContacto p={p} soloIconos />
                </td>

                <td>
                  <CrmAccionesFila p={p} alEditar={alEditar} alTextos={alTextos} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * El color de la barra de la izquierda. El orden importa: lo que URGE
 * gana sobre lo que preocupa. Un prospecto puede estar vencido Y frío; lo
 * que hay que ver primero es que venció.
 */
function colorDeAcento(p: CrmProspectoDTO, ahora: Date): string | null {
  if (crmEtapaEsTerminal(p.stage)) return null;
  const s = crmSemaforo(p.nextActionAt, ahora);
  if (s === "vencido") return "var(--danger)";
  if (s === "hoy") return "var(--warning)";
  if (crmEstaFrio(p, ahora)) return "var(--warning-soft-strong)";
  if (!p.lastContactAt) return "var(--info-soft)";
  return null;
}

/** Cabecera que además ordena. Con teclado también, no sólo con el ratón. */
function Cabecera({
  id,
  orden,
  alOrdenar,
  children,
  ancho,
  derecha,
}: {
  id: string;
  orden: CrmOrden;
  alOrdenar: (o: CrmOrden) => void;
  children: React.ReactNode;
  ancho?: number;
  derecha?: boolean;
}) {
  const conf = COLUMNAS_ORDENABLES[id];
  if (!conf) {
    return <th style={{ width: ancho, textAlign: derecha ? "right" : "left" }}>{children}</th>;
  }
  const activa = orden === conf.orden;
  return (
    <th style={{ width: ancho, textAlign: derecha ? "right" : "left", padding: 0 }}>
      <button
        type="button"
        onClick={() => alOrdenar(conf.orden)}
        aria-label={`Ordenar por ${String(children)}`}
        aria-pressed={activa}
        style={{
          // El botón ocupa la celda entera para que el área de clic sea
          // la cabecera y no sólo las letras.
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: derecha ? "flex-end" : "flex-start",
          gap: 4,
          padding: "10px 14px",
          border: "none",
          background: "transparent",
          font: "inherit",
          color: activa ? "var(--text-1)" : "inherit",
          fontWeight: activa ? 700 : 600,
          textTransform: "inherit",
          letterSpacing: "inherit",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {children}
        <span
          aria-hidden
          style={{ opacity: activa ? 0.9 : 0.25, fontSize: 10, color: activa ? "var(--brand)" : undefined }}
        >
          {conf.flecha}
        </span>
      </button>
    </th>
  );
}

/**
 * Posponer sin salir de la lista. Va como `<select>` y no como un menú
 * flotante a propósito: funciona con teclado, no se sale de la tabla al
 * hacer scroll y es el mismo control que ya cambia la etapa dos columnas
 * antes. Vuelve solo al texto de invitación después de elegir, porque no
 * representa un estado: es una acción.
 */
function ProximoPasoAtajo({
  p,
  ahora,
  alProgramar,
}: {
  p: CrmProspectoDTO;
  ahora: Date;
  alProgramar: (p: CrmProspectoDTO, fecha: string | null) => void;
}) {
  // Un prospecto cerrado no tiene próximo paso, y el servicio rechaza
  // ponérselo: mejor no ofrecerlo que enseñar un error después.
  if (crmEtapaEsTerminal(p.stage)) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
      <CalendarClock size={11} style={{ color: "var(--text-4)", flexShrink: 0 }} aria-hidden />
      <select
        className="input-new"
        value=""
        aria-label={`Cambiar el próximo paso de ${p.name}`}
        title="Poner, mover o quitar el próximo paso sin abrir la ficha"
        onChange={(e) => {
          const atajo = ATAJOS_PASO.find((a) => a.valor === e.target.value);
          if (!atajo) return;
          alProgramar(p, atajo.dias === null ? null : crmDiaRelativo(atajo.dias, ahora));
          e.target.value = "";
        }}
        style={{
          height: 24,
          width: 152,
          fontSize: 11,
          padding: "0 6px",
          background: "transparent",
          borderColor: "transparent",
          color: "var(--text-4)",
        }}
      >
        <option value="">{p.nextActionAt ? "Mover a…" : "Agendar…"}</option>
        {ATAJOS_PASO.map((a) =>
          a.dias === null && !p.nextActionAt ? null : (
            <option key={a.valor} value={a.valor}>
              {a.texto}
            </option>
          ),
        )}
      </select>
    </div>
  );
}
