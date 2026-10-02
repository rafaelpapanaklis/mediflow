"use client";

// «Crear plan» desde un presupuesto cuando ni quien lo hizo ni el doctor de
// cabecera atienden en la Agenda (revisión final de ws1-t2, fallo 4): el
// servidor contesta 409 `{ elegirDoctor, doctores }` y aquí se elige. Lo usan
// las dos tarjetas (la de siempre y la rediseñada), cada una con sus clases.

import { useState } from "react";

export interface DoctorParaElegir {
  id: string;
  nombre: string;
}

export interface PedidoDeDoctor {
  general: boolean;
  aviso: string;
  doctores: DoctorParaElegir[];
}

/** La respuesta de «Crear plan» que pide elegir doctor, o null. */
export function pedidoDeDoctor(salida: any, general: boolean): PedidoDeDoctor | null {
  if (!salida?.elegirDoctor) return null;
  return {
    general,
    aviso: String(salida.error ?? ""),
    doctores: Array.isArray(salida.doctores) ? salida.doctores : [],
  };
}

export function ElegirDoctorDelPlan({
  pedido,
  ocupado,
  onCrear,
  onCancelar,
  clases,
}: {
  pedido: PedidoDeDoctor;
  ocupado: boolean;
  onCrear: (doctorId: string) => void;
  onCancelar: () => void;
  clases: { caja: string; texto: string; select: string; boton: string; botonPrincipal: string };
}) {
  const [doctorId, setDoctorId] = useState(pedido.doctores[0]?.id ?? "");
  const sinNadie = pedido.doctores.length === 0;
  return (
    <div className={clases.caja}>
      <p className={clases.texto}>
        {sinNadie
          ? "Nadie de la clínica atiende en la Agenda. Enciende «Aparece en la agenda» de quien atiende (Equipo → Editar) para crear el plan."
          : pedido.aviso}
      </p>
      {!sinNadie && (
        <select
          className={clases.select}
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          aria-label="Doctor del plan"
        >
          {pedido.doctores.map((d) => (
            <option key={d.id} value={d.id}>{d.nombre || d.id}</option>
          ))}
        </select>
      )}
      {!sinNadie && (
        <button
          type="button"
          className={clases.botonPrincipal}
          disabled={ocupado || !doctorId}
          onClick={() => onCrear(doctorId)}
        >
          Crear plan
        </button>
      )}
      <button type="button" className={clases.boton} disabled={ocupado} onClick={onCancelar}>
        Cancelar
      </button>
    </div>
  );
}
