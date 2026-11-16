import { supabase } from '../config/supabaseClient';

// 'incapacidad' se sumó en IMPL-44 (US-INC-02) y 'anticipo' en IMPL-130/131 (Observación
// General UAT) — ambos reutilizan este mismo mecanismo de adjuntos en vez de duplicarlo.
export type TipoRegistroViatico = 'por_ruta' | 'fijos_variables' | 'kilometraje' | 'incapacidad' | 'anticipo';
export type OrigenDocumento = 'manual' | 'captura_ia';

export interface ViaticoDocumento {
    id: string;
    tenant_id: string;
    tipo_registro: TipoRegistroViatico;
    registro_id: string;
    storage_path: string;
    nombre_archivo: string;
    tamano_bytes: number | null;
    mime_type: string | null;
    origen: OrigenDocumento;
    uploaded_by: string | null;
    created_at: string;
}

const DOCUMENTOS_BUCKET = 'planilla_viatico_documentos';

export const viaticoDocumentosService = {
    /**
     * CA2/CA3 (múltiples adjuntos acumulables por registro, sin importar el tipo).
     */
    async getPorRegistro(tipoRegistro: TipoRegistroViatico, registroId: string): Promise<ViaticoDocumento[]> {
        const { data, error } = await supabase
            .from('planilla_viatico_documentos')
            .select('*')
            .eq('tipo_registro', tipoRegistro)
            .eq('registro_id', registroId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /**
     * US-VIA-06 CA3 (defecto UAT) — contador/indicador de adjuntos por registro para mostrar
     * en la vista de tabla sin N+1 consultas (el DEMO mostraba un thumbnail por fila).
     */
    async getPorRegistros(tipoRegistro: TipoRegistroViatico, registroIds: string[]): Promise<ViaticoDocumento[]> {
        if (registroIds.length === 0) return [];
        const { data, error } = await supabase
            .from('planilla_viatico_documentos')
            .select('*')
            .eq('tipo_registro', tipoRegistro)
            .in('registro_id', registroIds);
        if (error) throw error;
        return data || [];
    },

    /**
     * Sube el archivo al bucket privado y registra sus metadatos. Path:
     * {tenant_id}/{tipo_registro}/{registro_id}/{uuid}_{nombre_sanitizado} (exigido por la
     * RLS de storage) — mismo patrón que `planillaEmpleadosService.uploadDocumento`.
     */
    async subirDocumento(
        tenantId: string,
        tipoRegistro: TipoRegistroViatico,
        registroId: string,
        file: File,
        uploadedBy: string,
        origen: OrigenDocumento = 'manual'
    ): Promise<ViaticoDocumento> {
        const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `${tenantId}/${tipoRegistro}/${registroId}/${crypto.randomUUID()}_${sanitized}`;

        const { error: uploadError } = await supabase.storage
            .from(DOCUMENTOS_BUCKET)
            .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;

        const { data, error } = await supabase
            .from('planilla_viatico_documentos')
            .insert([{
                tenant_id: tenantId,
                tipo_registro: tipoRegistro,
                registro_id: registroId,
                storage_path: storagePath,
                nombre_archivo: file.name,
                tamano_bytes: file.size,
                mime_type: file.type,
                origen,
                uploaded_by: uploadedBy,
            }])
            .select()
            .single();

        if (error) {
            await supabase.storage.from(DOCUMENTOS_BUCKET).remove([storagePath]);
            throw error;
        }
        return data;
    },

    async getSignedUrl(storagePath: string): Promise<string> {
        const { data, error } = await supabase.storage
            .from(DOCUMENTOS_BUCKET)
            .createSignedUrl(storagePath, 60);
        if (error) throw error;
        return data.signedUrl;
    },

    async eliminarDocumento(documentoId: string, storagePath: string): Promise<void> {
        const { error: storageError } = await supabase.storage
            .from(DOCUMENTOS_BUCKET)
            .remove([storagePath]);
        if (storageError) throw storageError;

        const { error } = await supabase
            .from('planilla_viatico_documentos')
            .delete()
            .eq('id', documentoId);
        if (error) throw error;
    },
};
