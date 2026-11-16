import { supabase } from '../config/supabaseClient';
import type { TipoAnticipo } from '../utils/anticiposUtils';

export interface Anticipo {
    id: string;
    tenant_id: string;
    empleado_id: string;
    numero_vale: string;
    fecha_vale: string;
    tipo: TipoAnticipo;
    monto_total: number;
    numero_cuotas: number;
    monto_cuota: number;
    monto_pagado: number;
    estado: 'activo' | 'saldado';
    autorizado_gg: boolean;
    autorizado_gg_por: string | null;
    origen: 'manual' | 'ia';
    ia_confianza: number | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoAnticipo {
    empleadoId: string;
    numeroVale: string;
    fechaVale: string;
    tipo: TipoAnticipo;
    montoTotal: number;
    numeroCuotas: number;
    autorizadoGG: boolean;
    autorizadoGGPor: string | null;
    origen: 'manual' | 'ia';
    iaConfianza: number | null;
    userId: string;
}

export interface AnticipoPago {
    id: string;
    tenant_id: string;
    anticipo_id: string;
    quincena_id: string;
    tipo: 'pago' | 'suspension';
    monto: number | null;
    motivo_suspension: string | null;
    registrado_por: string | null;
    registrado_at: string;
}

export const anticiposService = {
    /** US-ANT-07 (IMPL-83) CA1 — anticipos activos de un empleado, para la alerta al liquidar. */
    async getActivosPorEmpleado(empleadoId: string): Promise<Anticipo[]> {
        const { data, error } = await supabase
            .from('planilla_anticipos')
            .select('*')
            .eq('empleado_id', empleadoId)
            .eq('estado', 'activo');
        if (error) throw error;
        return data || [];
    },

    async getTodos(): Promise<Anticipo[]> {
        const { data, error } = await supabase
            .from('planilla_anticipos')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevoAnticipo): Promise<Anticipo> {
        const { data, error } = await supabase.rpc('crear_anticipo', {
            p_empleado_id: payload.empleadoId,
            p_numero_vale: payload.numeroVale,
            p_fecha_vale: payload.fechaVale,
            p_tipo: payload.tipo,
            p_monto_total: payload.montoTotal,
            p_numero_cuotas: payload.numeroCuotas,
            p_autorizado_gg: payload.autorizadoGG,
            p_autorizado_gg_por: payload.autorizadoGGPor,
            p_origen: payload.origen,
            p_ia_confianza: payload.iaConfianza,
            p_user_id: payload.userId,
        });
        if (error) throw error;
        return data;
    },

    async getPagosPorAnticipo(anticipoId: string): Promise<AnticipoPago[]> {
        const { data, error } = await supabase
            .from('planilla_anticipo_pagos')
            .select('*')
            .eq('anticipo_id', anticipoId)
            .order('registrado_at', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    /** Un solo query para derivar el estado visual "Suspendido" (US-ANT-00 CA2) de TODOS los
     * anticipos del listado a la vez, en vez de un fetch por fila. */
    async getPagosPorQuincena(quincenaId: string): Promise<AnticipoPago[]> {
        const { data, error } = await supabase
            .from('planilla_anticipo_pagos')
            .select('*')
            .eq('quincena_id', quincenaId);
        if (error) throw error;
        return data || [];
    },

    /** IMPL-173 (defecto UAT) — todos los eventos de cuota del tenant en un solo query, para
     * poder armar el schedule completo (`armarScheduleCuotas`) de CADA anticipo del listado y así
     * filtrar las tarjetas por la quincena seleccionada, sin un fetch por anticipo (N+1). */
    async getPagosDeTodos(): Promise<AnticipoPago[]> {
        const { data, error } = await supabase
            .from('planilla_anticipo_pagos')
            .select('*');
        if (error) throw error;
        return data || [];
    },

    /** US-ANT-03 (IMPL-52) — bulk: procesa la cuota de todos los anticipos activos que todavía
     * no tienen un evento para esta quincena. Devuelve cuántos anticipos se procesaron. */
    async procesarCuotasQuincena(quincenaId: string, userId: string): Promise<number> {
        const { data, error } = await supabase.rpc('procesar_cuotas_anticipos_quincena', {
            p_quincena_id: quincenaId,
            p_user_id: userId,
        });
        if (error) throw error;
        return data;
    },

    /** US-ANT-04 (IMPL-53) — CA2: el saldo pendiente no cambia, solo se registra el evento;
     * INSERT directo (no RPC), gateado por la policy de INSERT (quincena en_proceso). */
    async suspenderCuota(tenantId: string, anticipoId: string, quincenaId: string, motivo: string, userId: string): Promise<void> {
        const { error } = await supabase.from('planilla_anticipo_pagos').insert([{
            tenant_id: tenantId,
            anticipo_id: anticipoId,
            quincena_id: quincenaId,
            tipo: 'suspension',
            motivo_suspension: motivo,
            registrado_por: userId,
        }]);
        if (error) throw error;
    },

    /**
     * US-ANT-05 (IMPL-54) CA1: la policy de DELETE (`monto_pagado = 0`) rechaza el intento si el
     * anticipo tiene al menos una cuota pagada — pero un DELETE bloqueado por RLS devuelve 0
     * filas SIN error, no basta con `if (error) throw error` (mismo gap ya corregido en
     * `incapacidadesService`/`bonificacionesService`/`otrosIngresosService`, revisión épica por
     * épica). `.select('id')` + chequeo de filas vacías distingue el bloqueo de un éxito real.
     */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase.from('planilla_anticipos').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Este anticipo ya tiene cuotas pagadas y no se puede eliminar.');
    },

    /** US-ANT-06 (IMPL-55) — CA2: solo actualiza numero_cuotas/monto_cuota, nunca toca
     * planilla_anticipo_pagos (lo ya pagado es historial inmutable). */
    async recalcularCuotas(anticipoId: string, nuevoNumeroCuotas: number, autorizadoGG: boolean, autorizadoGGPor: string | null): Promise<Anticipo> {
        const { data, error } = await supabase.rpc('recalcular_cuotas_anticipo', {
            p_anticipo_id: anticipoId,
            p_nuevo_numero_cuotas: nuevoNumeroCuotas,
            p_autorizado_gg: autorizadoGG,
            p_autorizado_gg_por: autorizadoGGPor,
        });
        if (error) throw error;
        return data;
    },
};
