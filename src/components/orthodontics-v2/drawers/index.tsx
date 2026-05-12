// 23 drawers/modales del módulo Ortodoncia v2.
//
// Cada drawer es un skeleton funcional que orquesta state local + llama al
// server action correspondiente al submit. Visualmente alineado con
// design/drawers.jsx pero sin todo el detalle visual (los wireframes
// pueden mejorarse en un followup PR de polish).

"use client";

import { useState, type FormEvent } from "react";
import { Check, Send, UploadCloud, Smartphone, FileText } from "lucide-react";
import { DrawerShell } from "./_Shell";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility — small input wrappers
// ─────────────────────────────────────────────────────────────────────────────

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        {...rest}
        className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
      />
    </label>
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <textarea
        {...rest}
        className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
      />
    </label>
  );
}

function Select({
  label,
  options,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: ReadonlyArray<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        {...rest}
        className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Foot({ onClose, onSubmit, label = "Guardar" }: { onClose: () => void; onSubmit?: () => void; label?: string }) {
  return (
    <>
      <span className="font-mono text-[10px] text-muted-foreground">
        Auto-guardado disponible
      </span>
      <div className="flex gap-1.5">
        <button
          onClick={onClose}
          type="button"
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          onClick={onSubmit}
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          <Check className="h-3 w-3" /> {label}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DrawerEditDiagnosis · SPEC §D §31
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerEditDiagnosis({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({ angleClass: "II_DIV1", overjetMm: "", overbiteMm: "" });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Editar diagnóstico"
      subtitle="Captura completa o sección por sección"
      width={720}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} />}
    >
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit?.(form); }} className="flex flex-col gap-3">
        <Select
          label="Clase Angle"
          value={form.angleClass}
          onChange={(e) => setForm({ ...form, angleClass: e.target.value })}
          options={[
            ["I", "Clase I"],
            ["II_DIV1", "Clase II División 1"],
            ["II_DIV2", "Clase II División 2"],
            ["III", "Clase III"],
            ["COMBO", "Combinada"],
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Overjet (mm)"
            type="number"
            step="0.5"
            value={form.overjetMm}
            onChange={(e) => setForm({ ...form, overjetMm: e.target.value })}
          />
          <Input
            label="Overbite (mm)"
            type="number"
            step="0.5"
            value={form.overbiteMm}
            onChange={(e) => setForm({ ...form, overbiteMm: e.target.value })}
          />
        </div>
      </form>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DrawerEditPlan
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerEditPlan({ open, onClose, onSubmit }: DrawerProps) {
  const [notes, setNotes] = useState("");
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Editar plan de tratamiento"
      width={680}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({ notes })} />}
    >
      <Textarea
        label="Notas del plan"
        rows={6}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DrawerNewWireStep
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewWireStep({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({ phase: "LEVELING", material: "NITI", gauge: ".016", durationW: "8" });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Agregar arco"
      width={520}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Agregar" />}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Fase"
          value={form.phase}
          onChange={(e) => setForm({ ...form, phase: e.target.value })}
          options={[
            ["ALIGNMENT", "Alineación"],
            ["LEVELING", "Nivelación"],
            ["SPACE_CLOSE", "Cierre"],
            ["DETAIL", "Detalles"],
            ["FINISHING", "Finalización"],
            ["RETENTION", "Retención"],
          ]}
        />
        <Select
          label="Material"
          value={form.material}
          onChange={(e) => setForm({ ...form, material: e.target.value })}
          options={[
            ["NITI", "NiTi"],
            ["SS", "SS"],
            ["TMA", "TMA"],
            ["BETA_TI", "β-Ti"],
            ["ESTHETIC", "Estético"],
            ["OTHER", "Otro"],
          ]}
        />
        <Input
          label="Calibre"
          value={form.gauge}
          onChange={(e) => setForm({ ...form, gauge: e.target.value })}
        />
        <Input
          label="Duración (semanas)"
          type="number"
          value={form.durationW}
          onChange={(e) => setForm({ ...form, durationW: e.target.value })}
        />
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DrawerNewApplianceType
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewApplianceType({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({ code: "", label: "", category: "Fijos · metálicos" });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Agregar tipo de aparatología"
      subtitle="Queda disponible para futuros pacientes y otros doctores"
      width={500}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Agregar tipo" />}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Nombre"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <Input
          label="Código corto"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <Select
          label="Categoría"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          options={[
            ["Fijos · metálicos", "Fijos · metálicos"],
            ["Fijos · autoligado", "Fijos · autoligado"],
            ["Fijos · estéticos", "Fijos · estéticos"],
            ["Removibles · alineadores", "Removibles · alineadores"],
            ["Linguales", "Linguales"],
            ["Otros", "Otros"],
          ]}
        />
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DrawerNewTAD
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewTAD({ open, onClose, onSubmit }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Agregar TAD"
      width={520}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({})} label="Agregar TAD" />}
    >
      <p className="text-xs text-muted-foreground">
        Selecciona los dientes donde se colocará el microtornillo. Funcionalidad ToothPicker en
        próximo polish PR.
      </p>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DrawerNewStage
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewStage({ open, onClose, onSubmit }: DrawerProps) {
  const [stageCode, setStageCode] = useState("T2");
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Nueva etapa fotográfica"
      width={460}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({ stageCode })} label="Crear etapa" />}
    >
      <Input
        label="Código de etapa"
        value={stageCode}
        onChange={(e) => setStageCode(e.target.value)}
        placeholder="T0, T1, T2, CONTROL"
      />
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. DrawerUploadPhotos
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerUploadPhotos({ open, onClose, onSubmit }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Subir foto-set"
      subtitle="Arrastra archivos o usa el celular con guía"
      width={680}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({})} label="Subir" />}
    >
      <div className="rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/50 p-8 text-center">
        <UploadCloud className="mx-auto h-9 w-9 text-blue-600" />
        <h3 className="mt-3 text-base font-semibold">Arrastra archivos aquí</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          JPG, PNG, DICOM, STL · hasta 50 MB cada uno
        </p>
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. ModalMobileUpload (QR para foto desde celular)
// ─────────────────────────────────────────────────────────────────────────────

export function ModalMobileUpload({ open, onClose }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Foto desde celular"
      subtitle="Escanea con la cámara nativa de tu teléfono"
      side="center"
      width={460}
    >
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="flex h-44 w-44 items-center justify-center rounded-2xl border border-border bg-card">
          <Smartphone className="h-12 w-12 text-muted-foreground" />
        </div>
        <p className="max-w-sm text-center text-xs text-muted-foreground">
          El link abre la cámara con guía de encuadre por tipo de foto y sube directo al expediente.
        </p>
        <code className="rounded-md bg-muted px-3 py-1 font-mono text-[11px]">
          mediflow.mx/m/scan/8XK4-2J9
        </code>
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. LightboxPhoto (mostrar foto en grande + anotaciones)
// ─────────────────────────────────────────────────────────────────────────────

export function LightboxPhoto({ open, onClose }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Foto"
      subtitle="Vista ampliada · anotaciones"
      side="center"
      width={1080}
    >
      <div className="flex aspect-video items-center justify-center rounded-lg bg-black">
        <span className="text-xs text-white/60">Photo viewer · drawer polish PR</span>
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. ModalCompare (comparativa side/slider/timeline)
// ─────────────────────────────────────────────────────────────────────────────

export function ModalCompare({ open, onClose }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Comparación de etapas"
      subtitle="Side-by-side · slider · timeline"
      side="center"
      width={1080}
    >
      <p className="text-xs text-muted-foreground">
        ComparisonSlider del atom system. Vista wireframed en polish PR.
      </p>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. ModalAnnotate
// ─────────────────────────────────────────────────────────────────────────────

export function ModalAnnotate({ open, onClose }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Anotar foto"
      subtitle="Flecha · círculo · texto · regla · ángulo"
      side="center"
      width={900}
    >
      <p className="text-xs text-muted-foreground">
        Annotation/measurement tools en polish PR. addAnnotation/addMeasurement actions ya wired.
      </p>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. DrawerNewTreatmentCard
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewTreatmentCard({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({
    visitType: "CONTROL",
    soapP: "",
    homeInstr: "",
  });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Nueva Treatment Card"
      subtitle="Llena después de la consulta"
      width={760}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Cerrar card" />}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Tipo de cita"
          value={form.visitType}
          onChange={(e) => setForm({ ...form, visitType: e.target.value })}
          options={[
            ["INSTALLATION", "Instalación"],
            ["CONTROL", "Control mensual"],
            ["EMERGENCY", "Urgencia"],
            ["DEBONDING", "Debonding"],
            ["RETAINER_FIT", "Colocar retenedor"],
            ["FOLLOWUP", "Seguimiento"],
          ]}
        />
        <Textarea
          label="SOAP · Plan"
          rows={3}
          value={form.soapP}
          onChange={(e) => setForm({ ...form, soapP: e.target.value })}
        />
        <Textarea
          label="Indicaciones para casa"
          rows={3}
          value={form.homeInstr}
          onChange={(e) => setForm({ ...form, homeInstr: e.target.value })}
        />
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. DrawerEditFinancialPlan
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerEditFinancialPlan({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({ total: "50000", downPayment: "8000", months: "18" });
  const monthly = ((Number(form.total) - Number(form.downPayment)) / Number(form.months)).toFixed(0);
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Editar plan financiero"
      subtitle="Reactivo · cambios recalculan al instante"
      width={680}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({ ...form, monthly })} label="Guardar plan" />}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Total tratamiento (MXN)"
          type="number"
          value={form.total}
          onChange={(e) => setForm({ ...form, total: e.target.value })}
        />
        <Input
          label="Enganche (MXN)"
          type="number"
          value={form.downPayment}
          onChange={(e) => setForm({ ...form, downPayment: e.target.value })}
        />
        <Input
          label="Plazo (meses)"
          type="number"
          value={form.months}
          onChange={(e) => setForm({ ...form, months: e.target.value })}
        />
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs">
          Mensualidad calculada: <span className="font-mono font-semibold">${monthly}</span>
        </div>
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. DrawerCollectInstallment
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerCollectInstallment({ open, onClose, onSubmit }: DrawerProps) {
  const [method, setMethod] = useState("CARD");
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Cobrar mensualidad"
      subtitle="CFDI 4.0 con Facturapi · stub Fase 2"
      width={520}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({ method })} label="Cobrar" />}
    >
      <Select
        label="Método de pago"
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        options={[
          ["CARD", "Tarjeta"],
          ["CASH", "Efectivo"],
          ["TRANSFER", "Transferencia"],
          ["WA_LINK", "Link WhatsApp"],
        ]}
      />
      <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-[11px] text-violet-700">
        <strong>CFDI con Facturapi</strong> · timbrado automático tras cobro · stub Fase 2
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. ModalQuoteScenarios
// ─────────────────────────────────────────────────────────────────────────────

export function ModalQuoteScenarios({ open, onClose }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Cotización · 3 escenarios"
      subtitle="G5 Open Choice"
      side="center"
      width={780}
    >
      <p className="text-xs text-muted-foreground">
        Vista de los 3 escenarios A/B/C con totales. Edita desde drawer-edit-financial.
      </p>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. ModalSignAtHome
// ─────────────────────────────────────────────────────────────────────────────

export function ModalSignAtHome({ open, onClose }: DrawerProps) {
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Enviar Sign@Home"
      subtitle="Twilio WhatsApp · stub Fase 2"
      side="center"
      width={560}
    >
      <p className="text-xs text-muted-foreground">
        El paciente firma desde su WhatsApp · stub envío Twilio.
      </p>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 17. DrawerConfigRetention
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerConfigRetention({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({
    retUpper: "ESSIX",
    retLower: "FIXED_3_3",
    regimen: "Año 1: 24/7. Año 2: nocturno.",
  });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Configurar retención"
      width={680}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Guardar régimen" />}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Retenedor superior"
          value={form.retUpper}
          onChange={(e) => setForm({ ...form, retUpper: e.target.value })}
          options={[
            ["NONE", "Ninguno"],
            ["HAWLEY", "Hawley"],
            ["ESSIX", "Essix"],
            ["FIXED_3_3", "Fijo 3-3"],
            ["FIXED_EXTENDED", "Fijo extendido"],
            ["CLEAR_NIGHT", "Nocturno transparente"],
          ]}
        />
        <Select
          label="Retenedor inferior"
          value={form.retLower}
          onChange={(e) => setForm({ ...form, retLower: e.target.value })}
          options={[
            ["NONE", "Ninguno"],
            ["HAWLEY", "Hawley"],
            ["ESSIX", "Essix"],
            ["FIXED_3_3", "Fijo 3-3"],
            ["FIXED_EXTENDED", "Fijo extendido"],
            ["CLEAR_NIGHT", "Nocturno transparente"],
          ]}
        />
        <Textarea
          label="Régimen de uso"
          rows={4}
          value={form.regimen}
          onChange={(e) => setForm({ ...form, regimen: e.target.value })}
        />
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 18. DrawerNewReferralLetter
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewReferralLetter({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({ to: "", reason: "" });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Nueva carta de referencia"
      width={580}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Enviar" />}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Destinatario (Dr/a · especialidad)"
          value={form.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
        />
        <Textarea
          label="Motivo"
          rows={4}
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 19. DrawerNewLabOrder
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerNewLabOrder({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({
    itemCode: "RETAINER",
    itemLabel: "Retenedor Essix superior",
    labPartner: "OrthoLab MX",
    status: "DRAFT",
  });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Nueva lab order"
      width={580}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Crear orden" />}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Código"
          value={form.itemCode}
          onChange={(e) => setForm({ ...form, itemCode: e.target.value })}
        />
        <Input
          label="Producto"
          value={form.itemLabel}
          onChange={(e) => setForm({ ...form, itemLabel: e.target.value })}
        />
        <Input
          label="Laboratorio"
          value={form.labPartner}
          onChange={(e) => setForm({ ...form, labPartner: e.target.value })}
        />
        <Select
          label="Estado"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          options={[
            ["DRAFT", "Borrador"],
            ["SENT", "Enviada"],
            ["RECEIVED", "Recibida"],
            ["CANCELLED", "Cancelada"],
          ]}
        />
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 20. DrawerGenerateConsent
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerGenerateConsent({ open, onClose, onSubmit }: DrawerProps) {
  const [templateId, setTemplateId] = useState("std-v3.2");
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Generar consentimiento"
      subtitle="Tras aceptar el plan"
      width={500}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({ templateId })} label="Generar" />}
    >
      <Select
        label="Plantilla"
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        options={[
          ["std-v3.2", "Consentimiento ortodoncia · estándar v3.2"],
          ["photo-use", "Autorización fotografías clínicas"],
          ["extractions", "Consentimiento extracciones"],
          ["minor-assent", "Asentimiento de menor"],
        ]}
      />
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 21. DrawerWhatsAppChat
// ─────────────────────────────────────────────────────────────────────────────

export function DrawerWhatsAppChat({ open, onClose, onSubmit }: DrawerProps) {
  const [body, setBody] = useState("");
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="WhatsApp · responder"
      subtitle="Twilio canal · stub Fase 2"
      width={620}
      footer={
        <>
          <span className="font-mono text-[10px] text-muted-foreground">
            Mensaje persistido en CommunicationLog
          </span>
          <button
            type="button"
            onClick={() => onSubmit?.({ body })}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
          >
            <Send className="h-3 w-3" /> Enviar
          </button>
        </>
      }
    >
      <Textarea
        label="Mensaje"
        rows={6}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 22. ModalLoadTemplate
// ─────────────────────────────────────────────────────────────────────────────

export function ModalLoadTemplate({ open, onClose, onSubmit }: DrawerProps) {
  const [search, setSearch] = useState("");
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Cargar plantilla"
      subtitle="Pre-llena diagnóstico, aparatología y wire sequencing"
      side="center"
      width={680}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.({})} label="Cargar plantilla" />}
    >
      <Input
        label="Buscar"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Clase II div 1 sin extracciones..."
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Lista de plantillas desde listOrthoTemplates() · polish UI pendiente.
      </p>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 23. ModalSaveTemplate
// ─────────────────────────────────────────────────────────────────────────────

export function ModalSaveTemplate({ open, onClose, onSubmit }: DrawerProps) {
  const [form, setForm] = useState({ name: "", description: "" });
  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Guardar como plantilla"
      side="center"
      width={500}
      footer={<Foot onClose={onClose} onSubmit={() => onSubmit?.(form)} label="Guardar plantilla" />}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Nombre"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Mi plantilla Clase II..."
        />
        <Textarea
          label="Descripción (opcional)"
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
    </DrawerShell>
  );
}
