import { supabase } from '../config/supabaseClient';

export interface ViaticoExtraidoLote {
    legible: boolean;
    motivo_no_legible?: string;
    nombre_completo: string | null;
    codigo_empleado: string | null;
    fecha: string | null;
    cargo_motivo: string | null;
    destino: string | null;
    monto: number | null;
    confianza: number;
}

// Defecto real (2026-09-23): confirmado con el Network tab del navegador + la tabla
// planilla_ia_invocaciones que el CUELLO DE BOTELLA real es la SUBIDA del archivo (base64) al
// servidor, no la generación de OpenAI — el servidor procesa en 20-36s (columna duracion_ms),
// pero en una conexión lenta el simple "Request sent" del Network tab tardó ~2 minutos. 90s no
// alcanzaba a cubrir eso. Se sube a 4 minutos, con margen de sobra sobre la subida más lenta
// observada + el procesamiento real del servidor.
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

export const viaticosLoteIaService = {
    /** Importación por lote de Viáticos por Ruta — mismo pedido de UAT que ya resolvió
     * anticiposLoteIaService (Imporfrut entrega un solo "Control de Viáticos" con varias
     * filas/empleados, no un formulario por persona). A diferencia de la extracción individual
     * (viaticoIaService, que nunca extrae monto), esta SÍ extrae monto por fila — decisión
     * explícita para el lote, ver comentario en la Edge Function. */
    async extraerLote(file: File): Promise<ViaticoExtraidoLote[]> {
        const imagenBase64 = await leerComoBase64(file);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });

        const invokePromise = supabase.functions.invoke('extraer-viaticos-lote-ia', {
            body: { imagen_base64: imagenBase64, mime_type: file.type },
        });

        const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Error desconocido al extraer datos.');
        return (data.data?.registros as ViaticoExtraidoLote[]) ?? [];
    },
};
