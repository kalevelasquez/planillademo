/**
 * Los servicios de este proyecto re-lanzan el `error` de Supabase tal cual (`if (error) throw
 * error`) sin usar `.throwOnError()` — ese `error` es el JSON plano de PostgREST
 * ({message, details, hint, code}), NO una instancia real de `Error`. Un check de
 * `err instanceof Error` es siempre falso ahí, así que cualquier rechazo real del backend
 * (constraint, RLS, RAISE EXCEPTION) queda oculto detrás de un mensaje genérico de fallback.
 * Encontrado y corregido dos veces por separado (VacacionModal, NuevaQuincenaModal) antes de
 * extraerlo acá.
 */
export function extraerMensajeError(err: unknown, fallback: string): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return fallback;
}
