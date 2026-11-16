import { supabase } from '../config/supabaseClient';

export interface MarcacionPersistida {
    empleado_id: string;
    entrada: string;
    salida: string;
}

export interface MarcacionConfirmada {
    empleado_id: string;
    entrada: string;
    salida: string;
    /** Necesarios para reconstruir filas EDITABLES tras Reabrir (ver `construirFilasDesdeConfirmadas`
     * en marcacionesValidacionUtils.ts) — antes solo se usaban estos 3 campos + nombre para la
     * vista de solo lectura (IMPL-149). */
    id_usuario_archivo: string;
    editado_manualmente: boolean;
    empleado: { nombre_completo: string; estado: 'activo' | 'inactivo'; cargo: string | null; departamento: string | null; sueldo_mensual: number | null } | null;
}

export interface NuevaMarcacionRPC {
    empleado_id: string;
    entrada: string;
    salida: string;
    id_usuario_archivo: string;
    editado_manualmente: boolean;
    /** Gap real IMPL-28 (US-HEX-10 CA1/CA2, 2026-09-24) — ubicación bajo la que se atribuye
     * esta fila: la del PERFIL del empleado, no necesariamente la pantalla desde la que se
     * confirma (`p_ubicacion_id` del RPC pasa a ser solo el "origen", ver
     * `confirmar_importacion_reloj_marcador`). */
    ubicacion_id: string;
}

export interface NuevaAusenciaInjustificadaRPC {
    empleado_id: string;
    fecha: string;
}

export interface NuevoAgregadoManual {
    empleado_id: string;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    monto_total: number;
    /** Defecto real (2026-09-23): antes el RPC hardcodeaba `true` para TODO lo que llegaba por
     * este parámetro — pero ahora también vienen acá los empleados matcheados automáticamente
     * por el reloj (su horas SÍ deben persistirse como dinero real, ver
     * `ImportacionMarcacionesSection.tsx:handleConfirmar`), que NO son "agregados manualmente"
     * (US-HEX-07). `true` = tipeado a mano por el Preparador; `false` = calculado del reloj. */
    agregado_manualmente: boolean;
    /** Gap real IMPL-28, ver comentario en `NuevaMarcacionRPC`. */
    ubicacion_id: string;
}

export const marcacionesService = {
    /**
     * Marcaciones ya confirmadas de una quincena (de cualquier ubicación) — usado para el
     * chequeo real de >120h (CA3 de US-HEX-04), que debe considerar el acumulado de toda la
     * quincena, no solo el archivo que se está validando en este momento.
     */
    async getMarcacionesPorQuincena(quincenaId: string, excluirUbicacionId?: string): Promise<MarcacionPersistida[]> {
        let query = supabase
            .from('planilla_marcaciones')
            .select('empleado_id, entrada, salida')
            .eq('quincena_id', quincenaId);
        // Reabrir + reconstruir para edición (ver `construirFilasDesdeConfirmadas`): las
        // marcaciones de ESTA MISMA ubicación ya van a volver como `filas`, así que hay que
        // excluirlas acá o el chequeo de >120h/domingo (`validarAcumulados`) las contaría dos veces.
        if (excluirUbicacionId) query = query.neq('ubicacion_id', excluirUbicacionId);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },

    /**
     * IMPL-149 — vista de solo lectura de los tramos ya confirmados de una ubicación, para
     * mostrar en vez del simple candado una vez que "horas_extras" quedó completado.
     */
    async getMarcacionesPorUbicacion(quincenaId: string, ubicacionId: string): Promise<MarcacionConfirmada[]> {
        const { data, error } = await supabase
            .from('planilla_marcaciones')
            .select('empleado_id, entrada, salida, id_usuario_archivo, editado_manualmente, empleado:planilla_empleados(nombre_completo, estado, cargo, departamento, sueldo_mensual)')
            .eq('quincena_id', quincenaId)
            .eq('ubicacion_id', ubicacionId)
            .order('entrada', { ascending: true });
        if (error) throw error;
        return (data || []) as unknown as MarcacionConfirmada[];
    },

    /**
     * Persiste el lote validado (CA8 "Confirmar importación"), los empleados agregados
     * manualmente (US-HEX-07 CA1) Y las ausencias injustificadas detectadas (IMPL-82, ahora
     * persistidas para que `calcular_planilla_empleado` las descuente — ver migración
     * 20261020090000) en una sola operación atómica vía RPC — evita el estado parcial que dos
     * llamadas sueltas a Supabase podrían dejar a mitad de camino.
     */
    async confirmarImportacion(
        quincenaId: string,
        ubicacionId: string,
        marcaciones: NuevaMarcacionRPC[],
        agregados: NuevoAgregadoManual[],
        ausenciasInjustificadas: NuevaAusenciaInjustificadaRPC[],
        userId: string
    ): Promise<void> {
        const { error } = await supabase.rpc('confirmar_importacion_reloj_marcador', {
            p_quincena_id: quincenaId,
            p_ubicacion_id: ubicacionId,
            p_marcaciones: marcaciones,
            p_agregados: agregados,
            p_ausencias_injustificadas: ausenciasInjustificadas,
            p_user_id: userId,
        });
        if (error) throw error;
    },
};
