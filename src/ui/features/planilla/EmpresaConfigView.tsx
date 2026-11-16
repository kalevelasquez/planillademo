import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../../store/authStore';
import { ROLES } from '../../../config/constants';
import { empresaConfigService } from '../../../services/empresaConfigService';
import type { SectorEconomico } from '../../../utils/liquidacionLaboralUtils';
import { InputField } from '../../components/InputField';
import { SelectField } from '../../components/SelectField';
import { ReadOnlyField } from '../../components/ReadOnlyField';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Empresa (US-EXP-12, IMPL-168). Igual que Lavado y Gasolina, es un único
 * registro por tenant — no hay alta/baja, solo editar y guardar. A diferencia de los demás
 * catálogos de Configuración (admin-only), esta pantalla es de lectura para Preparador/Aprobador
 * (la usan los reportes legales/fiscales que ellos mismos generan) y de edición solo para Admin.
 */
export const EmpresaConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const esAdmin = profile?.role === ROLES.ADMIN;

    const [razonSocial, setRazonSocial] = useState('');
    const [nit, setNit] = useState('');
    const [direccionFiscal, setDireccionFiscal] = useState('');
    const [telefono, setTelefono] = useState('');
    const [sectorEconomico, setSectorEconomico] = useState<SectorEconomico | ''>('');
    const [numeroPatronalIsss, setNumeroPatronalIsss] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const opcionesSectorEconomico = [
        { value: 'comercio_servicios_industria', label: t('empresa.sector_comercio_servicios_industria') },
        { value: 'maquila_textil', label: t('empresa.sector_maquila_textil') },
        { value: 'beneficio_cafe_cana', label: t('empresa.sector_beneficio_cafe_cana') },
        { value: 'agropecuario_pesca', label: t('empresa.sector_agropecuario_pesca') },
    ];

    useEffect(() => {
        empresaConfigService.getConfig()
            .then((config) => {
                if (!config) return;
                setRazonSocial(config.razon_social);
                setNit(config.nit);
                setDireccionFiscal(config.direccion_fiscal);
                setTelefono(config.telefono);
                setSectorEconomico(config.sector_economico ?? '');
                setNumeroPatronalIsss(config.numero_patronal_isss ?? '');
            })
            .catch((err: unknown) => Logger.error('Error al cargar configuración de empresa', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id) return;
        if (!razonSocial.trim() || !nit.trim() || !direccionFiscal.trim() || !telefono.trim()) {
            setError(t('empresa.error_campos_requeridos'));
            return;
        }
        setError(null);
        setIsSaving(true);
        try {
            await empresaConfigService.guardarConfig(
                profile.tenant_id,
                {
                    razonSocial: razonSocial.trim(), nit: nit.trim(), direccionFiscal: direccionFiscal.trim(), telefono: telefono.trim(),
                    sectorEconomico: sectorEconomico || null,
                    numeroPatronalIsss: numeroPatronalIsss.trim() || null,
                },
                profile.id,
            );
            showToast(t('empresa.guardado_ok'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al guardar configuración de empresa', {}, err);
            setError(t('empresa.error_guardar'));
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <PageLoader label={t('common.loading')} />;

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg w-full max-w-2xl">
                <p className="text-caption text-text-secondary">{t('empresa.config_desc')}</p>
                <form onSubmit={handleSave} className="flex flex-col gap-md">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
                        {esAdmin ? (
                            <>
                                <InputField label={t('empresa.field_razon_social')} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} className="sm:col-span-2" />
                                <InputField label={t('empresa.field_nit')} value={nit} onChange={(e) => setNit(e.target.value)} />
                                <InputField label={t('empresa.field_telefono')} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                                <InputField label={t('empresa.field_direccion_fiscal')} value={direccionFiscal} onChange={(e) => setDireccionFiscal(e.target.value)} className="sm:col-span-2" />
                                <SelectField
                                    label={t('empresa.field_sector_economico')}
                                    options={opcionesSectorEconomico}
                                    value={sectorEconomico}
                                    onChange={(e) => setSectorEconomico(e.target.value as SectorEconomico)}
                                    className="sm:col-span-2"
                                />
                                <InputField
                                    label={t('empresa.field_numero_patronal_isss')}
                                    value={numeroPatronalIsss}
                                    onChange={(e) => setNumeroPatronalIsss(e.target.value)}
                                    className="sm:col-span-2"
                                />
                            </>
                        ) : (
                            <>
                                <ReadOnlyField label={t('empresa.field_razon_social')} value={razonSocial} className="sm:col-span-2" />
                                <ReadOnlyField label={t('empresa.field_nit')} value={nit} />
                                <ReadOnlyField label={t('empresa.field_telefono')} value={telefono} />
                                <ReadOnlyField label={t('empresa.field_direccion_fiscal')} value={direccionFiscal} className="sm:col-span-2" />
                                <ReadOnlyField
                                    label={t('empresa.field_sector_economico')}
                                    value={opcionesSectorEconomico.find((o) => o.value === sectorEconomico)?.label ?? ''}
                                    className="sm:col-span-2"
                                />
                                <ReadOnlyField label={t('empresa.field_numero_patronal_isss')} value={numeroPatronalIsss} className="sm:col-span-2" />
                            </>
                        )}
                    </div>
                    {error && <p className="text-caption text-error">{error}</p>}
                    {esAdmin && (
                        <Button type="submit" isLoading={isSaving} className="self-start">
                            {t('common.save')}
                        </Button>
                    )}
                </form>
            </section>
        </div>
    );
};
