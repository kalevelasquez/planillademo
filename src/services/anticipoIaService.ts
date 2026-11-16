import { supabase } from '../config/supabaseClient';

export interface ExtraccionAnticipoIA {
    legible: boolean;
    motivo_no_legible?: string;
    numero_vale: string | null;
    nombre_completo: string | null;
    codigo_empleado: string | null;
    fecha: string | null;
    monto: number | null;
    confianza: number;
}

const TIMEOUT_MS = 30000; // CA2 (implícito, mismo criterio que Viáticos) — el cliente reacciona
// a los 30s pase lo que pase, aunque el servidor también tenga su propio timeout (~25s).

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

export const anticipoIaService = {
    /** US-ANT-01 (IMPL-50) CA1 — extrae datos de un vale de anticipo vía Edge Function. */
    async extraerDatos(file: File): Promise<ExtraccionAnticipoIA> {
        const imagenBase64 = await leerComoBase64(file);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });

        const invokePromise = supabase.functions.invoke('extraer-anticipo-ia', {
            body: { imagen_base64: imagenBase64, mime_type: file.type },
        });

        const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Error desconocido al extraer datos.');
        return data.data as ExtraccionAnticipoIA;
    },
};
