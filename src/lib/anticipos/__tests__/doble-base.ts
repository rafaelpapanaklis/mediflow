// Base en memoria para conducir el servicio de anticipos (WS1-T5) sin Postgres.
//
// Solo lo que el servicio usa, pero DE VERDAD: el `where` se interpreta (así el
// filtro por clinicId, los estados y las fechas se ejercitan), el índice único
// de `mpPaymentId` lanza P2002 como Prisma, y `$transaction` serializa como el
// FOR UPDATE de la fila. Un operador que no se conoce LANZA: nada de verdes
// silenciosos.

type Fila = Record<string, any>;

function cumple(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
  if (typeof cond !== "object") return valor === cond;
  for (const [op, arg] of Object.entries(cond)) {
    const v = valor instanceof Date ? valor.getTime() : valor;
    const a = arg instanceof Date ? arg.getTime() : arg;
    switch (op) {
      case "in":
        if (!(arg as any[]).includes(valor)) return false;
        break;
      case "notIn":
        if ((arg as any[]).includes(valor)) return false;
        break;
      case "not":
        if (arg === null ? valor === null || valor === undefined : valor === arg) return false;
        break;
      case "lt":
        if (v == null || !(v < a)) return false;
        break;
      case "lte":
        if (v == null || !(v <= a)) return false;
        break;
      case "gt":
        if (v == null || !(v > a)) return false;
        break;
      case "gte":
        if (v == null || !(v >= a)) return false;
        break;
      default:
        throw new Error(`doble-base: operador sin doble «${op}»`);
    }
  }
  return true;
}

export class DobleBase {
  tablas: Record<string, Fila[]> = {
    clinic: [],
    clinicMercadoPago: [],
    procedureCatalog: [],
    inboxThread: [],
    appointment: [],
    appointmentDeposit: [],
    appointmentDepositPayment: [],
    patientCredit: [],
  };
  private seq = 0;
  private cola: Promise<unknown> = Promise.resolve();
  /** Cuántas transacciones se abrieron (para las pruebas de concurrencia). */
  transacciones = 0;
  /**
   * Se llama justo antes de cada `create` (modelo, datos). Sirve para simular
   * que OTRA entrega del webhook metió su fila en ese instante.
   */
  antesDeCrear: ((modelo: string, data: Fila) => void) | null = null;
  /** Filas creadas dentro de la transacción en curso: se quitan si falla (ROLLBACK). */
  private creadasEnTx: Array<[string, Fila]> | null = null;

  nuevoId(prefijo: string) {
    this.seq += 1;
    return `${prefijo}${this.seq}`;
  }

  filtrar(modelo: string, where: Fila = {}): Fila[] {
    return this.tablas[modelo].filter((f) => this.coincide(modelo, f, where));
  }

  private coincide(modelo: string, fila: Fila, where: Fila): boolean {
    for (const [k, cond] of Object.entries(where ?? {})) {
      if (k === "AND") {
        if (!(cond as Fila[]).every((w) => this.coincide(modelo, fila, w))) return false;
      } else if (k === "OR") {
        if (!(cond as Fila[]).some((w) => this.coincide(modelo, fila, w))) return false;
      } else if (k === "deposits" && modelo === "appointment") {
        const hijos = this.tablas.appointmentDeposit.filter((d) => d.appointmentId === fila.id);
        if (cond.none && hijos.some((h) => this.coincide("appointmentDeposit", h, cond.none))) return false;
        if (!cond.none) throw new Error("doble-base: filtro de relación sin doble");
      } else if (!cumple(fila[k], cond)) {
        return false;
      }
    }
    return true;
  }

  private proyectar(modelo: string, fila: Fila | undefined, select?: Fila): Fila | null {
    if (!fila) return null;
    const copia: Fila = { ...fila };
    if (!select) return copia;
    const out: Fila = {};
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue;
      if (modelo === "appointmentDeposit" && k === "appointment") {
        const a = this.tablas.appointment.find((x) => x.id === fila.appointmentId);
        out[k] = a ? this.proyectar("appointment", a, (v as Fila).select) : null;
      } else if (modelo === "appointmentDeposit" && k === "clinic") {
        const c = this.tablas.clinic.find((x) => x.id === fila.clinicId);
        out[k] = c ? this.proyectar("clinic", c, (v as Fila).select) : null;
      } else {
        out[k] = copia[k];
      }
    }
    return out;
  }

  private modelo(nombre: string) {
    const yo = this;
    return {
      async findFirst(args: Fila = {}) {
        return yo.proyectar(nombre, yo.filtrar(nombre, args.where)[0], args.select);
      },
      async findUnique(args: Fila) {
        return yo.proyectar(nombre, yo.filtrar(nombre, args.where)[0], args.select);
      },
      async findMany(args: Fila = {}) {
        let filas = yo.filtrar(nombre, args.where);
        if (args.orderBy) {
          const [campo, dir] = Object.entries(args.orderBy)[0] as [string, string];
          filas = [...filas].sort((a, b) => (a[campo] > b[campo] ? 1 : -1) * (dir === "desc" ? -1 : 1));
        }
        if (args.take) filas = filas.slice(0, args.take);
        return filas.map((f) => yo.proyectar(nombre, f, args.select));
      },
      async create(args: Fila) {
        yo.antesDeCrear?.(nombre, args.data);
        const fila: Fila = { id: yo.nuevoId(nombre.slice(0, 3)), createdAt: new Date(), ...args.data };
        if (nombre === "appointmentDepositPayment") {
          for (const unico of ["mpPaymentId", "patientCreditId"]) {
            if (fila[unico] != null && yo.tablas[nombre].some((f) => f[unico] === fila[unico])) {
              const e: any = new Error(`Unique constraint failed on ${unico}`);
              e.code = "P2002";
              throw e;
            }
          }
        }
        yo.tablas[nombre].push(fila);
        yo.creadasEnTx?.push([nombre, fila]);
        return yo.proyectar(nombre, fila, args.select);
      },
      async update(args: Fila) {
        const fila = yo.filtrar(nombre, args.where)[0];
        if (!fila) {
          const e: any = new Error("Record to update not found.");
          e.code = "P2025";
          throw e;
        }
        Object.assign(fila, args.data);
        return yo.proyectar(nombre, fila, args.select);
      },
      async updateMany(args: Fila) {
        const filas = yo.filtrar(nombre, args.where);
        for (const f of filas) Object.assign(f, args.data);
        return { count: filas.length };
      },
      async upsert(args: Fila) {
        const fila = yo.filtrar(nombre, args.where)[0];
        if (fila) {
          Object.assign(fila, args.update);
          return fila;
        }
        const nueva = { ...args.create };
        yo.tablas[nombre].push(nueva);
        return nueva;
      },
    };
  }

  /** El cliente que se le pasa al servicio como `db`. */
  cliente(): any {
    const yo = this;
    const base: any = {
      $queryRaw: async () => [],
      $transaction: (fn: (tx: any) => Promise<unknown>) => {
        yo.transacciones += 1;
        // Serializa como el FOR UPDATE: la siguiente espera a que acabe esta.
        // Si el cuerpo lanza, las filas que creó desaparecen (ROLLBACK).
        const corrida = yo.cola.then(async () => {
          yo.creadasEnTx = [];
          try {
            const r = await fn(base);
            yo.creadasEnTx = null;
            return r;
          } catch (e) {
            for (const [m, f] of yo.creadasEnTx ?? []) {
              yo.tablas[m] = yo.tablas[m].filter((x) => x !== f);
            }
            yo.creadasEnTx = null;
            throw e;
          }
        });
        yo.cola = corrida.catch(() => undefined);
        return corrida;
      },
    };
    for (const nombre of Object.keys(yo.tablas)) base[nombre] = yo.modelo(nombre);
    return base;
  }
}
