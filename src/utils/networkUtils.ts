/**
 * Utilidades de red para resiliencia y manejo de fallos (US-PERF-01/RES).
 */

export class NetworkError extends Error {
    public isTimeout: boolean;
    constructor(message: string, isTimeout: boolean = false) {
        super(message);
        this.isTimeout = isTimeout;
        this.name = 'NetworkError';
    }
}

/**
 * Envuelve una promesa en un temporizador de fracaso forzado (Timeout Guard).
 * Evita que la aplicación se quede en un estado de carga infinito si el socket se cuelga.
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    ms: number = 8000,
    errorMessage: string = 'La petición ha tardado demasiado en responder. Reintenta por favor.'
): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id);
            reject(new NetworkError(errorMessage, true));
        }, ms);
    });

    return Promise.race([promise, timeout]);
}
