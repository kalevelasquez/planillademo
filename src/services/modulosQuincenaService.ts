import { supabase } from '../config/supabaseClient';

export type ModuloPlanilla = 'horas_extras' | 'viaticos' | 'vacaciones' | 'bonificaciones' | 'anticipos' | 'incapacidades' | 'descuentos' | 'permisos';
export type EstadoModulo = 'pendiente' | 'con_datos' | 'confirmado';

export const MODULOS_OBLIGATORIOS: ModuloPlanilla[] = [
    'horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos', 'permisos',
];

// CA2 de US-QNA-06: estos módulos aceptan "Sin registros este período" sin datos reales.
// Horas Extras, Anticipos y Descuentos SÍ requieren datos reales para confirmarse — por
// diseño, no por estar bloqueados (los 3 módulos ya existen y confirman vía acción real:
// Horas Extras con `completarUbicacion`, Anticipos/Descuentos con `confirmarModuloConDatos`
// tras "Procesar Cuotas de esta Quincena", revisión épica por épica). Permisos se agrega acá
// (corrección de septiembre 2026, IMPL-16 CA3) porque, en la práctica, es un módulo que puede
// legítimamente no tener registros en una quincena dada — mismo criterio que Incapacidades.
export const MODULOS_CON_ESCAPE_SIN_REGISTROS: ModuloPlanilla[] = ['viaticos', 'incapacidades', 'vacaciones', 'bonificaciones', 'permisos'];

export interface QuincenaModuloEstado {
    id: string;
    tenant_id: string;
    quincena_id: string;
    modulo: ModuloPlanilla;
    estado: EstadoModulo;
    via_sin_registros: boolean;
    confirmado_por: string | null;
    confirmado_at: string | null;
}

export type EstadoUbicacionModulo = 'pendiente' | 'completado';

export interface QuincenaModuloUbicacionEstado {
    id: string;
    tenant_id: string;
    quincena_id: string;
    ubicacion_id: string;
    modulo: ModuloPlanilla;
    estado: EstadoUbicacionModulo;
    via_sin_registros: boolean;
    completado_por: string | null;
    completado_at: string | null;
    reabierta_por: string | null;
    reabierta_at: string | null;
    reapertura_motivo: string | null;
}

export const modulosQuincenaService = {
    async getEstados(quincenaId: string): Promise<QuincenaModuloEstado[]> {
        const { data, error } = await supabase
            .from('quincena_modulo_estado')
            .select('*')
            .eq('quincena_id', quincenaId);
        if (error) throw error;
        return data || [];
    },

    /**
     * Asegura que los 7 módulos obligatorios tengan una fila (estado 'pendiente' por
     * defecto) para esta quincena. Idempotente — solo inserta lo que falte.
     */
    async inicializarEstados(tenantId: string, quincenaId: string): Promise<QuincenaModuloEstado[]> {
        const existentes = await this.getEstados(quincenaId);
        const yaExisten = new Set(existentes.map((e) => e.modulo));
        const faltantes = MODULOS_OBLIGATORIOS.filter((m) => !yaExisten.has(m));

        if (faltantes.length === 0) return existentes;

        const { data, error } = await supabase
            .from('quincena_modulo_estado')
            .insert(faltantes.map((modulo) => ({ tenant_id: tenantId, quincena_id: quincenaId, modulo })))
            .select();
        if (error) throw error;

        return [...existentes, ...(data || [])];
    },

    /**
     * "Sin registros este período" (CA2) — solo para MODULOS_CON_ESCAPE_SIN_REGISTROS.
     */
    async marcarSinRegistros(id: string, userId: string): Promise<QuincenaModuloEstado> {
        const { data, error } = await supabase
            .from('quincena_modulo_estado')
            .update({ estado: 'confirmado', via_sin_registros: true, confirmado_por: userId, confirmado_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /**
     * Confirma un módulo con datos reales (US-HEX-04 CA8) — a diferencia de
     * `marcarSinRegistros`, este es el camino para módulos como Horas Extras que SÍ
     * requieren datos reales para confirmarse.
     */
    async confirmarConDatos(id: string, userId: string): Promise<QuincenaModuloEstado> {
        const { data, error } = await supabase
            .from('quincena_modulo_estado')
            .update({ estado: 'confirmado', via_sin_registros: false, confirmado_por: userId, confirmado_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /**
     * Estados de completitud por ubicación de un módulo en esta quincena (corrección de
     * arquitectura: `quincena_modulo_estado` no tiene dimensión de ubicación, así que un
     * módulo con varias ubicaciones necesita esta tabla aparte para no confirmarse
     * prematuramente cuando solo UNA ubicación terminó).
     */
    async getEstadosUbicacion(quincenaId: string, modulo: ModuloPlanilla): Promise<QuincenaModuloUbicacionEstado[]> {
        const { data, error } = await supabase
            .from('quincena_modulo_ubicacion_estado')
            .select('*')
            .eq('quincena_id', quincenaId)
            .eq('modulo', modulo);
        if (error) throw error;
        return data || [];
    },

    /**
     * Asegura que cada ubicación activa tenga una fila 'pendiente' para este módulo en esta
     * quincena. Idempotente — solo inserta lo que falte.
     */
    async inicializarEstadosUbicacion(tenantId: string, quincenaId: string, ubicacionIds: string[], modulo: ModuloPlanilla): Promise<QuincenaModuloUbicacionEstado[]> {
        const existentes = await this.getEstadosUbicacion(quincenaId, modulo);
        const yaExisten = new Set(existentes.map((e) => e.ubicacion_id));
        const faltantes = ubicacionIds.filter((id) => !yaExisten.has(id));

        if (faltantes.length === 0) return existentes;

        const { data, error } = await supabase
            .from('quincena_modulo_ubicacion_estado')
            .insert(faltantes.map((ubicacion_id) => ({ tenant_id: tenantId, quincena_id: quincenaId, ubicacion_id, modulo })))
            .select();
        if (error) throw error;

        return [...existentes, ...(data || [])];
    },

    /**
     * Marca una ubicación como completada para este módulo y, si TODAS las ubicaciones
     * activas ya están completadas, confirma el módulo a nivel de quincena — vía el RPC
     * transaccional `completar_ubicacion_modulo` (evita la condición de carrera de dos
     * ubicaciones terminando casi al mismo tiempo).
     */
    async completarUbicacion(quincenaId: string, ubicacionId: string, modulo: ModuloPlanilla, userId: string, viaSinRegistros = false): Promise<void> {
        const { error } = await supabase.rpc('completar_ubicacion_modulo', {
            p_quincena_id: quincenaId,
            p_ubicacion_id: ubicacionId,
            p_modulo: modulo,
            p_user_id: userId,
            p_via_sin_registros: viaSinRegistros,
        });
        if (error) throw error;
    },

    /** "Sin horas extra esta ubicación" (IMPL-16 CA2, corrección de septiembre 2026) — wrapper
     * de lectura más clara sobre `completarUbicacion` para el caso "sin datos reales". */
    async marcarUbicacionSinRegistros(quincenaId: string, ubicacionId: string, modulo: ModuloPlanilla, userId: string): Promise<void> {
        await this.completarUbicacion(quincenaId, ubicacionId, modulo, userId, true);
    },

    /**
     * Reabre una ubicación/módulo ya completado mientras la quincena sigue 'en_proceso'
     * (IMPL-124) — corrige un error sin necesitar cerrar y re-abrir la quincena entera.
     * Motivo obligatorio (validado también en el RPC). Des-cascada `quincena_modulo_estado`
     * a 'pendiente' si el módulo ya estaba confirmado a nivel de quincena.
     */
    async reabrirUbicacion(quincenaId: string, ubicacionId: string, modulo: ModuloPlanilla, motivo: string): Promise<QuincenaModuloUbicacionEstado> {
        const { data, error } = await supabase.rpc('reabrir_modulo_ubicacion', {
            p_quincena_id: quincenaId,
            p_ubicacion_id: ubicacionId,
            p_modulo: modulo,
            p_motivo: motivo,
        });
        if (error) throw error;
        return data;
    },

    /**
     * Confirma un módulo sin dimensión de ubicación (a diferencia de `completarUbicacion`)
     * tras una acción real de datos — usado por Anticipos/Descuentos (US-QNA-06, revisión
     * épica por épica) justo después de "Procesar Cuotas de esta Quincena". Idempotente:
     * no vuelve a escribir si el módulo ya estaba confirmado.
     */
    async confirmarModuloConDatos(tenantId: string, quincenaId: string, modulo: ModuloPlanilla, userId: string): Promise<void> {
        const estados = await this.inicializarEstados(tenantId, quincenaId);
        const estado = estados.find((e) => e.modulo === modulo);
        if (estado && estado.estado !== 'confirmado') {
            await this.confirmarConDatos(estado.id, userId);
        }
    },

    /**
     * Bugfix (auditoría, hallazgo crítico #6): antes de esto, Incapacidades/Vacaciones/
     * Bonificaciones no tenían acción de "confirmar con datos reales" — si el Preparador
     * cargaba registros de verdad, la única forma de pasar el checklist seguía siendo "Sin
     * registros este período", dejando `via_sin_registros=true` en el rastro de auditoría a
     * pesar de que sí había datos. Se usa para decidir, por módulo, cuál botón mostrar (y como
     * red de seguridad antes de permitir marcar "sin registros").
     *
     * IMPL-16 CA1 (septiembre 2026) — también se usa para el estado visual "Con datos"
     * (amarillo) del checklist, por eso ahora cubre los 8 módulos obligatorios y no solo los
     * que tienen escape de "sin registros". Horas Extras/Anticipos/Descuentos no tienen
     * `quincena_id` en su tabla principal (son registros de por vida) — se consulta la tabla
     * de eventos por quincena de cada uno (`planilla_horas_extras_manual` si tiene filas,
     * `planilla_anticipo_pagos`, `planilla_descuento_eventos`).
     */
    async tieneRegistrosReales(quincenaId: string, modulo: ModuloPlanilla): Promise<boolean> {
        const tablasPorModulo: Partial<Record<ModuloPlanilla, string[]>> = {
            horas_extras: ['planilla_horas_extras_manual'],
            incapacidades: ['planilla_incapacidades'],
            vacaciones: ['planilla_vacaciones'],
            bonificaciones: ['planilla_bonificaciones'],
            viaticos: ['planilla_viaticos_por_ruta', 'planilla_viaticos_fijos_variables', 'planilla_viaticos_kilometraje'],
            anticipos: ['planilla_anticipo_pagos'],
            descuentos: ['planilla_descuento_eventos'],
            permisos: ['planilla_permisos'],
        };
        const tablas = tablasPorModulo[modulo];
        if (!tablas) return false;

        for (const tabla of tablas) {
            const { count, error } = await supabase
                .from(tabla)
                .select('id', { count: 'exact', head: true })
                .eq('quincena_id', quincenaId);
            if (error) throw error;
            if ((count ?? 0) > 0) return true;
        }
        return false;
    },
};
