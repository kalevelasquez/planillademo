import { supabase } from '../config/supabaseClient';
import type { SectorEconomico } from '../utils/liquidacionLaboralUtils';

export interface ConfigEmpresa {
    id: string;
    tenant_id: string;
    razon_social: string;
    nit: string;
    direccion_fiscal: string;
    telefono: string;
    /** IMPL-161 CA1 — determina el tope de Indemnización (4× salario mínimo diario del sector).
     * `null` hasta que se configure explícitamente — nunca se asume un sector por defecto. */
    sector_economico: SectorEconomico | null;
    /** IMPL-99, columna 2 de la Planilla Única ISSS/AFP. `null` hasta que se capture. */
    numero_patronal_isss: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface GuardarConfigEmpresaPayload {
    razonSocial: string;
    nit: string;
    direccionFiscal: string;
    telefono: string;
    sectorEconomico: SectorEconomico | null;
    numeroPatronalIsss: string | null;
}

export const empresaConfigService = {
    /** Una fila por tenant como mucho — null si todavía no hay configuración. */
    async getConfig(): Promise<ConfigEmpresa | null> {
        const { data, error } = await supabase
            .from('planilla_config_empresa')
            .select('*')
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    async guardarConfig(tenantId: string, payload: GuardarConfigEmpresaPayload, updatedBy: string): Promise<ConfigEmpresa> {
        const { data, error } = await supabase
            .from('planilla_config_empresa')
            .upsert(
                [{
                    tenant_id: tenantId,
                    razon_social: payload.razonSocial,
                    nit: payload.nit,
                    direccion_fiscal: payload.direccionFiscal,
                    telefono: payload.telefono,
                    sector_economico: payload.sectorEconomico,
                    numero_patronal_isss: payload.numeroPatronalIsss,
                    updated_by: updatedBy,
                }],
                { onConflict: 'tenant_id' },
            )
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
