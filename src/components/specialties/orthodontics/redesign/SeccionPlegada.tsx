"use client";
// Una sección del caso que todavía no toca por fase (fila 26 de la revisión
// de uso, ws1-t4 ronda 6): en vez de la tarjeta entera, un renglón con su
// nombre, cuándo empieza y «Ver». Al abrirla se pinta la sección de verdad,
// que trae su propio `id`; mientras está plegada el renglón lleva ese mismo
// `id`, así el índice del módulo sigue llevando ahí. Nunca hay dos a la vez.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Btn } from "./atoms/Btn";
import { Card } from "./atoms/Card";

export function SeccionPlegada(props: {
  plegada: boolean;
  id: string;
  icon: ReactNode;
  title: string;
  /** Cuándo empieza a tocar, en palabras de la clínica. */
  cuando: string;
  children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);
  if (!props.plegada || abierta) return <>{props.children}</>;
  return (
    <Card
      id={props.id}
      icon={props.icon}
      title={props.title}
      eyebrow={props.cuando}
      accent="slate"
      action={
        <Btn
          variant="secondary"
          size="sm"
          icon={<ChevronDown size={14} strokeWidth={1.75} aria-hidden />}
          aria-expanded={false}
          onClick={() => setAbierta(true)}
        >
          Ver
        </Btn>
      }
    >
      {null}
    </Card>
  );
}
