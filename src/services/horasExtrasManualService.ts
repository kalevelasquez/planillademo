import { supabase } from '../config/supabaseClient';

export interface EmpleadoParaCargaManual {
    id: string;
    nombre_completo: string;
    sueldo_mensual: number | null;
}

export interface HorasExtrasManualRow {
    id: string;
    tenant_id: string;
    quincena_id: string;
    ubicacion_id: string;
    empleado_id: string;
    horas_regulares: number;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    monto_total: number;
    guardado_por: string | null;
    guardado_at: string | null;
}

export interface AgregadoManualConfirmado {
    empleado_id: string;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    monto_total: number;
    /** `sueldo_mensual`/`ubicacion_id` necesarios para reconstruir `FilaAgregada` editable tras
     * Reabrir (antes esta vista era solo de lectura, IMPL-149). */
    empleado: { nombre_completo: string; sueldo_mensual: number | null; ubicacion_id: string | null } | null;
}

export interface NuevaFilaHorasManual {
    tenant_id: string;
    quincena_id: string;
    ubicacion_id: string;
    empleado_id: string;
    horas_regulares: number;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    monto_total: number;
    guardado_por: string;
    guardado_at: string;
}

export const horasExtrasManualService = {
    /**
     * US-ANT-07/US-DESC-06 (IMPL-83/IMPL-84), extendido a Horas Extras (IMPL-23/25) — horas
     * ya confirmadas de un empleado en una quincena puntual, para la alerta al liquidar
     * (pasar a Inactivo). A diferencia de anticipos/descuentos, esta tabla no tiene un estado
     * "activo" propio: cada fila ya vive scoped a una quincena, así que "pendiente" es
     * simplemente "existe una fila para este empleado en esta quincena".
     */
    async getPorEmpleadoYQuincena(empleadoId: string, quincenaId: string): Promise<HorasExtrasManualRow[]> {
        const { data, error } = await supabase
            .from('planilla_horas_extras_manual')
            .select('*')
            .eq('empleado_id', empleadoId)
            .eq('quincena_id', quincenaId);
        if (error) throw error;
        return data || [];
    },

    /** US-EXP-05 (IMPL-158) — todas las filas de horas extra de una quincena, para el Recibo de
     * Sueldo masivo (sin N+1 sobre cada empleado, a diferencia de `getPorEmpleadoYQuincena`). */
    async getPorQuincena(quincenaId: string): Promise<HorasExtrasManualRow[]> {
        const { data, error } = await supabase
            .from('planilla_horas_extras_manual')
            .select('*')
            .eq('quincena_id', quincenaId);
        if (error) throw error;
        return data || [];
    },

    /**
     * Empleados activos asignados a esta ubicación (US-HEX-06 CA1) — solo ve a los que
     * tienen `ubicacion_id` asignado; ver gap sobre empleados sin ubicación asignada.
     */
    async getEmpleadosPorUbicacion(ubicacionId: string): Promise<EmpleadoParaCargaManual[]> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('id, nombre_completo, sueldo_mensual')
            .eq('ubicacion_id', ubicacionId)
            .eq('estado', 'activo')
            .is('deleted_at', null)
            .order('nombre_completo', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async getHorasGuardadas(quincenaId: string, ubicacionId: string): Promise<HorasExtrasManualRow[]> {
        const { data, error } = await supabase
            .from('planilla_horas_extras_manual')
            .select('*')
            .eq('quincena_id', quincenaId)
            .eq('ubicacion_id', ubicacionId);
        if (error) throw error;
        return data || [];
    },

    /**
     * IMPL-149 — empleados agregados manualmente (US-HEX-07) ya confirmados de una ubicación
     * de Reloj Marcador, con nombre incluido para la vista de solo lectura.
     */
    async getAgregadosConfirmados(quincenaId: string, ubicacionId: string): Promise<AgregadoManualConfirmado[]> {
        const { data, error } = await supabase
            .from('planilla_horas_extras_manual')
            .select('empleado_id, hed, hen, nocturnidad, feriado, monto_total, empleado:planilla_empleados(nombre_completo, sueldo_mensual, ubicacion_id)')
            .eq('quincena_id', quincenaId)
            .eq('ubicacion_id', ubicacionId)
            .eq('agregado_manualmente', true);
        if (error) throw error;
        return (data || []) as unknown as AgregadoManualConfirmado[];
    },

    /**
     * Guarda (upsert) las filas de esta ubicación (CA4 "Guardar [ubicación]"). Permite
     * re-guardar mientras la ubicación no esté completada — a diferencia de
     * `planilla_marcaciones`, esta tabla sí admite UPDATE.
     */
    async guardarFilas(rows: NuevaFilaHorasManual[]): Promise<void> {
        if (rows.length === 0) return;
        const { error } = await supabase
            .from('planilla_horas_extras_manual')
            .upsert(rows, { onConflict: 'quincena_id,ubicacion_id,empleado_id' });
        if (error) throw error;
    },
};
