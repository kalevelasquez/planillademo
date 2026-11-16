/**
 * src/utils/errorMapper.ts
 * ─────────────────────────────────────────────────────────────────
 * Diccionario de traducción de errores técnicos a amigables (US-OBS-01 CA3).
 */

export interface ErrorMapping {
    friendlyMessage: string;
    actionSuggestion?: string;
}

const ERROR_DICTIONARY: Record<string, ErrorMapping> = {
    // Errores de PostgREST / SQL
    "23505": {
        friendlyMessage: "Este registro ya existe en el sistema.",
        actionSuggestion: "Verifique si el dato (ej: email o nombre) ya ha sido utilizado."
    },
    "PGRST116": {
        friendlyMessage: "No se encontró el registro solicitado.",
        actionSuggestion: "Refresque la página o verifique el ID del elemento."
    },
    "42703": {
        friendlyMessage: "Error de configuración de datos. Por favor contacte a soporte técnico.",
        actionSuggestion: "Intente realizar la acción nuevamente en unos minutos."
    },
    "23503": {
        friendlyMessage: "No se puede eliminar este registro porque tiene otros datos asociados.",
        actionSuggestion: "Elimine primero los registros relacionados antes de intentar de nuevo."
    },

    // Errores de Autenticación (Supabase Auth)
    "invalid_credentials": {
        friendlyMessage: "Correo o contraseña incorrectos.",
        actionSuggestion: "Revise sus credenciales e intente de nuevo."
    },
    "AuthApiError: Invalid login credentials": {
        friendlyMessage: "Correo o contraseña incorrectos.",
        actionSuggestion: "Revise sus credenciales e intente de nuevo."
    },
    "AuthSessionMissingError": {
        friendlyMessage: "Su sesión ha expirado.",
        actionSuggestion: "Por favor, vuelva a iniciar sesión."
    },
    "429": {
        friendlyMessage: "Demasiados intentos seguidos.",
        actionSuggestion: "Espere unos minutos antes de intentar de nuevo."
    },

    // Errores de Negocio Custom (Edge Functions)
    "FORBIDDEN": {
        friendlyMessage: "No tiene permisos para realizar esta acción.",
        actionSuggestion: "Contacte a su administrador si cree que esto es un error."
    },
    "BAD_REQUEST": {
        friendlyMessage: "La solicitud es inválida.",
        actionSuggestion: "Asegúrese de haber llenado todos los campos correctamente."
    },

    // Fallback por defecto
    "DEFAULT": {
        friendlyMessage: "Ups, algo salió mal de forma inesperada.",
        actionSuggestion: "Recargue la página o contacte a soporte si el problema persiste."
    }
};

/**
 * Traduce un error técnico a uno amigable basado en el diccionario.
 * @param error Objeto del error capturado (de Supabase, catch, etc.)
 * @returns ErrorMapping con el mensaje traducido
 */
export function getFriendlyError(error: any): ErrorMapping {
    if (!error) return ERROR_DICTIONARY.DEFAULT;

    const code = error.code || error.status || error.message || "";

    // Buscar por coincidencia exacta de código
    if (code && ERROR_DICTIONARY[code]) {
        return ERROR_DICTIONARY[code];
    }

    // Buscar por coincidencia parcial en el mensaje (para errores de auth que varían)
    const matchingKey = Object.keys(ERROR_DICTIONARY).find(key =>
        error.message?.includes(key) || String(code).includes(key)
    );

    if (matchingKey) {
        return ERROR_DICTIONARY[matchingKey];
    }

    return ERROR_DICTIONARY.DEFAULT;
}
