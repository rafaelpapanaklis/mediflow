"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_ODONTOGRAM_NOTE_KEY,
  EDU_TOOTH_WHOLE,
  eduConditionLabel,
  eduEntriesToRecords,
  eduRecordsSummary,
  type EduOdontogramEntryRow,
} from "@/lib/edu/odontograma-core";

// ═══════════════════════════════════════════════════════════════════════
// 🔴 EL DIBUJO SE **IMPORTA** DEL DENTAL. NO SE COPIA Y NO SE TOCA.
//
// `src/components/dashboard/odontogram-v2/` es un módulo de presentación
// PURO: sus piezas (Odontogram, Surface2D, ToothGlyph, OdoDefs, Palette,
// Legend, DetailPanel, data.ts, types.ts) no importan NADA de "@/", no
// tocan prisma, no hacen fetch y no leen `window`. Reciben props y pintan.
// Traen los 45 hallazgos agrupados por especialidad y la clasificación
// anatómica FDI, que es exactamente lo que una escuela de odontología
// necesita.
//
// Lo ÚNICO acoplado al dental en esa carpeta es su raíz `App.tsx`
// (OdontogramV2), que en modo "vivo" habla con /api/odontogram y escribe
// en la tabla `odontogram_entries` del producto dental, más su
// `adapter.ts`. Esos DOS archivos no se usan aquí: este componente es el
// contenedor equivalente del vertical, y escribe en
// /api/instituto/pacientes/[id]/odontograma.
//
// Copiar la carpeta habría dado dos catálogos que empiezan iguales y
// terminan distintos: el día que alguien agregue un hallazgo al del
// dental, el del instituto seguiría sin tenerlo y nadie lo notaría hasta
// que un alumno intentara marcarlo.
//
// El CSS del dental viene entero bajo `.odo-app`, así que no se pisa con el
// del panel; edu-theme.css solo corrige que ese contenedor está pensado
// para ocupar una pantalla completa (`.edu-odo .odo-app`).
// ═══════════════════════════════════════════════════════════════════════
import { OdoDefs } from "@/components/dashboard/odontogram-v2/OdoDefs";
import { Odontogram } from "@/components/dashboard/odontogram-v2/Odontogram";
import { Palette } from "@/components/dashboard/odontogram-v2/Palette";
import { Legend } from "@/components/dashboard/odontogram-v2/Legend";
import { COND_BY_ID } from "@/components/dashboard/odontogram-v2/data";
import { EMPTY_RECORD } from "@/components/dashboard/odontogram-v2/types";
import type {
  ApplyKind,
  Dentition,
  Records,
  SurfaceLetter,
} from "@/components/dashboard/odontogram-v2/types";
import "@/components/dashboard/odontogram-v2/odontogram.css";

/**
 * El panel de detalle trae un diente en 3D (three.js). Se carga SOLO
 * cuando alguien abre un diente: son cientos de KB de shader que el piso
 * clínico no necesita para mirar el dibujo, y esta pantalla se abre en un
 * teléfono con datos móviles.
 */
const DetailPanel = dynamic(
  () => import("@/components/dashboard/odontogram-v2/DetailPanel").then((m) => m.DetailPanel),
  { ssr: false },
);

export interface EduOdontogramaScreenProps {
  patientId: string;
  entries: EduOdontogramEntryRow[];
  canEdit: boolean;
}

/**
 * /instituto/pacientes/[id]/odontograma
 *
 * ── CÓMO SE GUARDA ──────────────────────────────────────────────────────
 * Optimista: el clic se pinta ANTES de que el servidor conteste, porque un
 * odontograma con medio segundo de retraso por diente es insoportable de
 * usar. Si el servidor rechaza (un hallazgo que no va en esa cara, una
 * sesión caducada), se DESHACE el cambio y se enseña el motivo. Nunca se
 * deja pintado algo que no se guardó: un odontograma que miente es peor que
 * uno vacío.
 *
 * ── LO QUE ESTA PANTALLA NO DECIDE ──────────────────────────────────────
 * Ni qué paciente se ve (lo resolvió el servidor con el alcance clínico) ni
 * quién puede marcar (`canEdit` llega resuelto y el endpoint lo vuelve a
 * exigir). En solo lectura el pincel no se pinta.
 */
export function EduOdontogramaScreen({
  patientId,
  entries,
  canEdit,
}: EduOdontogramaScreenProps) {
  const [records, setRecords] = useState<Records>(() => eduEntriesToRecords(entries));
  const [dentition, setDentition] = useState<Dentition>("permanent");
  const [brush, setBrush] = useState<string | null>(null);
  const [eraser, setEraser] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(0);

  // 🔴 El contador se calcula sobre el MAPA que se está pintando, no sobre
  // las filas que llegaron del servidor. Como el marcado es optimista y no
  // se recarga la página por cada clic, contar las filas diría "2 hallazgos"
  // con tres dibujados — y de las dos cifras, la que la persona cree es la
  // que ve.
  const resumen = eduRecordsSummary(records);

  // `records` por ref: `apply` lo lee en el momento del clic sin llevarlo
  // en sus dependencias, así su identidad es estable y los React.memo de
  // las 32 celdas del dibujo no se invalidan en cada pintado.
  const recordsRef = useRef(records);
  recordsRef.current = records;

  const escribir = useCallback(
    async (body: Record<string, unknown>, deshacer: () => void) => {
      setGuardando((n) => n + 1);
      try {
        await eduRequest(`/api/instituto/pacientes/${patientId}/odontograma`, {
          method: "PUT",
          body,
        });
        setError(null);
      } catch (err) {
        // Se deshace lo pintado: dejar el hallazgo en pantalla haría creer
        // que quedó guardado.
        deshacer();
        setError(err instanceof Error ? err.message : "No se pudo guardar el hallazgo.");
      } finally {
        setGuardando((n) => n - 1);
      }
    },
    [patientId],
  );

  const apply = useCallback(
    (fdi: number, kind: ApplyKind, letter?: SurfaceLetter | string) => {
      if (!canEdit) {
        setSelected(fdi);
        return;
      }
      const antes = recordsRef.current;
      const rec = antes[fdi] ?? EMPTY_RECORD;

      // ── Goma: quita lo que haya en esa cara (o en el diente) ──────────
      if (eraser || kind === "glyphErase") {
        const enCara = kind === "surface" && letter;
        const ids = enCara ? (rec.surfaces?.[String(letter)] ?? []) : (rec.tooth ?? []);
        if (ids.length === 0) return;

        const siguiente = clonar(antes, fdi, (r) => {
          if (enCara) delete r.surfaces[String(letter)];
          else r.tooth = [];
        });
        setRecords(siguiente);
        // Una petición por hallazgo: son pocos (lo que quepa en una cara) y
        // así un fallo suelto no se lleva los demás.
        for (const condition of ids) {
          void escribir(
            { tooth: fdi, surface: enCara ? letter : null, condition, present: false },
            () => setRecords(antes),
          );
        }
        return;
      }

      // ── Sin pincel: se abre el detalle del diente ─────────────────────
      if (!brush) {
        setSelected(fdi);
        return;
      }

      const cond = COND_BY_ID[brush];
      if (!cond) return;

      const enCara = kind === "surface" && cond.target === "surface";
      const cara = enCara ? String(letter) : null;
      const yaEstaba = enCara
        ? Boolean(rec.surfaces?.[cara as string]?.includes(brush))
        : Boolean(rec.tooth?.includes(brush));

      const siguiente = clonar(antes, fdi, (r) => {
        if (enCara) {
          const k = cara as string;
          if (!r.surfaces[k]) r.surfaces[k] = [];
          alternar(r.surfaces[k], brush);
        } else {
          alternar(r.tooth, brush);
        }
      });
      setRecords(siguiente);
      void escribir({ tooth: fdi, surface: cara, condition: brush, present: !yaEstaba }, () =>
        setRecords(antes),
      );
    },
    [brush, canEdit, eraser, escribir],
  );

  const quitar = useCallback(
    (fdi: number, scope: "surface" | "tooth", letter: string | undefined, condId: string) => {
      if (!canEdit) return;
      const antes = recordsRef.current;
      const siguiente = clonar(antes, fdi, (r) => {
        if (scope === "surface" && letter) {
          const i = (r.surfaces[letter] ?? []).indexOf(condId);
          if (i >= 0) r.surfaces[letter].splice(i, 1);
        } else {
          const i = r.tooth.indexOf(condId);
          if (i >= 0) r.tooth.splice(i, 1);
        }
      });
      setRecords(siguiente);
      void escribir(
        {
          tooth: fdi,
          surface: scope === "surface" ? (letter ?? null) : null,
          condition: condId,
          present: false,
        },
        () => setRecords(antes),
      );
    },
    [canEdit, escribir],
  );

  const limpiarDiente = useCallback(
    (fdi: number) => {
      if (!canEdit) return;
      const antes = recordsRef.current;
      const rec = antes[fdi];
      if (!rec) return;
      const siguiente = clonar(antes, fdi, (r) => {
        r.tooth = [];
        r.surfaces = {};
      });
      setRecords(siguiente);
      for (const condition of rec.tooth ?? []) {
        void escribir({ tooth: fdi, surface: null, condition, present: false }, () =>
          setRecords(antes),
        );
      }
      for (const [cara, ids] of Object.entries(rec.surfaces ?? {})) {
        for (const condition of ids) {
          void escribir({ tooth: fdi, surface: cara, condition, present: false }, () =>
            setRecords(antes),
          );
        }
      }
    },
    [canEdit, escribir],
  );

  const anotar = useCallback(
    async (fdi: number, texto: string) => {
      if (!canEdit) return;
      const antes = recordsRef.current;
      setRecords(clonar(antes, fdi, (r) => {
        r.note = texto;
      }));
      setGuardando((n) => n + 1);
      try {
        // La nota va por PATCH y no por PUT: se guarda con una key
        // RESERVADA que el saneo del PUT rechaza a propósito, para que el
        // pincel no pueda pisarla ni borrarla.
        await eduRequest(`/api/instituto/pacientes/${patientId}/odontograma`, {
          method: "PATCH",
          body: { tooth: fdi, notes: texto },
        });
        setError(null);
      } catch (err) {
        setRecords(antes);
        setError(err instanceof Error ? err.message : "No se pudo guardar la nota.");
      } finally {
        setGuardando((n) => n - 1);
      }
    },
    [canEdit, patientId],
  );

  const pickBrush = useCallback((id: string) => {
    setEraser(false);
    setBrush((b) => (b === id ? null : id));
  }, []);
  const pickEraser = useCallback(() => {
    setBrush(null);
    setEraser((e) => !e);
  }, []);

  const activo = brush ? COND_BY_ID[brush] : null;

  return (
    <div className="edu-odo">
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!canEdit && (
        <p className="edu-note">
          Estás viendo el odontograma en solo lectura. Para marcar hallazgos hace falta el permiso{" "}
          <code>odontograma.edit</code>.
        </p>
      )}

      <div className="edu-toolbar">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-odo-denticion">
            Dentición
          </label>
          <select
            id="edu-odo-denticion"
            className="edu-input edu-input--sm"
            value={dentition}
            onChange={(e) => setDentition(e.target.value as Dentition)}
          >
            <option value="permanent">Permanente</option>
            <option value="mixed">Mixta</option>
            <option value="primary">Temporal</option>
          </select>
        </div>
        <div className="edu-field">
          <span className="edu-field__label">Marcado</span>
          <span className="edu-kv__v">
            {resumen.teeth} {resumen.teeth === 1 ? "diente" : "dientes"} · {resumen.findings}{" "}
            {resumen.findings === 1 ? "hallazgo" : "hallazgos"}
            {resumen.notes > 0 ? ` · ${resumen.notes} con nota` : ""}
          </span>
        </div>
      </div>

      <p className="edu-odo__saving">
        {guardando > 0
          ? "Guardando…"
          : activo
            ? `${activo.es} — toca la cara o el diente.`
            : eraser
              ? "Goma — toca lo que quieras quitar."
              : canEdit
                ? "Elige un hallazgo de la paleta, o toca un diente para ver su detalle."
                : "Toca un diente para ver su detalle."}
      </p>

      {/* Los <pattern> del SVG (punteados, tramas) viven UNA sola vez para
          todo el dibujo, y fuera del contenedor que se desplaza: es un svg
          de 0×0 con position:absolute y ahí dentro se posicionaría contra un
          bloque que no es el suyo. */}
      <OdoDefs />

      <div className="edu-odo__lienzo">
        <div className="odo-app">
          <Odontogram
            dentition={dentition}
            lang="es"
            numbering="fdi"
            records={records}
            brush={canEdit ? brush : null}
            eraser={canEdit && eraser}
            selected={selected}
            onApply={apply}
            onSelect={setSelected}
          />
          <Legend lang="es" />
        </div>
      </div>

      {canEdit && (
        <div className="odo-app">
          <Palette
            lang="es"
            brush={brush}
            eraser={eraser}
            onPick={pickBrush}
            onEraser={pickEraser}
          />
        </div>
      )}

      {selected != null && (
        <div className="odo-app">
          <DetailPanel
            fdi={selected}
            lang="es"
            numbering="fdi"
            record={records[selected] || EMPTY_RECORD}
            brush={canEdit ? brush : null}
            eraser={canEdit && eraser}
            onApply={apply}
            onClose={() => setSelected(null)}
            onClearTooth={() => limpiarDiente(selected)}
            onNote={(txt: string) => void anotar(selected, txt)}
            onRemove={quitar}
            onPick={pickBrush}
          />
        </div>
      )}

      <HistorialDeHallazgos entries={entries} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Quién marcó qué, y cuándo. El dibujo enseña el ESTADO; esta lista enseña
// la HISTORIA, que es lo que un expediente tiene que poder contestar.
// ═══════════════════════════════════════════════════════════════════════

function HistorialDeHallazgos({ entries }: { entries: EduOdontogramEntryRow[] }) {
  const router = useRouter();
  const [actualizando, startNav] = useTransition();

  if (entries.length === 0) return null;

  // Los más recientes primero. El servidor los manda ordenados por diente
  // (que es lo que necesita el dibujo), así que aquí se reordena por fecha
  // sobre una COPIA: `sort` muta, y mutar el array del render reordenaría
  // también el que alimenta el dibujo.
  const historial = [...entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  return (
    <section className="edu-section">
      <div className="edu-section__head">
        <h2 className="edu-section__title">Quién marcó qué</h2>
        <span className="edu-count">{historial.length}</span>
      </div>
      {/* Honestidad, no adorno: los hallazgos se guardan de uno en uno y sin
          recargar (marcar y esperar medio segundo por diente es
          insoportable), así que esta lista es la foto de cuando se abrió la
          pantalla. El CONTADOR de arriba sí va en vivo. */}
      <p className="edu-note">
        Así estaba al abrir la pantalla. Lo que marques ahora se guarda al
        instante, pero aparece en esta lista al actualizar.
      </p>
      <p>
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          onClick={() => startNav(() => router.refresh())}
          disabled={actualizando}
        >
          {actualizando ? "Actualizando…" : "Actualizar"}
        </button>
      </p>
      <ul className="edu-chiplist">
        {historial.slice(0, 40).map((e) => (
          <li key={e.id} className="edu-assign">
            <span>
              <strong>Diente {e.tooth}</strong>
              {e.surface !== EDU_TOOTH_WHOLE ? ` · cara ${e.surface}` : ""} ·{" "}
              {e.condition === EDU_ODONTOGRAM_NOTE_KEY
                ? `nota: ${e.notes ?? ""}`
                : eduConditionLabel(e.condition)}{" "}
              · {e.recordedByName} · {e.recordedLabel}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Utilería local
// ═══════════════════════════════════════════════════════════════════════

/** Copia inmutable de records[fdi], aplica el cambio y poda las caras que
 *  quedaron vacías (una cara con [] pintaría un hueco marcado). */
function clonar(prev: Records, fdi: number, fn: (r: { surfaces: Record<string, string[]>; tooth: string[]; note?: string }) => void): Records {
  const rec = prev[fdi]
    ? (JSON.parse(JSON.stringify(prev[fdi])) as { surfaces: Record<string, string[]>; tooth: string[]; note?: string })
    : { surfaces: {}, tooth: [] };
  fn(rec);
  for (const k of Object.keys(rec.surfaces)) {
    if (!rec.surfaces[k] || rec.surfaces[k].length === 0) delete rec.surfaces[k];
  }
  return { ...prev, [fdi]: rec };
}

function alternar(arr: string[], id: string): void {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
}
