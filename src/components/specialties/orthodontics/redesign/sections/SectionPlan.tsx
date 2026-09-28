"use client";
// Sección C — Plan de tratamiento (aparatología, secuencia de arcos, IPR y
// mecánicas auxiliares).
//
// Sub-cards:
//   1. Aparatología (chips MBT 0.022 / Roth / Damon / Spark / Invisalign +
//      bonding directo/indirecto + duración estimada).
//   2. Wire sequencing (tabla compacta NiTi 0.014 → 0.018 → 16x22 SS → ...).
//   3. IPR map mini-odontograma con dots interproximales.
//   4. Mecánicas auxiliares (TADs Dentos/Spider/IMTEC + expander + distalizer).
//
// El botón "Avanzar de fase" abre ModalAdvancePhase (hermano).

import { Layers, Pencil, Plus } from "lucide-react";
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
import orto from "../orto.module.css";

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
}

export function SectionPlan(props: SectionPlanProps) {
  const t = props.treatment;
  return (
    <Card
      id="plan"
      icon={<Layers size={15} strokeWidth={1.75} />}
      title="Plan de tratamiento"
      eyebrow="Aparatología, secuencia de arcos, IPR y mecánicas auxiliares"
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
    <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className={orto.bloqueTitulo}>Aparatología</h4>
        {onEdit ? (
          <Btn
            variant="secondary"
            size="sm"
            icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />}
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
        <PrescriptionTile label="Cementado" value={bonding} />
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
  return (
    <div className={`${orto.caja} ${accent ? orto.cajaVioleta : ""}`}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div
        className={`mt-[2px] [overflow-wrap:anywhere] ${subtle ? `${orto.tonoTexto2} text-xs leading-snug` : "text-[13.5px] font-semibold"} ${mono ? "tabular-nums" : ""}`}
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
    <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className={orto.bloqueTitulo}>Secuencia de arcos</h4>
        {onAdd ? (
          <Btn
            variant="secondary"
            size="sm"
            icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
            onClick={onAdd}
          >
            Agregar arco
          </Btn>
        ) : null}
      </div>
      {sequence.length === 0 ? (
        <div className={orto.vacioLinea}>
          Aún no hay arcos planificados. Agrega el primero para llevar la secuencia del caso.
        </div>
      ) : (
        <div className={`${orto.tablaCaja} border border-[color:var(--pr-borde-suave)] rounded-[10px]`}>
          <table className={`${orto.tabla} ${orto.tablaDensa}`} style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Fase</th>
                <th>Arco</th>
                <th>Duración</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {sequence.map((w, i) => (
                <tr
                  key={w.id}
                  className={w.status === "ACTIVE" ? orto.tablaFilaActiva : undefined}
                >
                  <td className={orto.tonoApagado}>{i + 1}</td>
                  <td>
                    <Pill color={w.status === "ACTIVE" ? "violet" : "slate"} size="xs">
                      {PHASE_LABELS[w.phaseKey]}
                    </Pill>
                  </td>
                  <td className="font-semibold whitespace-nowrap">
                    {WIRE_MATERIAL_LABELS[w.material]} {w.gauge}
                  </td>
                  <td className="whitespace-nowrap">{w.durationWeeks} sem</td>
                  <td className="whitespace-nowrap">
                    {fmtDateShort(w.appliedDate ?? w.plannedDate)}
                  </td>
                  <td className="whitespace-nowrap">{fmtDateShort(w.completedDate)}</td>
                  <td>
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
    <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className={orto.bloqueTitulo}>Mapa de IPR</h4>
        <div className="flex items-center gap-3 text-[11.5px] text-[color:var(--pr-texto-3)]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[color:var(--pr-exito)]" aria-hidden />
            Realizado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[color:var(--pr-borde)]" aria-hidden />
            Pendiente
          </span>
        </div>
      </div>

      {[
        { label: "Arcada superior", arr: upper },
        { label: "Arcada inferior", arr: lower },
      ].map(({ label, arr }) => (
        <div key={label} className="mb-3 last:mb-0">
          <div className={`${orto.campoEtiqueta} mb-[5px]`}>{label}</div>
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
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] text-[11px] tabular-nums font-semibold bg-[color:var(--pr-tarjeta-2)] border border-[color:var(--pr-borde)] text-[color:var(--pr-texto-2)]">
                    {tooth}
                  </span>
                  {next ? (
                    ip ? (
                      <span
                        className={`px-1.5 py-0.5 rounded-[8px] text-[11px] tabular-nums font-semibold ${
                          ip.done
                            ? "bg-[color:var(--pr-exito-suave)] text-[color:var(--pr-exito)]"
                            : "bg-[color:var(--pr-hover)] text-[color:var(--pr-texto-3)]"
                        }`}
                      >
                        {ip.amountMm}
                      </span>
                    ) : (
                      <span className="w-4 text-center text-[color:var(--pr-texto-3)] text-xs">
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

      <div className="mt-3 text-xs text-[color:var(--pr-texto-3)]">
        IPR planeado:{" "}
        <span className="tabular-nums font-semibold text-[color:var(--pr-texto-2)]">
          {fmtMm(total)}
        </span>{" "}
        · realizado:{" "}
        <span className="tabular-nums font-semibold text-[color:var(--pr-exito)]">
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
    <div className="px-[18px] py-[16px]">
      <div className="flex items-center justify-between mb-3">
        <h4 className={orto.bloqueTitulo}>Mecánicas auxiliares</h4>
        {onAddTad ? (
          <Btn
            variant="secondary"
            size="sm"
            icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
            onClick={onAddTad}
          >
            Agregar TAD
          </Btn>
        ) : null}
      </div>

      {tads.length === 0 && !aux?.expanderType && !aux?.distalizerType ? (
        <div className={orto.vacioLinea}>Sin TADs ni mecánicas auxiliares activas.</div>
      ) : (
        <div className="space-y-3">
          {tads.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tads.map((t) => (
                <div
                  key={t.id}
                  className={orto.caja}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
                        TAD · {TAD_BRAND_LABELS[t.brand]}
                      </div>
                      <div className="text-[11px] text-[color:var(--pr-texto-3)] tabular-nums">
                        {t.size}
                      </div>
                    </div>
                    <Pill color={t.failed ? "rose" : "emerald"} size="xs">
                      {t.failed ? "Falla" : "Activo"}
                    </Pill>
                  </div>
                  <div className="mt-2 text-xs text-[color:var(--pr-texto-2)] leading-snug">
                    {t.location}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[color:var(--pr-texto-3)]">
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
          <div className="text-xs text-[color:var(--pr-texto-3)]">
            Los elásticos ({ELASTIC_CLASS_LABELS.CLASE_II}, {ELASTIC_CLASS_LABELS.CLASE_III},{" "}
            {ELASTIC_CLASS_LABELS.BOX}) se registran en cada control.
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
    <div className={orto.caja}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className="mt-1 text-[13px] font-semibold text-[color:var(--pr-texto)]">
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] text-[color:var(--pr-texto-3)]">{sub}</div>
      ) : null}
    </div>
  );
}
