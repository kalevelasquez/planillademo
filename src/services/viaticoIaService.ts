import { supabase } from '../config/supabaseClient';

export interface ExtraccionViaticoIA {
    legible: boolean;
    motivo_no_legible?: string;
    nombre_completo: string | null;
    codigo_empleado: string | null;
    fecha: string | null;
    cargo_motivo: string | null;
    destino: string | null;
    confianza: number;
}

const TIMEOUT_MS = 30000; // CA2 — el cliente reacciona a los 30s pase lo que pase, aunque el
// servidor también tenga su propio timeout (~25s) por costo/cuota.

function leerComoBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const resultado = reader.result as string;
            resolve(resultado.split(',')[1] ?? '');
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export const viaticoIaService = {
    /** US-VIA-00 CA1/CA2 — extrae datos de un formulario físico de viático vía Edge Function. */
    async extraerDatos(file: File): Promise<ExtraccionViaticoIA> {
        const imagenBase64 = await leerComoBase64(file);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });

        const invokePromise = supabase.functions.invoke('extraer-viatico-ia', {
            body: { imagen_base64: imagenBase64, mime_type: file.type },
        });

        const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Error desconocido al extraer datos.');
        return data.data as ExtraccionViaticoIA;
    },
};
