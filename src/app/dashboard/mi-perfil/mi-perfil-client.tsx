"use client";

import { useState } from "react";
import { BadgeCheck, UserRound } from "lucide-react";
import toast from "react-hot-toast";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { RaizRediseno } from "@/components/dashboard/piezas-rediseno/raiz";
import { Boton, Cabecera, Campo, Tarjeta, clases as s } from "@/components/dashboard/piezas-rediseno/piezas";
import { ESPECIALIDADES_EQUIPO, opcionFueraDeLista } from "@/lib/team/especialidad-equipo";
import { LLAVE_ESPECIALIDAD, cambiosDeMiPerfil, textosMiPerfil, type CampoPropio } from "@/lib/team/mis-datos-profesionales";

type Datos = Record<CampoPropio, string>;

// `.campoFila` alinea abajo (pensado para un botón al lado); aquí hay campos con ayuda debajo: arriba.
const FILA = { alignItems: "flex-start", marginBottom: 12 } as const;

const ROL: Record<string, string> = {
  SUPER_ADMIN: "settings.team.roleSuperAdmin",
  ADMIN: "settings.team.roleAdmin",
  DOCTOR: "settings.team.roleDoctor",
  RECEPTIONIST: "settings.team.roleReceptionist",
  READONLY: "settings.team.roleReadonly",
};

export function MiPerfilClient({ inicial, email, role, clinico }: {
  inicial: Datos;
  email: string;
  role: string;
  /** Recepción y solo lectura no llevan datos de médico. */
  clinico: boolean;
}) {
  const t = useT();
  const tx = textosMiPerfil(useLocale());
  const [guardado, setGuardado] = useState<Datos>(inicial);
  const [datos, setDatos] = useState<Datos>(inicial);
  const [guardando, setGuardando] = useState(false);
  const set = (k: CampoPropio) => (e: { target: { value: string } }) => setDatos((d) => ({ ...d, [k]: e.target.value }));
  const parche = cambiosDeMiPerfil(guardado, datos);
  const hayCambios = Object.keys(parche).length > 0;

  async function guardar() {
    if (!datos.firstName.trim() || !datos.lastName.trim()) { toast.error(tx.errores.vacio); return; }
    if (!hayCambios) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parche),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(typeof j?.error === "string" ? j.error : tx.error);
        return;
      }
      setGuardado(datos);
      toast.success(tx.guardado);
    } catch {
      toast.error(tx.error);
    } finally {
      setGuardando(false);
    }
  }

  const entrada = (k: CampoPropio, etiqueta: string, extra?: { placeholder?: string; tipo?: string }) => (
    <Campo etiqueta={etiqueta} htmlFor={`mp-${k}`}>
      <input id={`mp-${k}`} className={s.campoEntrada} value={datos[k]} onChange={set(k)} autoComplete="off"
        type={extra?.tipo ?? "text"} placeholder={extra?.placeholder} />
    </Campo>
  );

  return (
    <RaizRediseno>
      <Cabecera
        titulo={tx.titulo}
        subtitulo={tx.subtitulo}
        acciones={
          <Boton variante="principal" onClick={() => void guardar()} disabled={guardando || !hayCambios}>
            {guardando ? tx.guardando : tx.guardar}
          </Boton>
        }
      />
      <div className={s.apilado}>
        <Tarjeta icono={<UserRound size={15} strokeWidth={1.75} />} titulo={tx.personales}>
          <div className={s.campoFila} style={FILA}>
            {entrada("firstName", tx.nombre)}
            {entrada("lastName", tx.apellidos)}
          </div>
          <div className={s.campoFila} style={FILA}>
            {entrada("phone", tx.telefono, { tipo: "tel", placeholder: "+52 999 000 0000" })}
            <Campo etiqueta={tx.correo} htmlFor="mp-correo">
              <input id="mp-correo" className={s.campoEntrada} value={email} disabled aria-describedby="mp-correo-ayuda" />
              <span id="mp-correo-ayuda" className={s.detalle}>{tx.correoAyuda}</span>
            </Campo>
          </div>
          <div className={s.campoFila} style={FILA}>
            <Campo etiqueta={tx.rol} htmlFor="mp-rol">
              <input id="mp-rol" className={s.campoEntrada} value={ROL[role] ? t(ROL[role]) : role} disabled aria-describedby="mp-rol-ayuda" />
              <span id="mp-rol-ayuda" className={s.detalle}>{tx.rolAyuda}</span>
            </Campo>
          </div>
        </Tarjeta>

        {clinico && (
          <Tarjeta icono={<BadgeCheck size={15} strokeWidth={1.75} />} titulo={tx.profesionales} sub={tx.profesionalesAyuda}>
            <div className={s.campoFila} style={FILA}>
              <Campo etiqueta={tx.especialidadEquipo} htmlFor="mp-specialty">
                <select id="mp-specialty" className={s.campoEntrada} value={datos.specialty} onChange={set("specialty")}>
                  <option value="">{tx.sinEspecialidad}</option>
                  {ESPECIALIDADES_EQUIPO.map((id) => <option key={id} value={id}>{t(LLAVE_ESPECIALIDAD[id])}</option>)}
                  {opcionFueraDeLista(datos.specialty) && <option value={datos.specialty}>{datos.specialty}</option>}
                </select>
              </Campo>
              {entrada("cedulaProfesional", tx.cedula)}
            </div>
            <div className={s.campoFila} style={FILA}>
              {entrada("especialidad", tx.especialidadOficial, { placeholder: tx.especialidadOficialEjemplo })}
              {entrada("cedulaEspecialidad", tx.cedulaEspecialidad)}
            </div>
          </Tarjeta>
        )}
      </div>
    </RaizRediseno>
  );
}
