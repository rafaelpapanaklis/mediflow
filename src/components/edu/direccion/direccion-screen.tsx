"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Minus,
  Printer,
  RefreshCw,
} from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import type { EduPersonaKind } from "@/lib/edu/persona-core";
import { eduMoney } from "@/lib/edu/dinero-core";
import { eduHoursLabel } from "@/lib/edu/evaluacion-core";
import {
  EDU_DIR_DETALLE_DETALLES,
  EDU_DIR_DETALLE_TITULOS,
  EDU_DIR_FIRMA_VIEJA_MIN,
  EDU_DIR_PERIODOS,
  EDU_DIR_PERIODO_LABELS,
  EDU_DIR_REFRESCO_MS,
  EDU_DIR_SEMAFORO_TAG,
  EDU_DIR_SILLON_BAJO,
  EDU_DIR_SILLON_LABELS,
  EDU_DIR_SILLON_SEMAFORO,
  eduDirAtrasoLabel,
  eduDirEsperaLabel,
  eduDirPctLabel,
  eduDirQueryDeFiltros,
  eduDirSemaforoDeAtraso,
  type EduDirAhora,
  type EduDirAlumnoRow,
  type EduDirCifra,
  type EduDirDetalleFila,
  type EduDirDetalleKey,
  type EduDirDetallePage,
  type EduDirPanel,
  type EduDirPeriodo,
  type EduDirSemaforo,
} from "@/lib/edu/direccion-core";

/**
 * /instituto/direccion — LO QUE EL DIRECTOR ABRE PARA VER CÓMO VA SU
 * CLÍNICA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NO ES UNA LISTA DE PROBLEMAS: ES LO QUE ESTÁ PASANDO.
 *
 * El orden de los bloques es el orden en que se hacen las preguntas en una
 * junta, y por eso "Pendientes" va SEXTO y con el mismo tamaño que los
 * demás: un bloque rojo gigante arriba convierte el tablero en una lista
 * de quejas, se mira dos semanas y se deja de abrir.
 *
 * 🔴 CADA CIFRA ABRE LA LISTA QUE HAY DETRÁS. Un número que no se puede
 * abrir no sirve para decidir: "7 casos esperando firma" no es accionable,
 * "estos siete y el más viejo lleva dos horas" sí. Las listas que ya están
 * en memoria (los sillones, las especialidades, los alumnos) se abren sin
 * pedirle nada al servidor; las de registros se piden al abrirlas — cargar
 * las quince por si acaso sería una pantalla de ocho segundos.
 *
 * 🔴 EL SEMÁFORO SIGNIFICA SIEMPRE LO MISMO: rojo = alguien tiene que
 * actuar, ámbar = vigilar, verde = va bien. Las cifras de actividad
 * (pacientes atendidos, tamizajes, cobrado) van en GRIS a propósito: son
 * un dato, no un juicio, y teñirlas de verde enseñaría a ignorar el verde.
 *
 * 🔴 EL BLOQUE DE ARRIBA SE REFRESCA SOLO, el resto no. Lo que cambia en el
 * piso clínico son los sillones; el cobrado del mes no cambia mientras se
 * mira. Y el latido se para con la pestaña oculta: un tablero proyectado y
 * olvidado no tiene por qué consultar la base toda la tarde.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduDireccionScreenProps {
  ahora: EduDirAhora;
  panel: EduDirPanel;
}

interface VistaDetalle {
  titulo: string;
  detalle: string;
  filas: EduDirDetalleFila[];
  truncated: boolean;
  cargando: boolean;
  error: string | null;
}

const CLASE_POR_SEMAFORO: Record<EduDirSemaforo, string> = {
  ACTUAR: "edu-dir-cifra--actuar",
  VIGILAR: "edu-dir-cifra--vigilar",
  OK: "edu-dir-cifra--ok",
  NEUTRO: "",
};

const PUNTO_POR_SEMAFORO: Record<EduDirSemaforo, string> = {
  ACTUAR: "edu-dir-punto edu-dir-punto--actuar",
  VIGILAR: "edu-dir-punto edu-dir-punto--vigilar",
  OK: "edu-dir-punto edu-dir-punto--ok",
  NEUTRO: "edu-dir-punto",
};

export function EduDireccionScreen({ ahora: ahoraSSR, panel }: EduDireccionScreenProps) {
  const router = useRouter();
  const [navegando, startNav] = useTransition();

  const [ahora, setAhora] = useState<EduDirAhora>(ahoraSSR);
  const [latiendo, setLatiendo] = useState(true);
  const [detalle, setDetalle] = useState<VistaDetalle | null>(null);
  // 🔴 Dos detalles abiertos deprisa pueden volver al revés y dejar en
  // pantalla la lista que ya no se está mirando. El número de petición es
  // lo único que lo impide.
  const peticion = useRef(0);

  const v = panel.ventana;
  const [desde, setDesde] = useState(v.desdeISO);
  const [hasta, setHasta] = useState(v.hastaISO);

  const qs = useMemo(
    () =>
      eduDirQueryDeFiltros({
        periodo: v.periodo,
        desde: v.desdeISO,
        hasta: v.hastaISO,
        especialidad: panel.especialidadId,
      }),
    [v.periodo, v.desdeISO, v.hastaISO, panel.especialidadId],
  );

  // El bloque en vivo no depende del periodo: solo de la especialidad.
  const qsAhora = useMemo(
    () => (panel.especialidadId ? `especialidad=${encodeURIComponent(panel.especialidadId)}` : ""),
    [panel.especialidadId],
  );

  // Cuando el servidor vuelve a pintar (cambió un filtro), lo suyo manda
  // sobre lo que trajo el último latido.
  useEffect(() => {
    setAhora(ahoraSSR);
    setLatiendo(true);
  }, [ahoraSSR]);

  useEffect(() => {
    setDesde(v.desdeISO);
    setHasta(v.hastaISO);
  }, [v.desdeISO, v.hastaISO]);

  useEffect(() => {
    let vivo = true;

    async function latir() {
      // Con la pestaña oculta no se consulta: el navegador además frena los
      // temporizadores en segundo plano, así que el intervalo dejaría de ser
      // el que dice el nombre de la constante.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await eduRequest<EduDirAhora>(
          `/api/instituto/direccion/ahora${qsAhora ? `?${qsAhora}` : ""}`,
        );
        if (!vivo) return;
        setAhora(data);
        setLatiendo(true);
      } catch {
        // Se para el pulso y se DICE, con la hora del último corte al lado:
        // un tablero pegado que parece vivo es peor que uno que avisa.
        if (vivo) setLatiendo(false);
      }
    }

    const id = window.setInterval(latir, EDU_DIR_REFRESCO_MS);
    const alVolver = () => {
      if (!document.hidden) void latir();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [qsAhora]);

  const irA = useCallback(
    (next: { periodo?: EduDirPeriodo; desde?: string; hasta?: string; especialidad?: string | null }) => {
      const query = eduDirQueryDeFiltros({
        periodo: next.periodo ?? v.periodo,
        desde: next.desde ?? desde,
        hasta: next.hasta ?? hasta,
        especialidad:
          next.especialidad === undefined ? panel.especialidadId : next.especialidad,
      });
      startNav(() => {
        router.replace(query ? `/instituto/direccion?${query}` : "/instituto/direccion", {
          scroll: false,
        });
      });
    },
    [router, v.periodo, desde, hasta, panel.especialidadId],
  );

  const abrirRemoto = useCallback(
    async (key: EduDirDetalleKey) => {
      const n = (peticion.current += 1);
      setDetalle({
        titulo: EDU_DIR_DETALLE_TITULOS[key],
        detalle: EDU_DIR_DETALLE_DETALLES[key],
        filas: [],
        truncated: false,
        cargando: true,
        error: null,
      });
      try {
        const page = await eduRequest<EduDirDetallePage>(
          `/api/instituto/direccion/detalle?que=${encodeURIComponent(key)}${qs ? `&${qs}` : ""}`,
        );
        if (peticion.current !== n) return;
        setDetalle({
          titulo: page.titulo,
          detalle: page.detalle,
          filas: page.filas,
          truncated: page.truncated,
          cargando: false,
          error: null,
        });
      } catch (err) {
        if (peticion.current !== n) return;
        setDetalle((d) =>
          d ? { ...d, cargando: false, error: (err as Error).message } : null,
        );
      }
    },
    [qs],
  );

  const abrirLocal = useCallback(
    (titulo: string, texto: string, filas: EduDirDetalleFila[]) => {
      peticion.current += 1;
      setDetalle({ titulo, detalle: texto, filas, truncated: false, cargando: false, error: null });
    },
    [],
  );

  const sillonesBajos = panel.uso.sillones.filter(
    (s) => s.ocupacion !== null && s.ocupacion < EDU_DIR_SILLON_BAJO,
  );

  const firmaVieja =
    panel.pendientes.firmaMasViejaMin !== null &&
    panel.pendientes.firmaMasViejaMin >= EDU_DIR_FIRMA_VIEJA_MIN;

  return (
    <>
      <FiltrosBar
        panel={panel}
        desde={desde}
        hasta={hasta}
        setDesde={setDesde}
        setHasta={setHasta}
        irA={irA}
        navegando={navegando}
        qs={qs}
        refrescar={() => startNav(() => router.refresh())}
      />

      {panel.avisos.length > 0 && (
        <div className="edu-banner" role="status">
          <div>
            <p className="edu-banner__title">Lo que este tablero no puede saber</p>
            {panel.avisos.map((a) => (
              <p key={a} className="edu-banner__detail">
                {a}
              </p>
            ))}
          </div>
        </div>
      )}

      <BloqueAhora
        ahora={ahora}
        latiendo={latiendo}
        abrirLocal={abrirLocal}
        especialidad={panel.especialidadNombre}
      />

      <section className="edu-dir-bloque">
        <div className="edu-dir-bloque__head">
          <h2 className="edu-dir-bloque__title">Actividad del periodo</h2>
          <span className="edu-count">{v.label}</span>
        </div>
        <p className="edu-dir-bloque__lead">
          Cada cifra se compara {v.compara}. La flecha dice la dirección y nada más: subir no
          siempre es bueno y bajar no siempre es malo, así que el color se reserva para lo que
          hay que atender.
        </p>
        <div className="edu-dir-cifras">
          {panel.tarjetas.map((t) => (
            <Cifra key={t.label} cifra={t} onAbrir={abrirRemoto} />
          ))}
        </div>
      </section>

      <BloqueEspecialidades
        panel={panel}
        irA={irA}
        abrirLocal={abrirLocal}
      />

      <BloqueAlumnos panel={panel} />

      <BloqueDinero panel={panel} abrir={abrirRemoto} />

      <BloquePendientes panel={panel} abrir={abrirRemoto} firmaVieja={firmaVieja} />

      <BloqueUso panel={panel} abrir={abrirRemoto} abrirLocal={abrirLocal} bajos={sillonesBajos} />

      {detalle && (
        <EduModal
          title={detalle.titulo}
          subtitle={detalle.detalle}
          onClose={() => setDetalle(null)}
        >
          {detalle.cargando ? (
            <p className="edu-note">Buscando…</p>
          ) : detalle.error ? (
            <div className="edu-alert" role="alert">
              {detalle.error}
            </div>
          ) : detalle.filas.length === 0 ? (
            <div className="edu-empty">
              <p className="edu-empty__title">Aquí no hay nada</p>
              <p className="edu-empty__detail">
                La cifra es cero para este periodo y esta especialidad. Cambia el periodo arriba
                para mirar otra franja.
              </p>
            </div>
          ) : (
            <div className="edu-dir-detalle">
              {detalle.truncated && (
                <p className="edu-note">
                  Se enseñan las primeras {detalle.filas.length}. Acorta el periodo o filtra por
                  especialidad para verlas todas, o expórtalo en CSV.
                </p>
              )}
              {detalle.filas.map((f) => (
                <FilaDetalle key={f.id} fila={f} onNavegar={() => setDetalle(null)} />
              ))}
            </div>
          )}
        </EduModal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Los filtros
// ═══════════════════════════════════════════════════════════════════════

function FiltrosBar({
  panel,
  desde,
  hasta,
  setDesde,
  setHasta,
  irA,
  navegando,
  qs,
  refrescar,
}: {
  panel: EduDirPanel;
  desde: string;
  hasta: string;
  setDesde: (v: string) => void;
  setHasta: (v: string) => void;
  irA: (n: { periodo?: EduDirPeriodo; desde?: string; hasta?: string; especialidad?: string | null }) => void;
  navegando: boolean;
  qs: string;
  refrescar: () => void;
}) {
  const v = panel.ventana;

  return (
    <div className="edu-dir-filtros">
      <div className="edu-dir-filtros__fila">
        <div className="edu-seg" role="group" aria-label="Periodo">
          {EDU_DIR_PERIODOS.map((p) => (
            <button
              key={p}
              type="button"
              className={`edu-seg__btn ${v.periodo === p ? "edu-seg__btn--on" : ""}`}
              aria-pressed={v.periodo === p}
              disabled={navegando}
              onClick={() => irA({ periodo: p })}
            >
              {EDU_DIR_PERIODO_LABELS[p]}
            </button>
          ))}
        </div>

        <label className="edu-field" style={{ minWidth: 200 }}>
          <span className="edu-field__label">Especialidad</span>
          <select
            className="edu-input edu-input--sm"
            /* Un id que no está en la lista (tecleado a mano, o de una
               especialidad dada de baja) cae a "Todas" en el selector: un
               <select> con un value que no existe se pinta VACÍO y no hay
               forma de volver. El aviso de arriba dice qué pasó. */
            value={
              panel.opciones.some((o) => o.id === panel.especialidadId)
                ? panel.especialidadId ?? ""
                : ""
            }
            disabled={navegando}
            onChange={(e) => irA({ especialidad: e.target.value || null })}
          >
            <option value="">Todas</option>
            {panel.opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <span className="edu-dir-filtros__sep" />

        <div className="edu-dir-filtros__fila edu-dir-noprint">
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={refrescar}
            disabled={navegando}
          >
            <RefreshCw size={15} />
            Actualizar
          </button>
          <a
            className="edu-btn edu-btn--ghost edu-btn--sm"
            href={`/api/instituto/direccion/export${qs ? `?${qs}` : ""}`}
          >
            <Download size={15} />
            Exportar CSV
          </a>
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => window.print()}
          >
            <Printer size={15} />
            Imprimir
          </button>
        </div>
      </div>

      {v.periodo === "rango" && (
        <div className="edu-dir-rango">
          <label className="edu-field">
            <span className="edu-field__label">Desde</span>
            <input
              type="date"
              className="edu-input edu-input--sm"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>
          <label className="edu-field">
            <span className="edu-field__label">Hasta</span>
            <input
              type="date"
              className="edu-input edu-input--sm"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            disabled={navegando}
            onClick={() => irA({ periodo: "rango", desde, hasta })}
          >
            Aplicar
          </button>
        </div>
      )}

      <div className="edu-dir-ventana">
        <span className="edu-dir-ventana__label">{v.label}</span>
        <span>{v.compara}</span>
        {panel.especialidadNombre && <span className="edu-tag">{panel.especialidadNombre}</span>}
      </div>

      <div className="edu-dir-leyenda">
        <span className="edu-dir-leyenda__item">
          <span className="edu-dir-punto edu-dir-punto--actuar" aria-hidden="true" />
          Rojo: alguien tiene que actuar
        </span>
        <span className="edu-dir-leyenda__item">
          <span className="edu-dir-punto edu-dir-punto--vigilar" aria-hidden="true" />
          Ámbar: vigilar
        </span>
        <span className="edu-dir-leyenda__item">
          <span className="edu-dir-punto edu-dir-punto--ok" aria-hidden="true" />
          Verde: va bien
        </span>
        <span className="edu-dir-leyenda__item">
          <span className="edu-dir-punto" aria-hidden="true" />
          Gris: es un dato, no un juicio
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · La clínica ahora
// ═══════════════════════════════════════════════════════════════════════

function BloqueAhora({
  ahora,
  latiendo,
  abrirLocal,
  especialidad,
}: {
  ahora: EduDirAhora;
  latiendo: boolean;
  abrirLocal: (titulo: string, texto: string, filas: EduDirDetalleFila[]) => void;
  especialidad: string | null;
}) {
  const ocupados = ahora.sillones.filter((s) => s.estado !== "LIBRE");

  return (
    <section className="edu-dir-bloque">
      <div className="edu-dir-bloque__head">
        <h2 className="edu-dir-bloque__title">La clínica ahora</h2>
        <span className="edu-dir-vivo">
          <span
            className={`edu-dir-vivo__punto ${latiendo ? "" : "edu-dir-vivo__punto--parado"}`}
            aria-hidden="true"
          />
          {latiendo
            ? `En vivo · corte de las ${ahora.horaLabel}`
            : `Sin conexión · último corte, ${ahora.horaLabel}`}
        </span>
      </div>
      <p className="edu-dir-bloque__lead">
        Estas cuatro cifras salen de las citas de hoy: quién llegó, quién está sentado en un
        sillón y quién responde por él. No decimos &laquo;estudiantes conectados&raquo; porque el
        producto no registra presencia — nadie ficha al entrar a la clínica—, y un número de
        sesiones abiertas no es gente en el piso.
      </p>

      <div className="edu-dir-cifras">
        <CifraViva
          label="Pacientes en la clínica"
          value={ahora.pacientesEnClinica}
          note="Llegaron hoy y no se han ido: en recepción o en el sillón."
          onAbrir={() =>
            abrirLocal(
              "Pacientes en la clínica",
              "Los que ya llegaron: en el sillón o esperando en recepción.",
              [
                ...ocupados.map((s) => ({
                  id: `s-${s.chairId}`,
                  titulo: `${s.patientName ?? "—"}${s.patientFolio ? ` · ${s.patientFolio}` : ""}`,
                  sub: s.studentId ? `Sillón ${s.number}` : `Sillón ${s.number} · ${s.studentName ?? "—"}`,
                  // s.studentId es EduStudent, no la cuenta del estudiante.
                  subPersona: s.studentId
                    ? { kind: "estudiante" as EduPersonaKind, id: s.studentId, nombre: s.studentName ?? "—" }
                    : undefined,
                  // El título es el PACIENTE: por tituloPersona y no por el
                  // href a mano que había, para que respete el permiso de
                  // quien mira — misma razón que las filas de recepción.
                  tituloPersona: s.patientId
                    ? { kind: "paciente" as EduPersonaKind, id: s.patientId }
                    : undefined,
                  campos: [
                    { k: "Desde", v: s.desdeLabel ?? "—" },
                    { k: "Estado", v: EDU_DIR_SILLON_LABELS[s.estado] },
                  ],
                  href: null,
                  semaforo: EDU_DIR_SILLON_SEMAFORO[s.estado],
                })),
                ...ahora.recepcion.map((r) => ({
                  id: `r-${r.appointmentId}`,
                  titulo: `${r.patientName} · ${r.patientFolio}`,
                  sub: "En recepción",
                  // r.studentId es EduStudent, no la cuenta del estudiante.
                  subPersona: { kind: "estudiante" as EduPersonaKind, id: r.studentId, nombre: r.studentName },
                  campos: [
                    { k: "Llegó", v: r.desdeLabel },
                    { k: "Lleva", v: eduDirEsperaLabel(r.esperaMinutos) },
                  ],
                  // Por `tituloPersona` y NO por un href a mano: así la ruta
                  // la arma persona-core (un solo sitio) y el enlace respeta
                  // el permiso de quien mira, que un <Link> pelado no mira.
                  tituloPersona: { kind: "paciente" as EduPersonaKind, id: r.patientId },
                  href: null,
                  semaforo: "NEUTRO" as EduDirSemaforo,
                })),
              ],
            )
          }
        />
        <CifraViva
          label="Atendiendo ahora"
          value={ahora.alumnosAtendiendo}
          note="Estudiantes con un paciente en el sillón."
          onAbrir={() =>
            abrirLocal(
              "Atendiendo ahora",
              "Los estudiantes que tienen un paciente en el sillón en este momento.",
              ocupados.map((s) => {
                // El docente responsable dispara el semáforo de esta fila
                // (sin él es ACTUAR): por eso es el que se saca de `campos`
                // y se vuelve el subPersona — con el id de EduUser, no el
                // de EduStudent. El paciente se queda en campos, en texto
                // plano: subPersona es un solo slot por fila.
                const tieneDocente = Boolean(s.supervisorId && s.supervisorName);
                return {
                  id: `a-${s.chairId}`,
                  titulo: s.studentName ?? "—",
                  sub: `${s.programName ?? "Sin especialidad"} · Sillón ${s.number}`,
                  subPersona: tieneDocente
                    ? {
                        kind: "docente" as EduPersonaKind,
                        id: s.supervisorId as string,
                        nombre: s.supervisorName as string,
                      }
                    : undefined,
                  campos: [
                    { k: "Paciente", v: s.patientName ?? "—" },
                    { k: "Desde", v: s.desdeLabel ?? "—" },
                    ...(tieneDocente ? [] : [{ k: "Docente", v: "Sin docente responsable" }]),
                  ],
                  href: s.studentId ? `/instituto/evaluacion/${s.studentId}` : null,
                  semaforo: s.supervisorName ? "NEUTRO" : ("ACTUAR" as EduDirSemaforo),
                };
              }),
            )
          }
        />
        <CifraViva
          label="Sillones en uso"
          value={`${ahora.sillonesEnUso} / ${ahora.sillonesTotal}`}
          note="Ocupar es estar sentado: quien espera en recepción no cuenta."
          onAbrir={null}
        />
        <CifraViva
          label="Docentes responsables"
          value={ahora.docentesResponsables}
          note={
            ahora.sillonesSinDocente > 0
              ? `${ahora.sillonesSinDocente} ${ahora.sillonesSinDocente === 1 ? "sillón ocupado no tiene" : "sillones ocupados no tienen"} docente responsable.`
              : "Quien responde ahora por lo que hay en los sillones."
          }
          semaforo={ahora.sillonesSinDocente > 0 ? "ACTUAR" : "NEUTRO"}
          onAbrir={() =>
            abrirLocal(
              "Docentes responsables",
              "Los docentes que responden ahora mismo por lo que hay en los sillones. Sale del supervisor guardado en la cita y, si la cita no lo trae, del titular vigente del estudiante. No es presencia física: el producto no la registra.",
              ahora.docentes.map((d) => ({
                id: d.userId,
                titulo: d.name,
                // A su FICHA, no a la lista — y sin construir la URL a
                // mano: eso lo hace EduPersonaLink (con el permiso de quien
                // mira ya cableado). d.userId es EduUser.
                tituloPersona: { kind: "docente" as EduPersonaKind, id: d.userId },
                sub: d.porTitularidad
                  ? "Responde por ser el titular vigente de su estudiante"
                  : "Figura como supervisor en la cita",
                campos: [{ k: "Sillones", v: String(d.sillones) }],
                href: null,
                semaforo: "NEUTRO" as EduDirSemaforo,
              })),
            )
          }
        />
      </div>

      {ahora.sillones.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay sillones dados de alta</p>
          <p className="edu-empty__detail">
            Sin al menos una unidad dental no se puede agendar a nadie, y esta rejilla se queda
            vacía. Se dan de alta en Sillones, con el número que está pintado en la pared.
          </p>
        </div>
      ) : (
        <div className="edu-dir-sillones">
          {ahora.sillones.map((s) => (
            <article
              key={s.chairId}
              className={`edu-dir-sillon edu-dir-sillon--${s.estado.toLowerCase().replace("_", "-")}`}
            >
              <p className="edu-dir-sillon__n">
                <span>Sillón {s.number}</span>
                <span className={PUNTO_POR_SEMAFORO[EDU_DIR_SILLON_SEMAFORO[s.estado]]} aria-hidden="true" />
              </p>
              {s.estado === "LIBRE" ? (
                <>
                  <p className="edu-dir-sillon__quien">{s.name}</p>
                  <p className="edu-dir-sillon__estado">Libre</p>
                </>
              ) : (
                <>
                  <p className="edu-dir-sillon__quien">
                    <EduPersonaLink kind="paciente" id={s.patientId}>
                      {s.patientName}
                    </EduPersonaLink>
                  </p>
                  <p className="edu-dir-sillon__meta">
                    <EduPersonaLink kind="estudiante" id={s.studentId}>
                      {s.studentName}
                    </EduPersonaLink>
                    {s.programName ? ` · ${s.programName}` : ""}
                  </p>
                  <p className="edu-dir-sillon__meta">
                    Desde las {s.desdeLabel}
                    {s.supervisorName ? (
                      <>
                        {" · "}
                        <EduPersonaLink kind="docente" id={s.supervisorId}>
                          {s.supervisorName}
                        </EduPersonaLink>
                      </>
                    ) : (
                      " · sin docente"
                    )}
                  </p>
                  <p className="edu-dir-sillon__estado">
                    {s.esperaMinutos === null
                      ? "Atendiendo"
                      : `Esperando docente · ${eduDirEsperaLabel(s.esperaMinutos)}${s.esperaEtapa ? ` (${s.esperaEtapa})` : ""}`}
                  </p>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {ahora.recepcion.length > 0 && (
        <p className="edu-note">
          {ahora.recepcion.length}{" "}
          {ahora.recepcion.length === 1
            ? "paciente esperando en recepción"
            : "pacientes esperando en recepción"}
          , sin sillón todavía
          {especialidad ? ` (solo ${especialidad})` : ""}.
        </p>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · Por especialidad
// ═══════════════════════════════════════════════════════════════════════

function BloqueEspecialidades({
  panel,
  irA,
  abrirLocal,
}: {
  panel: EduDirPanel;
  irA: (n: { especialidad?: string | null }) => void;
  abrirLocal: (titulo: string, texto: string, filas: EduDirDetalleFila[]) => void;
}) {
  return (
    <section className="edu-dir-bloque">
      <div className="edu-dir-bloque__head">
        <h2 className="edu-dir-bloque__title">Por especialidad</h2>
        {panel.especialidadId && (
          <button
            type="button"
            className="edu-btn edu-btn--quiet edu-btn--sm"
            onClick={() => irA({ especialidad: null })}
          >
            Ver todas
          </button>
        )}
      </div>
      <p className="edu-dir-bloque__lead">
        Tocar una fila filtra el tablero entero a esa especialidad. Los pacientes se cuentan por
        la especialidad del <strong>estudiante</strong> que los atendió; el dinero, por la del{" "}
        <strong>caso</strong> al que se colgó el cobro — que es la única forma de atribuirlo, y
        por eso hay cobros que no se pueden atribuir a ninguna.
      </p>

      {panel.especialidades.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay especialidades</p>
          <p className="edu-empty__detail">
            Se dan de alta en Especialidades y generaciones. Sin ellas no hay estudiantes que medir
            ni casos que abrir.
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--especialidades">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Especialidad</span>
            <span>Estudiantes</span>
            <span>En clínica hoy</span>
            <span>Pacientes</span>
            <span>Cobrado</span>
            <span>Avance del ciclo</span>
            <span>Estado</span>
          </div>
          {panel.especialidades.map((e) => (
            <button
              key={e.programId}
              type="button"
              className="edu-dir-fila-click"
              onClick={() => irA({ especialidad: e.programId })}
              title={`Filtrar el tablero a ${e.programName}`}
            >
              <div className="edu-row">
                <span className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Especialidad</span>
                  <span className="edu-cell__value edu-cell__value--strong">{e.programName}</span>
                </span>
                <span className="edu-cell">
                  <span className="edu-cell__label">Estudiantes</span>
                  <span className="edu-cell__value">{e.alumnos}</span>
                </span>
                <span className="edu-cell">
                  <span className="edu-cell__label">En clínica hoy</span>
                  <span className="edu-cell__value">{e.enClinicaHoy}</span>
                </span>
                <span className="edu-cell">
                  <span className="edu-cell__label">Pacientes</span>
                  <span className="edu-cell__value">{e.pacientes}</span>
                </span>
                <span className="edu-cell">
                  <span className="edu-cell__label">Cobrado</span>
                  <span className="edu-cell__value">{eduMoney(e.cobradoCents)}</span>
                </span>
                <span className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Avance del ciclo</span>
                  <span className="edu-dir-avance">
                    <span className="edu-progreso">
                      <span
                        className="edu-progreso__bar"
                        style={{ width: `${Math.round((e.avance ?? 0) * 100)}%` }}
                      />
                      {e.esperado !== null && (
                        <span
                          className="edu-progreso__meta"
                          style={{ left: `${Math.round(e.esperado * 100)}%` }}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="edu-dir-avance__cifra">
                      {eduDirPctLabel(e.avance)}
                      {e.esperado !== null ? ` · se espera ${eduDirPctLabel(e.esperado)}` : ""}
                    </span>
                  </span>
                </span>
                <span className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span
                    className={`edu-tag ${EDU_DIR_SEMAFORO_TAG[eduDirSemaforoDeAtraso(e.estado)]}`}
                  >
                    {eduDirAtrasoLabel(e.estado)}
                  </span>
                </span>
                <span className="edu-cell edu-cell--wide">
                  <span className="edu-cell__sub">{e.motivo}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {panel.cobradoSinCaso > 0 && (
        <div className="edu-dir-money">
        <button
          type="button"
          className="edu-dir-money__fila edu-dir-money__fila--vigilar"
          onClick={() =>
            abrirLocal(
              "Cobrado sin especialidad",
              "Caja cobra sin abrir expediente clínico, así que un cobro solo se puede atribuir a una especialidad cuando trae caso. Esto es lo que quedó fuera del reparto de arriba: no se reparte a ojo.",
              [],
            )
          }
        >
          <span className="edu-dir-money__k">Cobrado que no se puede atribuir (sin caso)</span>
          <span className="edu-dir-money__v">{eduMoney(panel.cobradoSinCaso)}</span>
          <span className="edu-dir-money__nota">
            Colgarle el caso al cobro desde la ficha del paciente es lo que hace que este dinero
            aparezca en su especialidad.
          </span>
        </button>
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · Alumnos
// ═══════════════════════════════════════════════════════════════════════

function BloqueAlumnos({ panel }: { panel: EduDirPanel }) {
  return (
    <section className="edu-dir-bloque">
      <div className="edu-dir-bloque__head">
        <h2 className="edu-dir-bloque__title">Estudiantes</h2>
        <Link href="/instituto/evaluacion" className="edu-btn edu-btn--quiet edu-btn--sm">
          Ver todos
        </Link>
      </div>
      <p className="edu-dir-bloque__lead">
        El atraso y su motivo salen de Evaluación: es la misma cuenta, no una segunda. El motivo
        va siempre visible porque es la frase que se lee en voz alta delante del estudiante.
      </p>

      <div className="edu-dir-alumnos">
        <div className="edu-dir-caja">
          <div className="edu-dir-caja__head">
            <h3 className="edu-dir-caja__title">Más actividad en el periodo</h3>
            <p className="edu-dir-caja__lead">Por pacientes distintos atendidos.</p>
          </div>
          {panel.masActivos.length === 0 ? (
            <p className="edu-note" style={{ padding: "12px 14px" }}>
              Ningún estudiante terminó una cita en este periodo.
            </p>
          ) : (
            panel.masActivos.map((a) => <FilaAlumno key={a.studentId} a={a} conMotivo={false} />)
          )}
        </div>

        <div className="edu-dir-caja">
          <div className="edu-dir-caja__head">
            <h3 className="edu-dir-caja__title">Van atrasados</h3>
            <p className="edu-dir-caja__lead">Contra lo esperado a esta altura del ciclo.</p>
          </div>
          {panel.atrasados.length === 0 ? (
            <p className="edu-note" style={{ padding: "12px 14px" }}>
              Nadie va por debajo de lo esperado. Si tampoco hay requisitos capturados, esto dice
              lo mismo que un cero: captúralos en Requisitos.
            </p>
          ) : (
            panel.atrasados.map((a) => <FilaAlumno key={a.studentId} a={a} conMotivo />)
          )}
        </div>
      </div>
    </section>
  );
}

function FilaAlumno({ a, conMotivo }: { a: EduDirAlumnoRow; conMotivo: boolean }) {
  const sem = eduDirSemaforoDeAtraso(a.estado);
  return (
    <div className="edu-dir-alumno">
      <div className="edu-dir-alumno__head">
        <Link href={`/instituto/evaluacion/${a.studentId}`} className="edu-dir-alumno__name">
          {a.studentName}
        </Link>
        <span className={`edu-tag ${EDU_DIR_SEMAFORO_TAG[sem]}`}>{eduDirAtrasoLabel(a.estado)}</span>
      </div>
      <p className="edu-dir-alumno__meta">
        {a.matricula} · {a.programName} · {a.pacientes} pacientes · {a.citas} citas · {a.horasLabel}
      </p>
      {conMotivo && a.motivo && <p className="edu-dir-alumno__motivo">{a.motivo}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · Dinero
// ═══════════════════════════════════════════════════════════════════════

function BloqueDinero({
  panel,
  abrir,
}: {
  panel: EduDirPanel;
  abrir: (k: EduDirDetalleKey) => void;
}) {
  const d = panel.dinero;
  return (
    <section className="edu-dir-bloque">
      <div className="edu-dir-bloque__head">
        <h2 className="edu-dir-bloque__title">Dinero</h2>
        <span className="edu-count">{d.cobros} cobros emitidos</span>
      </div>
      <p className="edu-dir-bloque__lead">
        <strong>Cobrado</strong> es lo que entró (pagos menos devoluciones, por la fecha del
        pago); <strong>emitido</strong> es lo que se facturó en el periodo. No son lo mismo y por
        eso van los dos: un mes puede emitir mucho y cobrar poco.
      </p>

      <div className="edu-dir-money">
        <FilaMoney
          k="Cobrado en el periodo"
          v={eduMoney(d.cobradoCents)}
          fuerte
          onAbrir={() => abrir("cobros")}
        />
        <FilaMoney
          k="Emitido en el periodo"
          v={eduMoney(d.emitidoCents)}
          onAbrir={() => abrir("cobros")}
        />
        <FilaMoney
          k="Pendiente de cobro"
          v={eduMoney(d.pendienteCents)}
          nota="Saldo vivo de los cobros emitidos en este periodo."
          onAbrir={() => abrir("pendiente-cobro")}
        />
      </div>

      <h3 className="edu-dir-caja__title">El desglose que es un control</h3>
      <p className="edu-dir-bloque__lead">
        La tarifa de <strong>paciente de estudiante</strong> es más barata que la de público general.
        Estas cuatro filas cruzan la lista de precios que se APLICÓ con el origen REAL del
        paciente: si la barata se está aplicando a gente que llegó sola a la clínica, aquí se ve.
      </p>

      <div className="edu-dir-money">
        <FilaMoney
          k="Emitido · el paciente llegó solo"
          v={eduMoney(d.publicoCents)}
          onAbrir={() => abrir("cobrado-publico")}
        />
        <FilaMoney
          k="Emitido · lo trajo un estudiante"
          v={eduMoney(d.alumnoCents)}
          onAbrir={() => abrir("cobrado-alumno")}
        />
        <FilaMoney
          k={`Tarifa de estudiante a paciente que llegó solo (${d.controlCount})`}
          v={eduMoney(d.controlCents)}
          tono={d.controlCount > 0 ? "control" : undefined}
          nota={
            d.controlCount > 0
              ? "O falta marcar quién trajo a esos pacientes, o se cobró de menos. Ábrelo y revisa uno por uno."
              : "Ninguno: la tarifa barata solo se aplicó a pacientes que trajo un estudiante."
          }
          onAbrir={() => abrir("control-tarifa")}
        />
        <FilaMoney
          k={`Paciente de estudiante cobrado con la lista general (${d.inversoCount})`}
          v={eduMoney(d.inversoCents)}
          tono={d.inversoCount > 0 ? "vigilar" : undefined}
          nota={
            d.inversoCount > 0
              ? "Al revés: o se le cobró de más, o el origen se marcó después del cobro."
              : "Ninguno."
          }
          onAbrir={() => abrir("control-inverso")}
        />
        {d.sinListaCount > 0 && (
          <FilaMoney
            k={`Sin lista de precios guardada (${d.sinListaCount})`}
            v={eduMoney(d.sinListaCents)}
            nota="Estos cobros no se pueden clasificar en ninguna de las dos filas de arriba, así que no cuentan como correctos ni como incorrectos."
            onAbrir={() => abrir("cobros")}
          />
        )}
      </div>

      <div className="edu-dir-cifras">
        <CifraViva
          label="Ticket promedio"
          value={d.ticketPromedioCents === null ? "—" : eduMoney(d.ticketPromedioCents)}
          note="Emitido ÷ cobros del periodo."
          dinero
          onAbrir={null}
        />
        <CifraViva
          label="Ingreso por sillón"
          value={d.porSillonCents === null ? "—" : eduMoney(d.porSillonCents)}
          note={`Cobrado ÷ ${d.sillonesActivos} ${d.sillonesActivos === 1 ? "sillón activo" : "sillones activos"}.`}
          dinero
          onAbrir={null}
        />
      </div>
    </section>
  );
}

function FilaMoney({
  k,
  v,
  nota,
  tono,
  fuerte,
  onAbrir,
}: {
  k: string;
  v: string;
  nota?: string;
  tono?: "control" | "vigilar";
  fuerte?: boolean;
  onAbrir?: (() => void) | null;
}) {
  const clase = [
    "edu-dir-money__fila",
    tono === "control" ? "edu-dir-money__fila--control" : "",
    tono === "vigilar" ? "edu-dir-money__fila--vigilar" : "",
    fuerte ? "edu-dir-money__fila--fuerte" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cuerpo = (
    <>
      <span className="edu-dir-money__k">{k}</span>
      <span className="edu-dir-money__v">{v}</span>
      {nota && <span className="edu-dir-money__nota">{nota}</span>}
    </>
  );

  if (!onAbrir) return <div className={clase}>{cuerpo}</div>;
  return (
    <button type="button" className={clase} onClick={onAbrir}>
      {cuerpo}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · Pendientes
// ═══════════════════════════════════════════════════════════════════════

function BloquePendientes({
  panel,
  abrir,
  firmaVieja,
}: {
  panel: EduDirPanel;
  abrir: (k: EduDirDetalleKey) => void;
  firmaVieja: boolean;
}) {
  const p = panel.pendientes;
  return (
    <section className="edu-dir-bloque">
      <div className="edu-dir-bloque__head">
        <h2 className="edu-dir-bloque__title">Pendientes</h2>
      </div>
      <p className="edu-dir-bloque__lead">
        Cuatro cosas que alguien tiene que destrabar. Van aquí abajo y del mismo tamaño que todo
        lo demás a propósito: un bloque rojo arriba convierte el tablero en una lista de quejas.
      </p>
      <div className="edu-dir-cifras">
        <CifraViva
          label="Casos esperando firma"
          value={p.firmas}
          semaforo={p.firmas === 0 ? "OK" : firmaVieja ? "ACTUAR" : "VIGILAR"}
          note={
            p.firmaMasViejaMin === null
              ? "Ninguno: nadie está esperando a un docente."
              : `El más viejo lleva ${eduDirEsperaLabel(p.firmaMasViejaMin)} esperando.`
          }
          onAbrir={() => abrir("firmas-pendientes")}
        />
        <CifraViva
          label="Pacientes sin estudiante"
          value={p.pacientesSinAlumno}
          semaforo={p.pacientesSinAlumno === 0 ? "OK" : "VIGILAR"}
          note="Registrados, sin caso abierto y sin cita próxima: no los ve ningún estudiante ni ningún docente. No depende de la especialidad — un paciente sin caso no tiene ninguna."
          onAbrir={() => abrir("pacientes-sin-alumno")}
        />
        <CifraViva
          label="Calificaciones sin registrar"
          value={p.calificacionesSinRegistrar}
          semaforo={p.calificacionesSinRegistrar === 0 ? "OK" : "VIGILAR"}
          note="Casos terminados en el periodo que todavía no tienen calificación vigente."
          onAbrir={() => abrir("calificaciones-pendientes")}
        />
        <CifraViva
          label="Estudiantes sin docente"
          value={p.alumnosSinDocente}
          semaforo={p.alumnosSinDocente === 0 ? "OK" : "ACTUAR"}
          note="Sin asignación vigente, nadie les puede firmar una autorización."
          onAbrir={() => abrir("alumnos-sin-docente")}
        />
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · Uso de la clínica
// ═══════════════════════════════════════════════════════════════════════

function BloqueUso({
  panel,
  abrir,
  abrirLocal,
  bajos,
}: {
  panel: EduDirPanel;
  abrir: (k: EduDirDetalleKey) => void;
  abrirLocal: (titulo: string, texto: string, filas: EduDirDetalleFila[]) => void;
  bajos: EduDirPanel["uso"]["sillones"];
}) {
  const u = panel.uso;
  const filasSillon = (rows: EduDirPanel["uso"]["sillones"]): EduDirDetalleFila[] =>
    rows.map((s) => ({
      id: s.chairId,
      titulo: `Sillón ${s.number} · ${s.name}`,
      sub:
        s.capacidadMin === null
          ? "Sin horario capturado: no hay contra qué dividir, así que no entra en la ocupación."
          : `${eduHoursLabel(s.usadosMin)} usadas de ${eduHoursLabel(s.capacidadMin)} abiertas`,
      campos: [
        { k: "Citas", v: String(s.citas) },
        { k: "Ocupación", v: eduDirPctLabel(s.ocupacion) },
      ],
      href: "/instituto/sillones",
      semaforo:
        s.capacidadMin === null
          ? "NEUTRO"
          : s.ocupacion !== null && s.ocupacion < EDU_DIR_SILLON_BAJO
            ? "VIGILAR"
            : "OK",
    }));

  return (
    <section className="edu-dir-bloque">
      <div className="edu-dir-bloque__head">
        <h2 className="edu-dir-bloque__title">Uso de la clínica</h2>
        {u.sillonesSinHorario > 0 && (
          <span className="edu-chip">
            <AlertTriangle size={12} aria-hidden="true" />
            {u.sillonesSinHorario} sin horario
          </span>
        )}
      </div>
      <p className="edu-dir-bloque__lead">
        Las horas usadas salen de las citas <strong>terminadas</strong> y las horas abiertas, del
        horario de cada sillón. Un sillón sin horario está &laquo;siempre abierto&raquo;, así que
        no hay contra qué dividir: queda fuera de la ocupación y se dice cuántos son.
      </p>

      <div className="edu-dir-cifras">
        <CifraViva
          label="Ocupación promedio"
          value={eduDirPctLabel(u.ocupacion)}
          note={
            u.capacidadMin === null
              ? "No se puede calcular: ningún sillón tiene horario capturado."
              : `Sobre los ${u.sillones.length - u.sillonesSinHorario} sillones con horario.`
          }
          semaforo={u.ocupacion === null ? "NEUTRO" : u.ocupacion < EDU_DIR_SILLON_BAJO ? "VIGILAR" : "OK"}
          onAbrir={() =>
            abrirLocal(
              "Sillón a sillón",
              "Cuánto se usó cada unidad dental en el periodo, contra las horas que estuvo abierta.",
              filasSillon(u.sillones),
            )
          }
        />
        <CifraViva
          label="Horas de sillón usadas"
          value={eduHoursLabel(u.usadosMin)}
          note="Suma de las citas terminadas, con el tope de 8 h por cita."
          onAbrir={() => abrir("citas-completadas")}
        />
        <CifraViva
          label="Horas sin usar"
          value={u.libresMin === null ? "—" : eduHoursLabel(u.libresMin)}
          note="Horas abiertas que nadie ocupó, solo de los sillones con horario."
          onAbrir={() =>
            abrirLocal(
              "Sillón a sillón",
              "Cuánto se usó cada unidad dental en el periodo, contra las horas que estuvo abierta.",
              filasSillon(u.sillones),
            )
          }
        />
        <CifraViva
          label={`Sillones bajo ${Math.round(EDU_DIR_SILLON_BAJO * 100)} %`}
          value={bajos.length}
          semaforo={bajos.length === 0 ? "OK" : "VIGILAR"}
          note="Desaprovechados en este periodo. No es una urgencia: es dónde caben más pacientes."
          onAbrir={() =>
            abrirLocal(
              `Sillones bajo ${Math.round(EDU_DIR_SILLON_BAJO * 100)} %`,
              "Los que se usaron menos de lo que estuvieron abiertos. Ahí es donde cabe más gente.",
              filasSillon(bajos),
            )
          }
        />
        <CifraViva
          label="Citas perdidas"
          value={u.citasPerdidas}
          semaforo={u.citasPerdidas === 0 ? "OK" : "VIGILAR"}
          note={`${u.noShow} no llegaron · ${u.canceladas} canceladas. Cada una es un hueco de sillón que se pudo haber usado.`}
          onAbrir={() => abrir("citas-perdidas")}
        />
        <CifraViva
          label="Duración promedio"
          value={u.duracionPromedioMin === null ? "—" : eduHoursLabel(u.duracionPromedioMin)}
          note="De una cita terminada, de los sellos reales cuando los hay."
          onAbrir={() => abrir("citas-completadas")}
        />
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas
// ═══════════════════════════════════════════════════════════════════════

function Cifra({
  cifra,
  onAbrir,
}: {
  cifra: EduDirCifra;
  onAbrir: (k: EduDirDetalleKey) => void;
}) {
  const clase = `edu-dir-cifra ${CLASE_POR_SEMAFORO[cifra.semaforo]}`;
  const esDinero = cifra.label.toLowerCase().startsWith("cobrado");

  const cuerpo = (
    <>
      <span className="edu-dir-cifra__label">{cifra.label}</span>
      <span className={`edu-dir-cifra__n ${esDinero ? "edu-dir-cifra__n--dinero" : ""}`}>
        {cifra.value}
      </span>
      {cifra.variacion && (
        <span className="edu-dir-cifra__var">
          <Flecha sentido={cifra.variacion.sentido} />
          {cifra.variacion.texto}
        </span>
      )}
      <span className="edu-dir-cifra__note">{cifra.note}</span>
    </>
  );

  return (
    <div className={clase}>
      {cifra.detalle ? (
        <button
          type="button"
          onClick={() => onAbrir(cifra.detalle as EduDirDetalleKey)}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            border: 0,
            background: "transparent",
            padding: 0,
            font: "inherit",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {cuerpo}
        </button>
      ) : (
        cuerpo
      )}

      {cifra.sub && (
        <button
          type="button"
          className="edu-dir-cifra__sub"
          onClick={() => cifra.sub?.detalle && onAbrir(cifra.sub.detalle)}
        >
          <span className="edu-dir-cifra__subn">{cifra.sub.value}</span>
          <span className="edu-dir-cifra__sublabel">
            {cifra.sub.label}
            {cifra.sub.variacion ? ` · ${cifra.sub.variacion.texto}` : ""}
          </span>
        </button>
      )}
    </div>
  );
}

/** Una cifra que no viene del catálogo de tarjetas (las del bloque en vivo,
 *  las de uso y las de dinero). Misma caja, mismo semáforo. */
function CifraViva({
  label,
  value,
  note,
  semaforo = "NEUTRO",
  dinero,
  onAbrir,
}: {
  label: string;
  value: string | number;
  note: string;
  semaforo?: EduDirSemaforo;
  dinero?: boolean;
  onAbrir: (() => void) | null;
}) {
  const cuerpo = (
    <>
      <span className="edu-dir-cifra__label">{label}</span>
      <span className={`edu-dir-cifra__n ${dinero ? "edu-dir-cifra__n--dinero" : ""}`}>
        {value}
      </span>
      <span className="edu-dir-cifra__note">{note}</span>
    </>
  );
  const clase = `edu-dir-cifra ${CLASE_POR_SEMAFORO[semaforo]}`;

  if (!onAbrir) return <div className={clase}>{cuerpo}</div>;
  return (
    <button type="button" className={clase} onClick={onAbrir}>
      {cuerpo}
    </button>
  );
}

function Flecha({ sentido }: { sentido: 1 | 0 | -1 }) {
  if (sentido === 1) return <ArrowUpRight size={14} aria-hidden="true" />;
  if (sentido === -1) return <ArrowDownRight size={14} aria-hidden="true" />;
  return <Minus size={14} aria-hidden="true" />;
}

function FilaDetalle({ fila, onNavegar }: { fila: EduDirDetalleFila; onNavegar: () => void }) {
  const clase = [
    "edu-dir-detalle__fila",
    fila.semaforo === "ACTUAR" ? "edu-dir-detalle__fila--actuar" : "",
    fila.semaforo === "VIGILAR" ? "edu-dir-detalle__fila--vigilar" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={clase}>
      <p className="edu-dir-detalle__titulo">
        {fila.tituloPersona ? (
          <EduPersonaLink kind={fila.tituloPersona.kind} id={fila.tituloPersona.id}>
            {fila.titulo}
          </EduPersonaLink>
        ) : fila.href ? (
          <Link href={fila.href} onClick={onNavegar}>
            {fila.titulo}
          </Link>
        ) : (
          fila.titulo
        )}
      </p>
      {(fila.sub || fila.subPersona) && (
        <p className="edu-dir-detalle__sub">
          {fila.subPersona && (
            <EduPersonaLink kind={fila.subPersona.kind} id={fila.subPersona.id}>
              {fila.subPersona.nombre}
            </EduPersonaLink>
          )}
          {fila.subPersona && fila.sub ? " · " : ""}
          {fila.sub}
        </p>
      )}
      {fila.campos.length > 0 && (
        <p className="edu-dir-detalle__campos">
          {fila.campos.map((c) => (
            <span key={c.k} className="edu-dir-detalle__campo">
              <span>{c.k}: </span>
              <b>{c.v}</b>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
