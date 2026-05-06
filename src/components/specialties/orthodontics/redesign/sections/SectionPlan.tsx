"use client";
// Sección C — Plan de tratamiento (G3 wire seq + G4 prescription + G10 TADs).
//
// Sub-cards:
//   1. Aparatología (chips MBT 0.022 / Roth / Damon / Spark / Invisalign +
//      bonding directo/indirecto + duración estimada).
//   2. Wire sequencing (tabla compacta NiTi 0.014 → 0.018 → 16x22 SS → ...).
//   3. IPR map mini-odontograma con dots interproximales.
//   4. Mecánicas auxiliares (TADs Dentos/Spider/IMTEC + expander + distalizer).
//
// El botón "Avanzar de fase" abre ModalAdvancePhase (hermano).

import { Pencil, Plus } from "lucide-react";
import { Btn, Card } from "../atoms";
import { Pill } from "../atoms/Pill";
import { fmtDateShort, fmtMm } from "../atoms/format";
import {
  APPLIANCE_SLOT_LABELS,
  BONDING_LABELS,
  DISTALIZER_LABELS,
  ELASTIC_CLASS_LABELS,
  EXPANDER_LABELS,
  PHASE_LABELS,
  TAD_BRAND_LABELS,
  WIRE_MATERIAL_LABELS,
  WIRE_STATUS_LABELS,
  type AuxMechanicsDTO,
  type IPRPointDTO,
  type OrthoTreatmentDTO,
  type TADDTO,
  type WireStepDTO,
} from "../types";

export interface SectionPlanProps {
  treatment: OrthoTreatmentDTO;
  wireSequence: WireStepDTO[];
  iprPlan: IPRPointDTO[];
  tads: TADDTO[];
  auxMechanics: AuxMechanicsDTO | null;
  onEditPrescription?: () => void;
  onAddWireStep?: () => void;
  onAddTad?: () => void;
  onAddAuxMechanics?: () => void;
  onAdvancePhase?: () => void;
}

export function SectionPlan(props: SectionPlanProps) {
  const t = props.treatment;
  return (
    <Card
      id="plan"
      eyebrow="Sección C"
      title="Plan de tratamiento & setup digital"
      accent="violet"
      action={
        props.onAdvancePhase ? (
          <Btn variant="primary" size="sm" onClick={props.onAdvancePhase}>
            Avanzar de fase
          </Btn>
        ) : null
      }
    >
      <PrescriptionBlock treatment={t} onEdit={props.onEditPrescription} />
      <WireSequenceBlock
        sequence={props.wireSequence}
        onAdd={props.onAddWireStep}
      />
      <IPRMapBlock points={props.iprPlan} />
      <AuxMechanicsBlock
        tads={props.tads}
        aux={props.auxMechanics}
        onAddTad={props.onAddTad}
        onAddAux={props.onAddAuxMechanics}
      />
    </Card>
  );
}

function PrescriptionBlock({
  treatment,
  onEdit,
}: {
  treatment: OrthoTreatmentDTO;
  onEdit?: () => void;
}) {
  const slot = treatment.appliance.prescriptionSlot
    ? APPLIANCE_SLOT_LABELS[treatment.appliance.prescriptionSlot]
    : "Sin definir";
  const bonding = treatment.appliance.bonding
    ? BONDING_LABELS[treatment.appliance.bonding]
    : "—";

  return (
    <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Aparatología
          <span className="text-violet-600 normal-case font-medium ml-1 dark:text-violet-300">
            · G4 prescription/slot
          </span>
        </h4>
        {onEdit ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<Pencil className="w-3.5 h-3.5" aria-hidden />}
            onClick={onEdit}
          >
            Cambiar
          </Btn>
        ) : null}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PrescriptionTile
          label="Tipo"
          value={treatment.appliance.type ?? "—"}
          accent
        />
        <PrescriptionTile label="Prescripción / slot" value={slot} mono />
        <PrescriptionTile label="Bonding" value={bonding} />
        <PrescriptionTile
          label="Notas"
          value={treatment.appliance.notes ?? "—"}
          subtle
        />
      </div>
    </div>
  );
}

function PrescriptionTile({
  label,
  value,
  mono,
  accent,
  subtle,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  subtle?: boolean;
}) {
  const bgCls = accent
    ? "bg-violet-50 border-violet-200 dark:bg-violet-900/20 dark:border-violet-800"
    : "bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700";
  const labelCls = accent
    ? "text-violet-700 dark:text-violet-300"
    : "text-slate-500 dark:text-slate-400";
  return (
    <div className={`border rounded-lg p-3 ${bgCls}`}>
      <div className={`text-[10px] uppercase tracking-wider font-medium ${labelCls}`}>
        {label}
      </div>
      <div
        className={`mt-1 ${subtle ? "text-xs text-slate-700 dark:text-slate-300 leading-snug" : "text-sm font-semibold text-slate-900 dark:text-slate-100"} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function WireSequenceBlock({
  sequence,
  onAdd,
}: {
  sequence: WireStepDTO[];
  onAdd?: () => void;
}) {
  return (
    <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Wire sequencing
          <span className="text-violet-600 normal-case font-medium ml-1 dark:text-violet-300">
            · G3
          </span>
        </h4>
        {onAdd ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
            onClick={onAdd}
          >
            Agregar paso
          </Btn>
        ) : null}
      </div>
      {sequence.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Sin wires planificados todavía.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Fase</th>
                <th className="text-left px-3 py-2 font-medium">Wire</th>
                <th className="text-left px-3 py-2 font-medium">Duración</th>
                <th className="text-left px-3 py-2 font-medium">Inicio</th>
                <th className="text-left px-3 py-2 font-medium">Fin</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {sequence.map((w) => (
                <tr
                  key={w.id}
                  className={`border-t border-slate-100 dark:border-slate-800 ${
                    w.status === "ACTIVE"
                      ? "bg-violet-50/40 dark:bg-violet-900/10"
                      : ""
                  }`}
                >
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono dark:text-slate-500">
                    {w.orderIndex}
                  </td>
                  <td className="px-3 py-2">
                    <Pill color={w.status === "ACTIVE" ? "violet" : "slate"} size="xs">
                      {PHASE_LABELS[w.phaseKey]}
                    </Pill>
                  </td>
                  <td className="px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100">
                    {WIRE_MATERIAL_LABELS[w.material]} {w.gauge}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {w.durationWeeks} sem
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {fmtDateShort(w.appliedDate ?? w.plannedDate)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {fmtDateShort(w.completedDate)}
                  </td>
                  <td className="px-3 py-2">
                    <Pill
                      color={
                        w.status === "ACTIVE"
                          ? "violet"
                          : w.status === "COMPLETED"
                            ? "emerald"
                            : w.status === "SKIPPED"
                              ? "rose"
                              : "white"
                      }
                      size="xs"
                    >
                      {WIRE_STATUS_LABELS[w.status]}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IPRMapBlock({ points }: { points: IPRPointDTO[] }) {
  const upper = [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26];
  const lower = [46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36];
  const total = points.reduce((acc, p) => acc + p.amountMm, 0);
  const done = points.filter((p) => p.done).reduce((acc, p) => acc + p.amountMm, 0);

  return (
    <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          IPR map por interproximal
        </h4>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
            Realizado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden />
            Pendiente
          </span>
        </div>
      </div>

      {[
        { label: "Maxilar superior", arr: upper },
        { label: "Mandibular inferior", arr: lower },
      ].map(({ label, arr }) => (
        <div key={label} className="mb-3 last:mb-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 dark:text-slate-500">
            {label}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {arr.map((tooth, i) => {
              const next = arr[i + 1];
              const ip = next
                ? points.find(
                    (p) =>
                      (p.toothA === tooth && p.toothB === next) ||
                      (p.toothA === next && p.toothB === tooth),
                  )
                : null;
              return (
                <span key={`${tooth}-${i}`} className="contents">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded text-[11px] font-mono font-semibold bg-slate-50 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                    {tooth}
                  </span>
                  {next ? (
                    ip ? (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          ip.done
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {ip.amountMm}
                      </span>
                    ) : (
                      <span className="w-4 text-center text-slate-300 text-xs dark:text-slate-600">
                        ·
                      </span>
                    )
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        Total stripping:{" "}
        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
          {fmtMm(total)}
        </span>{" "}
        · realizado:{" "}
        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
          {fmtMm(done)}
        </span>
      </div>
    </div>
  );
}

function AuxMechanicsBlock({
  tads,
  aux,
  onAddTad,
  onAddAux,
}: {
  tads: TADDTO[];
  aux: AuxMechanicsDTO | null;
  onAddTad?: () => void;
  onAddAux?: () => void;
}) {
  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Mecánicas auxiliares
          <span className="text-violet-600 normal-case font-medium ml-1 dark:text-violet-300">
            · G10 TADs catalog
          </span>
        </h4>
        {onAddTad ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
            onClick={onAddTad}
          >
            Agregar TAD
          </Btn>
        ) : null}
      </div>

      {tads.length === 0 && !aux?.expanderType && !aux?.distalizerType ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Sin TADs ni mecánicas auxiliares activas.
        </div>
      ) : (
        <div className="space-y-3">
          {tads.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tads.map((t) => (
                <div
                  key={t.id}
                  className="border border-slate-200 rounded-lg p-3 dark:border-slate-700"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        TAD · {TAD_BRAND_LABELS[t.brand]}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                        {t.size}
                      </div>
                    </div>
                    <Pill color={t.failed ? "rose" : "emerald"} size="xs">
                      {t.failed ? "Falla" : "Activo"}
                    </Pill>
                  </div>
                  <div className="mt-2 text-xs text-slate-700 leading-snug dark:text-slate-300">
                    {t.location}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      Torque {t.torqueNcm != null ? `${t.torqueNcm} Ncm` : "—"}
                    </span>
                    <span>{fmtDateShort(t.placedDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {aux?.expanderType || aux?.distalizerType ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {aux.expanderType ? (
                <AuxTile
                  label="Expansor"
                  value={EXPANDER_LABELS[aux.expanderType]}
                  sub={
                    aux.expanderActivations != null
                      ? `${aux.expanderActivations} activaciones`
                      : null
                  }
                />
              ) : null}
              {aux.distalizerType ? (
                <AuxTile
                  label="Distalizador"
                  value={DISTALIZER_LABELS[aux.distalizerType]}
                  sub={fmtDateShort(aux.distalizerInstalledAt) ?? null}
                />
              ) : null}
            </div>
          ) : onAddAux ? (
            <Btn
              variant="violet-soft"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
              onClick={onAddAux}
            >
              Agregar expansor / distalizador
            </Btn>
          ) : null}

          {/* Reminder a elásticos clase II/III/box (solo nota visual). */}
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            Elásticos {ELASTIC_CLASS_LABELS.CLASE_II} / {ELASTIC_CLASS_LABELS.CLASE_III} /{" "}
            {ELASTIC_CLASS_LABELS.BOX} se registran en cada Treatment Card de la sección D.
          </div>
        </div>
      )}
    </div>
  );
}

function AuxTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string | null;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 dark:border-slate-700">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>
      ) : null}
    </div>
  );
}
