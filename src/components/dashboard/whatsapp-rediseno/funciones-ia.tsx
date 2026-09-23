"use client";

import {
  FUNCIONES_IA_SOLO_ADMIN,
  FUNCIONES_IA_SUB,
  FUNCIONES_IA_TITULO,
  GRUPOS_GASTO,
  type FuncionesIaVM,
} from "@/app/dashboard/whatsapp/bot/saldo/funciones-ia";
import { FUNCIONES_IA, GASTO_IA_GRUPO, GASTO_IA_TEXTO } from "@/lib/ai-billing/interruptores";
import { Cargando, FilaInterruptor, Tarjeta } from "./piezas";
import s from "./whatsapp-rediseno.module.css";

/**
 * Funciones de IA en el rediseño de Saldo de IA (ws1-t1): el MISMO estado y
 * los MISMOS textos que la vista de siempre —los pone SaldoClient con
 * `useFuncionesIa`—, pintados con las piezas del rediseño. Una fila por
 * función con lo que gasta y lo que se pierde al apagarla.
 */
export function FuncionesIaRediseno({ vm }: { vm: FuncionesIaVM }) {
  const { apagadas, isAdmin, cargando, error, guardando, alternar } = vm;

  return (
    <Tarjeta titulo={FUNCIONES_IA_TITULO} sub={FUNCIONES_IA_SUB}>
      {cargando ? (
        <Cargando>Cargando…</Cargando>
      ) : error ? (
        <p className={s.vacio}>No se pudieron cargar las funciones de IA. Vuelve a intentarlo en unos momentos.</p>
      ) : (
        <div className={s.apilado} style={{ gap: 18 }}>
          {!isAdmin && <p className={s.textoSuaveMedio}>{FUNCIONES_IA_SOLO_ADMIN}</p>}
          {GRUPOS_GASTO.map((gasto) => (
            <div key={gasto} className={s.apilado} style={{ gap: 8 }}>
              <div className={s.filaTitulo}>{GASTO_IA_GRUPO[gasto]}</div>
              {FUNCIONES_IA.filter((f) => f.gasta === gasto).map((f) => {
                const on = !apagadas.includes(f.id);
                // El título es solo el nombre: es también el nombre accesible del
                // interruptor, y no debe cambiar al apagarlo.
                return (
                  <FilaInterruptor
                    key={f.id}
                    on={on}
                    onToggle={() => alternar(f.id)}
                    disabled={!isAdmin || guardando !== null}
                    titulo={f.nombre}
                    desc={`${on ? "" : "Apagada. "}${GASTO_IA_TEXTO[f.gasta]} ${f.queHace} Si la apagas: ${f.siLaApagas}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Tarjeta>
  );
}
