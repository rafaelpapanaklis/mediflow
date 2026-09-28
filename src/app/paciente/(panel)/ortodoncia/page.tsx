"use client";

// Portal del paciente — Ortodoncia (/paciente/ortodoncia). Parte 8
// «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H14: marca si
// usaste tus elásticos/alineador hoy. H15: sube una foto de monitoreo con
// guía de encuadre (H7, mismo componente que la clínica).
//
// PATRÓN A SEGUIR: src/app/paciente/(panel)/documentos/page.tsx (self-fetch
// con usePacienteData, PageShell propio, estilos inline dark, sin
// useSearchParams).
//
// ws1-t2 (Paciente y WhatsApp, W4) agregó el bloque «Tu mensualidad» de
// forma aditiva (función MensualidadYControl) — no toca el resto de esta
// página. El botón de pago reutiliza el link de factura de Mercado Pago que
// ya existe en /paciente/pagos (mismo saldo, mismo botón) en vez de
// construir un cobro nuevo: se enlaza ahí en vez de duplicar el flujo.
//
// ws1-t5 (ronda 6, revisión de lógica de uso): cada tarjeta dice DE QUIÉN es
// el caso (93); enseña el avance, las indicaciones del último control y el
// calendario de mensualidades (94); la pregunta diaria solo le sale a quien
// lleva elásticos o alineadores, y el día lo decide el servidor con la hora
// de la clínica (95); un caso terminado se puede leer, sin registro ni fotos
// (fila 16 del mapa). Qué se enseña lo decide el servidor
// (`/api/paciente/ortodoncia` + `lib/patient-portal/ortodoncia-portal.ts`).
// Esta página CARGA los datos y conecta lo que escribe; cómo se pinta vive en
// `components/paciente/ortodoncia/vista-ortodoncia.tsx`.

import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import { logElasticsComplianceFromPortal } from "@/app/actions/orthodontics/alineadores/logElasticsComplianceFromPortal";
import { submitMonitoringPhoto } from "@/app/actions/orthodontics/alineadores/submitMonitoringPhoto";
import type { PacienteOrtodonciaCase } from "@/app/api/paciente/ortodoncia/route";
import { isFailure } from "@/app/actions/orthodontics/result";
import {
  CargandoOrtodoncia,
  ErrorOrtodoncia,
  VistaOrtodoncia,
  type AccionesOrtodonciaPortal,
} from "@/components/paciente/ortodoncia/vista-ortodoncia";

/** Lo que ESCRIBE el portal. La vista no sabe de rutas ni de acciones de servidor. */
const ACCIONES: AccionesOrtodonciaPortal = {
  async registrarUso({ treatmentPlanId, usedElastics, wornHours }) {
    const res = await logElasticsComplianceFromPortal({ treatmentPlanId, usedElastics, wornHours });
    return isFailure(res) ? { ok: false, error: res.error } : { ok: true };
  },

  async enviarFoto({ treatmentPlanId, file, angle, note }) {
    const form = new FormData();
    form.append("file", file);
    form.append("treatmentPlanId", treatmentPlanId);
    form.append("angle", angle);
    if (note) form.append("patientNote", note);
    const res = await fetch("/api/paciente/ortodoncia/monitoreo", { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return { ok: false, error: json?.error ?? "No se pudo subir la foto" };
    }
    const created = await submitMonitoringPhoto({
      treatmentPlanId,
      storageKey: json.storageKey,
      fileName: json.fileName,
      mimeType: json.mimeType,
      sizeBytes: json.sizeBytes,
      angle: json.angle,
      patientNote: json.patientNote,
    });
    return isFailure(created) ? { ok: false, error: created.error } : { ok: true };
  },
};

export default function PacienteOrtodonciaPage() {
  const { data, error, isLoading, mutate } = usePacienteData<{ cases: PacienteOrtodonciaCase[] }>(
    "/api/paciente/ortodoncia",
  );

  if (error && !data) return <ErrorOrtodoncia onReintentar={() => mutate()} />;
  if (isLoading || !data) return <CargandoOrtodoncia />;
  return <VistaOrtodoncia cases={data.cases} onSaved={() => mutate()} acciones={ACCIONES} />;
}
