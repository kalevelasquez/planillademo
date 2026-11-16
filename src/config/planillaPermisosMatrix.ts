/**
 * Matriz de permisos por rol y estado de quincena (US-CIE-02 / IMPL-105). Consolida — no
 * reemplaza — lo ya implementado en US-QNA-09 (visibilidad de tabs) y en las RLS/RPCs de
 * Cierre y Aprobación (IMPL-103/104). Cada fila refleja el comportamiento REAL ya
 * construido — si una policy o un RPC cambia, esta tabla se desactualiza y hay que
 * actualizarla a mano (no hay forma de derivarla dinámicamente de Postgres desde el cliente).
 */

export type PermisoValor = 'si' | 'no' | 'condicional';

export type PermisoAccionKey =
    | 'crear_quincena' | 'editar_modulos_en_proceso' | 'editar_modulos_enviada_o_cerrada'
    | 'enviar_a_aprobacion' | 'aprobar_y_cerrar' | 'rechazar' | 'reabrir' | 'reabrir_modulo_ubicacion' | 'ver_historial_resumen';

export type PermisoNotaKey =
    | 'nota_editar_bloqueado' | 'nota_segregacion'
    | 'nota_reabrir_quincena_completa' | 'nota_reabrir_modulo_individual';

export interface PermisoMatrixRow {
    accionKey: PermisoAccionKey;
    admin: PermisoValor;
    preparador: PermisoValor;
    aprobador: PermisoValor;
    notaKey?: PermisoNotaKey;
}

export const PERMISOS_MATRIX: PermisoMatrixRow[] = [
    { accionKey: 'crear_quincena', admin: 'si', preparador: 'si', aprobador: 'no' },
    { accionKey: 'editar_modulos_en_proceso', admin: 'si', preparador: 'si', aprobador: 'no' },
    { accionKey: 'editar_modulos_enviada_o_cerrada', admin: 'no', preparador: 'no', aprobador: 'no', notaKey: 'nota_editar_bloqueado' },
    { accionKey: 'enviar_a_aprobacion', admin: 'si', preparador: 'si', aprobador: 'no' },
    { accionKey: 'aprobar_y_cerrar', admin: 'si', preparador: 'no', aprobador: 'condicional', notaKey: 'nota_segregacion' },
    // Bugfix (auditoría): ambigüedad resuelta con el usuario — Admin también puede rechazar,
    // mismo criterio que 'aprobar_y_cerrar'/'reabrir'. Antes decía admin:'no' pero la UI ya
    // dejaba entrar a un Admin puro y habilitaba el botón, chocando con el RPC real.
    { accionKey: 'rechazar', admin: 'si', preparador: 'no', aprobador: 'si' },
    { accionKey: 'reabrir', admin: 'si', preparador: 'no', aprobador: 'si', notaKey: 'nota_reabrir_quincena_completa' },
    // Bugfix (auditoría, hallazgo #5 de Configuración/Permisos): esta fila ya estaba
    // desactualizada respecto a reabrir_modulo_ubicacion (IMPL-124) — acción DISTINTA de
    // 'reabrir' (quincena completa), que sí permite preparador_planilla porque solo reabre
    // un módulo/ubicación puntual mientras la quincena sigue en_proceso.
    { accionKey: 'reabrir_modulo_ubicacion', admin: 'si', preparador: 'si', aprobador: 'no', notaKey: 'nota_reabrir_modulo_individual' },
    { accionKey: 'ver_historial_resumen', admin: 'si', preparador: 'si', aprobador: 'si' },
];
