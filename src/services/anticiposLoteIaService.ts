import { supabase } from '../config/supabaseClient';

export interface ValeExtraidoLote {
    legible: boolean;
    motivo_no_legible?: string;
    numero_vale: string | null;
    nombre_completo: string | null;
    fecha: string | null;
    monto: number | null;
    concepto: string | null;
    confianza: number;
}

// Defecto real (2026-09-23, viáticos): confirmado con el Network tab del navegador + la tabla
// planilla_ia_invocaciones que el CUELLO DE BOTELLA real es la SUBIDA del archivo (base64) al
// servidor, no la generación de OpenAI — el servidor procesa en 20-36s (columna duracion_ms),
// pero en una conexión lenta el simple "Request sent" del Network tab tardó ~2 minutos. Se sube
// a 4 minutos, con margen de sobra sobre la subida más lenta observada + el procesamiento real.
const TIMEOUT_MS = 240000;

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

export const anticiposLoteIaService = {
    /** Importación por lote (Imporfrut confirmó que en la práctica entregan un solo documento
     * con varios vales/filas, no uno por persona) — extrae TODOS los vales visibles en el
     * archivo vía Edge Function. */
    async extraerLote(file: File): Promise<ValeExtraidoLote[]> {
        const imagenBase64 = await leerComoBase64(file);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });

        const invokePromise = supabase.functions.invoke('extraer-anticipos-lote-ia', {
            body: { imagen_base64: imagenBase64, mime_type: file.type },
        });

        const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Error desconocido al extraer datos.');
        return (data.data?.vales as ValeExtraidoLote[]) ?? [];
    },
};
