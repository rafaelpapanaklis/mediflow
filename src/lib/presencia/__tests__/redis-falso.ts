/**
 * Un Redis en memoria con la semántica REAL de los comandos que usa la señal
 * (HSETNX no pisa, EXPIRE/EX caducan, ZADD/ZRANGE BYSCORE/ZCOUNT, INCR…) y un
 * reloj que mueven las pruebas. No es Upstash: cubre la LÓGICA de la señal, no
 * la red. El comportamiento contra un Redis de verdad se comprobó aparte
 * (ver el reporte de la tarea).
 */
import type { PipelineMini, RedisMini } from "../presencia-store";

type Valor = { tipo: "str"; v: unknown } | { tipo: "hash"; v: Map<string, unknown> } | { tipo: "zset"; v: Map<string, number> };

export class RedisFalso implements RedisMini {
  reloj = 1_000_000_000_000;
  comandos = 0;
  /** Si se pone, el siguiente exec() lanza esto. */
  fallar: Error | null = null;
  private datos = new Map<string, Valor>();
  private vence = new Map<string, number>();

  avanzar(ms: number) { this.reloj += ms; }

  private vivo(k: string): Valor | undefined {
    const t = this.vence.get(k);
    if (t !== undefined && t <= this.reloj) { this.datos.delete(k); this.vence.delete(k); }
    return this.datos.get(k);
  }
  llaves(): string[] { return Array.from(this.datos.keys()).filter((k) => this.vivo(k)); }
  /** Todo lo que hay guardado, serializado: para comprobar que no se filtra una ruta cruda. */
  volcado(): string {
    return JSON.stringify(this.llaves().map((k) => {
      const v = this.vivo(k)!;
      return [k, v.tipo === "str" ? v.v : Array.from((v.v as Map<string, unknown>).entries())];
    }));
  }
  ttl(k: string): number | null {
    this.vivo(k);
    const t = this.vence.get(k);
    return t === undefined ? null : Math.round((t - this.reloj) / 1000);
  }

  pipeline(): PipelineMini {
    const cola: Array<() => unknown> = [];
    const self = this;
    const p: PipelineMini = {
      get(k) { cola.push(() => { const v = self.vivo(k); return v && v.tipo === "str" ? v.v : null; }); return p; },
      set(k, v, opts) {
        cola.push(() => {
          self.datos.set(k, { tipo: "str", v });
          if (opts?.ex) self.vence.set(k, self.reloj + opts.ex * 1000); else self.vence.delete(k);
          return "OK";
        });
        return p;
      },
      incr(k) {
        cola.push(() => {
          const v = self.vivo(k);
          const n = (v && v.tipo === "str" ? Number(v.v) : 0) + 1;
          self.datos.set(k, { tipo: "str", v: n });
          return n;
        });
        return p;
      },
      expire(k, s) { cola.push(() => { if (!self.vivo(k)) return 0; self.vence.set(k, self.reloj + s * 1000); return 1; }); return p; },
      hset(k, kv) {
        cola.push(() => {
          let h = self.vivo(k);
          if (!h) { h = { tipo: "hash", v: new Map() }; self.datos.set(k, h); }
          for (const [c, v] of Object.entries(kv)) (h.v as Map<string, unknown>).set(c, v);
          return Object.keys(kv).length;
        });
        return p;
      },
      hsetnx(k, c, v) {
        cola.push(() => {
          let h = self.vivo(k);
          if (!h) { h = { tipo: "hash", v: new Map() }; self.datos.set(k, h); }
          const m = h.v as Map<string, unknown>;
          if (m.has(c)) return 0;
          m.set(c, v);
          return 1;
        });
        return p;
      },
      hgetall(k) {
        cola.push(() => {
          const h = self.vivo(k);
          return h && h.tipo === "hash" ? Object.fromEntries(h.v as Map<string, unknown>) : null; // Upstash: null si no existe
        });
        return p;
      },
      zadd(k, { score, member }) {
        cola.push(() => {
          let z = self.vivo(k);
          if (!z) { z = { tipo: "zset", v: new Map() }; self.datos.set(k, z); }
          (z.v as Map<string, number>).set(member, score);
          return 1;
        });
        return p;
      },
      zcount(k, min, max) {
        cola.push(() => {
          const z = self.vivo(k);
          if (!z) return 0;
          const tope = max === "+inf" ? Infinity : max;
          return Array.from((z.v as Map<string, number>).values()).filter((s) => s >= min && s <= tope).length;
        });
        return p;
      },
      zrange(k, min, max) {
        cola.push(() => {
          const z = self.vivo(k);
          if (!z) return [];
          const tope = max === "+inf" ? Infinity : max;
          return Array.from((z.v as Map<string, number>).entries())
            .filter(([, s]) => s >= min && s <= tope)
            .sort((a, b) => a[1] - b[1])
            .map(([m]) => m);
        });
        return p;
      },
      zremrangebyscore(k, min, max) {
        cola.push(() => {
          const z = self.vivo(k);
          if (!z) return 0;
          const piso = min === "-inf" ? -Infinity : min;
          let n = 0;
          for (const [m, s] of Array.from((z.v as Map<string, number>).entries())) if (s >= piso && s <= max) { (z.v as Map<string, number>).delete(m); n++; }
          return n;
        });
        return p;
      },
      async exec() {
        if (self.fallar) throw self.fallar;
        self.comandos += cola.length;
        return cola.map((f) => f());
      },
    };
    return p;
  }
}
