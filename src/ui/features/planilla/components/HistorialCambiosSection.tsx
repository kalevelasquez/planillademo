import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, FileX } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { auditService, type AuditEntry } from '../../../../services/auditService';
import type { DocumentoTipo } from '../../../../services/planillaEmpleadosService';
import { Badge, type BadgeVariant } from '../../../components/Badge';
import { maskValue } from '../../../components/SensitiveField';
import { Logger } from '../../../../utils/logger';

interface HistorialCambiosSectionProps {
    empleadoId: string;
}

type Categoria = 'personal' | 'cargo' | 'remuneracion' | 'administrativo';

// Solo los campos editables desde el formulario — se ignoran columnas internas
// (id, tenant_id, codigo, created_at, updated_at, deleted_at, foto_url).
const FIELD_CATEGORY: Record<string, Categoria> = {
    codigo_empleado_manual: 'personal',
    nombre_completo: 'personal', dui: 'personal', nit: 'personal', nup: 'personal',
    fecha_nacimiento: 'personal', sexo: 'personal', telefono: 'personal', correo: 'personal',
    direccion: 'personal', contacto_emergencia_nombre: 'personal', contacto_emergencia_telefono: 'personal',
    cargo: 'cargo', departamento: 'cargo', sucursal: 'cargo', centro_costos: 'cargo',
    fecha_ingreso: 'cargo', tipo_contrato: 'cargo', estado: 'cargo',
    sueldo_mensual: 'remuneracion', tipo_afiliacion: 'remuneracion', retencion_especial_viatico: 'remuneracion',
    es_gerente_general: 'remuneracion',
    banco: 'administrativo', numero_cuenta: 'administrativo',
};

type FieldLabelKey =
    | 'field_codigo_empleado'
    | 'field_nombre' | 'field_dui' | 'field_nit' | 'field_nup' | 'field_fecha_nacimiento' | 'field_sexo'
    | 'field_telefono' | 'field_correo' | 'field_direccion' | 'field_contacto_emergencia_nombre'
    | 'field_contacto_emergencia_telefono' | 'field_cargo' | 'field_departamento' | 'field_sucursal'
    | 'field_centro_costos' | 'field_fecha_ingreso' | 'field_tipo_contrato' | 'field_estado' | 'field_sueldo'
    | 'field_tipo_afiliacion' | 'field_retencion_especial' | 'field_es_gerente_general' | 'field_banco' | 'field_numero_cuenta';

const FIELD_LABEL_KEY: Record<string, FieldLabelKey> = {
    codigo_empleado_manual: 'field_codigo_empleado',
    nombre_completo: 'field_nombre', dui: 'field_dui', nit: 'field_nit', nup: 'field_nup',
    fecha_nacimiento: 'field_fecha_nacimiento', sexo: 'field_sexo', telefono: 'field_telefono',
    correo: 'field_correo', direccion: 'field_direccion',
    contacto_emergencia_nombre: 'field_contacto_emergencia_nombre',
    contacto_emergencia_telefono: 'field_contacto_emergencia_telefono',
    cargo: 'field_cargo', departamento: 'field_departamento', sucursal: 'field_sucursal',
    centro_costos: 'field_centro_costos', fecha_ingreso: 'field_fecha_ingreso',
    tipo_contrato: 'field_tipo_contrato', estado: 'field_estado',
    sueldo_mensual: 'field_sueldo', tipo_afiliacion: 'field_tipo_afiliacion',
    retencion_especial_viatico: 'field_retencion_especial', es_gerente_general: 'field_es_gerente_general',
    banco: 'field_banco', numero_cuenta: 'field_numero_cuenta',
};

const CATEGORIA_VARIANT: Record<Categoria, BadgeVariant> = {
    personal: 'info',
    cargo: 'warning',
    remuneracion: 'success',
    administrativo: 'accent',
};

// DUI/NIT/cuenta se muestran enmascarados también acá — el historial de cambios no debe
// filtrar datos sensibles sin pasar por el mecanismo de revelado auditado (US-EMP-01 CA2).
const MASKED_FIELDS = new Set(['dui', 'nit', 'numero_cuenta']);

interface CambioDetectado {
    field: string;
    before: string;
    after: string;
}

function formatValor(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (MASKED_FIELDS.has(field)) return maskValue(String(value), field === 'numero_cuenta' ? 4 : 2);
    if (field === 'retencion_especial_viatico' || field === 'es_gerente_general') return value ? 'Sí' : 'No';
    if (field === 'sueldo_mensual') return `$${Number(value).toLocaleString('es-SV', { minimumFractionDigits: 2 })}`;
    if (field === 'fecha_nacimiento' || field === 'fecha_ingreso') {
        return new Date(`${value}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return String(value);
}

function diffEntry(entry: AuditEntry): CambioDetectado[] {
    if (!entry.old_values || !entry.new_values) return [];
    const cambios: CambioDetectado[] = [];
    for (const field of Object.keys(FIELD_LABEL_KEY)) {
        const before = entry.old_values[field];
        const after = entry.new_values[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
            cambios.push({ field, before: formatValor(field, before), after: formatValor(field, after) });
        }
    }
    return cambios;
}

type EntradaHistorial =
    | { tipo: 'cambio'; id: string; createdAt: string; userEmail: string | null; cambios: CambioDetectado[] }
    | { tipo: 'documento_eliminado'; id: string; createdAt: string; userEmail: string | null; nombreArchivo: string; documentoTipo: DocumentoTipo | null };

/**
 * Historial de Cambios del Perfil (US-EMP-06 / IMPL-8). CA3: es una consulta de solo lectura
 * sobre audit_log (vía auditService.getResourceHistory, ya existente), no una tabla propia.
 *
 * IMPL-125: la eliminación de un documento adjunto (US-EMP-04/IMPL-6 CA4) vive en su propia
 * tabla auditada (`planilla_empleado_documentos`, resource_id = id del documento, no del
 * empleado) — getResourceHistory nunca la trae. Se consulta aparte vía
 * getDocumentosEliminados y se mezcla en la misma línea de tiempo.
 */
export const HistorialCambiosSection: React.FC<HistorialCambiosSectionProps> = ({ empleadoId }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const [entradas, setEntradas] = useState<EntradaHistorial[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!profile?.tenant_id) return;
        setIsLoading(true);
        Promise.all([
            auditService.getResourceHistory(profile.tenant_id, 'planilla_empleados', empleadoId),
            auditService.getDocumentosEliminados(profile.tenant_id, empleadoId),
        ])
            .then(([cambiosPerfil, documentosEliminados]) => {
                const cambios: EntradaHistorial[] = cambiosPerfil
                    .filter((e) => e.action === 'UPDATE')
                    .map((entry) => ({ entry, cambios: diffEntry(entry) }))
                    .filter(({ cambios }) => cambios.length > 0)
                    .map(({ entry, cambios }) => ({
                        tipo: 'cambio' as const,
                        id: entry.id,
                        createdAt: entry.created_at,
                        userEmail: entry.user_email,
                        cambios,
                    }));

                const eliminados: EntradaHistorial[] = documentosEliminados.map((entry) => ({
                    tipo: 'documento_eliminado' as const,
                    id: entry.id,
                    createdAt: entry.created_at,
                    userEmail: entry.user_email,
                    nombreArchivo: entry.old_values?.nombre_archivo ?? '—',
                    documentoTipo: (entry.old_values?.tipo as DocumentoTipo | undefined) ?? null,
                }));

                setEntradas([...cambios, ...eliminados].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
            })
            .catch((err: unknown) => Logger.error('Error al cargar historial de cambios', { empleadoId }, err))
            .finally(() => setIsLoading(false));
    }, [empleadoId, profile?.tenant_id]);

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <History size={14} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_historial')}</h3>
            </div>

            {isLoading ? (
                <div className="h-4 bg-surface rounded w-1/3 animate-pulse" />
            ) : entradas.length === 0 ? (
                <p className="text-caption text-text-secondary italic">{t('empleados.historial_empty')}</p>
            ) : (
                <div className="flex flex-col relative">
                    <div className="absolute left-5 top-5 bottom-5 w-px bg-border" />
                    {entradas.map((entrada) => (
                        <div key={entrada.id} className="flex gap-3 pb-4 relative last:pb-0">
                            <div className="w-10 h-10 rounded-full bg-white border-2 border-border flex items-center justify-center shrink-0 z-10 shadow-cards">
                                {entrada.tipo === 'documento_eliminado'
                                    ? <FileX size={16} className="text-error" />
                                    : <History size={16} className="text-text-secondary" />}
                            </div>
                            <div className="flex-1 min-w-0 bg-white rounded-xl border border-border shadow-cards p-3 flex flex-col gap-2">
                                <div className="flex items-center justify-between text-[11px] text-text-secondary">
                                    <span>{entrada.userEmail || t('empleados.historial_usuario_desconocido')}</span>
                                    <span>{new Date(entrada.createdAt).toLocaleString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                {entrada.tipo === 'cambio' ? (
                                    <div className="flex flex-col gap-1.5">
                                        {entrada.cambios.map((c) => (
                                            <div key={c.field} className="flex flex-wrap items-center gap-2 text-sm">
                                                <Badge variant={CATEGORIA_VARIANT[FIELD_CATEGORY[c.field]]} label={t(`empleados.historial_cat_${FIELD_CATEGORY[c.field]}`)} />
                                                <span className="font-semibold text-heading">{t(`empleados.${FIELD_LABEL_KEY[c.field]}`)}:</span>
                                                <span className="text-text-secondary line-through">{c.before}</span>
                                                <span className="text-text-secondary">→</span>
                                                <span className="text-heading font-medium">{c.after}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <Badge variant="error" label={t('empleados.historial_cat_documentos')} />
                                        <FileX size={14} className="text-error shrink-0" />
                                        <span className="text-heading font-medium">
                                            {t('empleados.historial_documento_eliminado', {
                                                nombre: entrada.nombreArchivo,
                                                tipo: entrada.documentoTipo ? t(`empleados.documento_tipo_${entrada.documentoTipo}`) : '',
                                            })}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};
