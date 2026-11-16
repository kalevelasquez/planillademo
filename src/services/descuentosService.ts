import { supabase } from '../config/supabaseClient';
import type { DescuentoImportListo } from '../utils/descuentosExcelUtils';

export interface Descuento {
    id: string;
    tenant_id: string;
    empleado_id: string;
    categoria_id: string;
    codigo: string;
    institucion: string | null;
    monto_quincenal: number;
    monto_total: number | null;
    numero_cuotas: number | null;
    monto_pagado: number;
    cuotas_pagadas: number;
    fecha_fin: string | null;
    estado: 'activo' | 'pausado' | 'completado' | 'cancelado';
    validado_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoDescuento {
    empleadoId: string;
    categoriaId: string;
    institucion: string | null;
    montoQuincenal: number;
    montoTotal: number | null;
    numeroCuotas: number | null;
    userId: string;
    fechaFin?: string | null;
    /** Alternativa a numeroCuotas: la UI manda una de las dos, nunca ambas (ver crear_descuento). */
    cuotaExacta?: number | null;
    /** Saldo con el que ya viene pagando el empleado antes de darlo de alta en el sistema. */
    montoPagadoInicial?: number;
    cuotasPagadasInicial?: number;
}

export interface DescuentoEditado {
    categoriaId: string;
    institucion: string | null;
    montoQuincenal: number;
    montoTotal: number | null;
    numeroCuotas: number | null;
    fechaFin?: string | null;
    cuotaExacta?: number | null;
}

export interface DescuentoEvento {
    id: string;
    tenant_id: string;
    descuento_id: string;
    quincena_id: string;
    tipo: 'pago' | 'suspension';
    monto: number | null;
    motivo_suspension: string | null;
    registrado_por: string | null;
    registrado_at: string;
}

export const descuentosService = {
    /** US-DESC-00 (IMPL-57) — todos los descuentos del tenant, cross-empleado, para el panel
     * consolidado (se combina en el cliente con la lista de empleados, mismo criterio que el
     * resto de servicios del proyecto — sin embedded joins). */
    async getTodos(): Promise<Descuento[]> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async getPorEmpleado(empleadoId: string): Promise<Descuento[]> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .select('*')
            .eq('empleado_id', empleadoId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** US-ANT-07/US-DESC-06 (IMPL-84) — descuentos activos de un empleado, para la alerta
     * unificada al liquidar (mismo criterio que anticiposService.getActivosPorEmpleado). */
    async getActivosPorEmpleado(empleadoId: string): Promise<Descuento[]> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .select('*')
            .eq('empleado_id', empleadoId)
            .eq('estado', 'activo');
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevoDescuento): Promise<Descuento> {
        const { data, error } = await supabase.rpc('crear_descuento', {
            p_empleado_id: payload.empleadoId,
            p_categoria_id: payload.categoriaId,
            p_institucion: payload.institucion,
            p_monto_quincenal: payload.montoQuincenal,
            p_monto_total: payload.montoTotal,
            p_numero_cuotas: payload.numeroCuotas,
            p_user_id: payload.userId,
            p_fecha_fin: payload.fechaFin ?? null,
            p_cuota_exacta: payload.cuotaExacta ?? null,
            p_monto_pagado_inicial: payload.montoPagadoInicial ?? 0,
            p_cuotas_pagadas_inicial: payload.cuotasPagadasInicial ?? 0,
        });
        if (error) throw error;
        return data;
    },

    /** US-DESC-01 CA4 (bug real de UAT, no existía ninguna forma de corregir un registro ya
     * creado) — misma lógica de recalculo server-side que `crear`, vía RPC dedicado. */
    async actualizar(id: string, payload: DescuentoEditado): Promise<Descuento> {
        const { data, error } = await supabase.rpc('actualizar_descuento', {
            p_descuento_id: id,
            p_categoria_id: payload.categoriaId,
            p_institucion: payload.institucion,
            p_monto_quincenal: payload.montoQuincenal,
            p_monto_total: payload.montoTotal,
            p_numero_cuotas: payload.numeroCuotas,
            p_fecha_fin: payload.fechaFin ?? null,
            p_cuota_exacta: payload.cuotaExacta ?? null,
        });
        if (error) throw error;
        return data;
    },

    /** US-DESC-01 CA4 — switch Activo/Pausado, un toggle manual permanente (distinto de
     * "suspender esta quincena", que es puntual y vive en planilla_descuento_eventos). */
    async cambiarEstadoPausado(id: string, pausado: boolean): Promise<Descuento> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .update({ estado: pausado ? 'pausado' : 'activo' })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /**
     * IMPL-153 — mismo patrón que anticiposService.eliminar (US-ANT-05/IMPL-54): la policy de
     * DELETE (`monto_pagado = 0`) rechaza el intento si ya se cobró alguna cuota, pero un DELETE
     * bloqueado por RLS devuelve 0 filas SIN error — `.select('id')` + chequeo de filas vacías
     * distingue el bloqueo de un éxito real.
     */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase.from('planilla_descuentos').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Este descuento ya tiene cuotas pagadas y no se puede eliminar.');
    },

    /** IMPL-153 — cancelación permanente (distinta de "Pausado", que es reversible): deja de
     * generar cuotas futuras sin borrar el historial de lo ya cobrado. */
    async cancelar(id: string): Promise<Descuento> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .update({ estado: 'cancelado' })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Un solo query para derivar el estado visual "Suspendido" de TODOS los descuentos del
     * panel a la vez (mismo criterio que anticiposService.getPagosPorQuincena). */
    async getEventosPorQuincena(quincenaId: string): Promise<DescuentoEvento[]> {
        const { data, error } = await supabase
            .from('planilla_descuento_eventos')
            .select('*')
            .eq('quincena_id', quincenaId);
        if (error) throw error;
        return data || [];
    },

    /** US-DESC-01 CA1 (revisión épica por épica) — todos los eventos (pago/suspensión) de un
     * grupo de descuentos, para el sub-tab "Historial" del perfil de empleado. */
    async getEventosPorDescuentos(descuentoIds: string[]): Promise<DescuentoEvento[]> {
        if (descuentoIds.length === 0) return [];
        const { data, error } = await supabase
            .from('planilla_descuento_eventos')
            .select('*')
            .in('descuento_id', descuentoIds)
            .order('registrado_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** US-DESC-02 (IMPL-59) CA2 — no toca monto_pagado/estado del descuento, solo registra el
     * evento; INSERT directo (no RPC), gateado por la policy de INSERT (quincena en_proceso). */
    async suspenderCuota(tenantId: string, descuentoId: string, quincenaId: string, motivo: string, userId: string): Promise<void> {
        const { error } = await supabase.from('planilla_descuento_eventos').insert([{
            tenant_id: tenantId,
            descuento_id: descuentoId,
            quincena_id: quincenaId,
            tipo: 'suspension',
            motivo_suspension: motivo,
            registrado_por: userId,
        }]);
        if (error) throw error;
    },

    /** US-DESC-05 (IMPL-62) CA1 — valida el registro antes de que se aplique por primera vez;
     * una vez seteado, queda fijo para siempre (no hace falta re-validar en cada quincena). */
    async validar(id: string): Promise<Descuento> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .update({ validado_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** US-DESC-03 (IMPL-60) CA2 — ajuste puntual del monto de la cuota (pensado para la última
     * cuota, tras la notificación de "Penúltima cuota"); no toca numero_cuotas/monto_total. */
    async ajustarMontoQuincenal(id: string, nuevoMontoQuincenal: number): Promise<Descuento> {
        const { data, error } = await supabase
            .from('planilla_descuentos')
            .update({ monto_quincenal: nuevoMontoQuincenal })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /**
     * Confirma la carga masiva por Excel — RPC transaccional `confirmar_importacion_descuentos`.
     * Recibe SOLO filas ya validadas por el cliente (`descuentosExcelUtils.validarFilasImportacionDescuentos`);
     * el RPC llama a `crear_descuento` una vez por fila dentro de la misma transacción, así que si
     * alguna choca igual en el servidor, NINGÚN descuento del lote se guarda (mismo criterio que
     * `confirmarImportacion` de empleados). Devuelve la cantidad de descuentos creados.
     */
    async confirmarImportacion(descuentos: DescuentoImportListo[], userId: string): Promise<number> {
        const { data, error } = await supabase.rpc('confirmar_importacion_descuentos', {
            p_descuentos: descuentos,
            p_user_id: userId,
        });
        if (error) throw error;
        return data as number;
    },

    /** US-DESC-04 (IMPL-61) — bulk: procesa la cuota de todos los descuentos activos CON monto
     * total definido que todavía no tienen un evento para esta quincena (CA2: los indefinidos
     * quedan fuera, nunca finalizan). Devuelve cuántos descuentos se procesaron. */
    async procesarCuotasQuincena(quincenaId: string, userId: string): Promise<number> {
        const { data, error } = await supabase.rpc('procesar_cuotas_descuentos_quincena', {
            p_quincena_id: quincenaId,
            p_user_id: userId,
        });
        if (error) throw error;
        return data;
    },
};
