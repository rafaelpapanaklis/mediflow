/**
 * Mercado Pago sembrado en las DOS clínicas del doble (ws1-t4, «Sabina sabe del
 * panel»). Cada clínica con una configuración distinta a propósito: si
 * `estado_mercado_pago` leyera la fila de la otra, la cifra lo delata.
 *
 *  · Norte: cuenta conectada «NORTE_MP», anticipo ENCENDIDO de $200 fijos y 45
 *    minutos para pagar; tres anticipos recientes (2 pagados, 1 esperando), uno
 *    con un pago raro.
 *  · Sur: cuenta de PRUEBAS «SUR_MP», anticipo del 30 % con 120 minutos, y un
 *    anticipo vencido.
 *
 * El token se siembra (cifrado de mentira) para poder demostrar que no sale.
 */

import { CL_NORTE, CL_SUR, datosDePrueba } from "./siembra";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";

export const TOKEN_FALSO = "tok-cifrado-no-debe-salir";

const HACE_UN_MES = new Date("2026-08-20T15:00:00.000Z");

export function filasMercadoPago(): Pick<Datos, "clinicMercadoPagos" | "appointmentDeposits" | "appointmentDepositPayments"> {
  const clinicMercadoPagos: Fila[] = [
    {
      clinicId: CL_NORTE,
      mpUserId: "123456789",
      mpNickname: "NORTE_MP",
      mpEmail: "cobros@norte.mx",
      accessToken: TOKEN_FALSO,
      refreshToken: TOKEN_FALSO,
      liveMode: true,
      connectedAt: HACE_UN_MES,
      disconnectedAt: null,
      tokenExpiresAt: new Date("2027-02-20T15:00:00.000Z"),
      depositEnabled: true,
      depositMode: "fixed",
      depositAmount: 200,
      depositPercent: 0,
      holdMinutes: 45,
      marketplaceFeeMode: "fixed",
      marketplaceFeeValue: 0,
    },
    {
      clinicId: CL_SUR,
      mpUserId: "987654321",
      mpNickname: "SUR_MP",
      mpEmail: "cobros@sur.mx",
      accessToken: TOKEN_FALSO,
      refreshToken: TOKEN_FALSO,
      liveMode: false,
      connectedAt: HACE_UN_MES,
      disconnectedAt: null,
      tokenExpiresAt: new Date("2027-02-20T15:00:00.000Z"),
      depositEnabled: true,
      depositMode: "percent",
      depositAmount: 150,
      depositPercent: 30,
      holdMinutes: 120,
      marketplaceFeeMode: "fixed",
      marketplaceFeeValue: 0,
    },
  ];

  const anticipo = (over: Fila): Fila => ({
    appointmentId: null,
    amount: 200,
    paidAmount: null,
    mpPaymentId: null,
    appointmentConfirmed: false,
    lastMpStatus: null,
    lastMpStatusDetail: null,
    noticeError: null,
    createdAt: HACE_UN_MES,
    ...over,
  });
  const appointmentDeposits: Fila[] = [
    anticipo({ id: "dep-n1", clinicId: CL_NORTE, patientId: "p-ana", status: "PAID", paidAmount: 200, mpPaymentId: "mp-1", appointmentConfirmed: true }),
    anticipo({ id: "dep-n2", clinicId: CL_NORTE, patientId: "p-beto", status: "PAID", paidAmount: 200, mpPaymentId: "mp-2", appointmentConfirmed: true }),
    anticipo({ id: "dep-n3", clinicId: CL_NORTE, patientId: "p-carla", status: "PENDING" }),
    anticipo({ id: "dep-s1", clinicId: CL_SUR, patientId: "p-sur-1", status: "EXPIRED", amount: 450 }),
  ];
  const appointmentDepositPayments: Fila[] = [
    { id: "pay-n1", clinicId: CL_NORTE, depositId: "dep-n1", mpPaymentId: "mp-1", amount: 200, anomaly: null },
    { id: "pay-n2", clinicId: CL_NORTE, depositId: "dep-n2", mpPaymentId: "mp-2", amount: 200, anomaly: null },
    { id: "pay-n2b", clinicId: CL_NORTE, depositId: "dep-n2", mpPaymentId: "mp-2b", amount: 200, anomaly: "segundo_pago" },
  ];
  return { clinicMercadoPagos, appointmentDeposits, appointmentDepositPayments };
}

/** La siembra de siempre + Mercado Pago en las dos clínicas. */
export function baseConMercadoPago(): BaseDoble {
  return crearBase({ ...datosDePrueba(), ...filasMercadoPago() });
}

/**
 * Las variables con las que `plataformaAnticipos()` da la función por lista.
 * Sin ellas (lo normal en una prueba) el anticipo sale apagado aunque la
 * clínica lo tenga encendido, igual que en la pantalla. Devuelve cómo dejarlas.
 */
export function encenderPlataforma(): () => void {
  const claves = ["MERCADOPAGO_CLIENT_ID", "MERCADOPAGO_CLIENT_SECRET", "DATA_ENCRYPTION_KEY", "NEXT_PUBLIC_APP_URL"] as const;
  const antes = claves.map((k) => [k, process.env[k]] as const);
  process.env.MERCADOPAGO_CLIENT_ID = "app-de-prueba";
  process.env.MERCADOPAGO_CLIENT_SECRET = "secreto-de-prueba";
  process.env.DATA_ENCRYPTION_KEY = "0".repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = "https://prueba.dalecontrol.local";
  return () => {
    for (const [k, v] of antes) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
