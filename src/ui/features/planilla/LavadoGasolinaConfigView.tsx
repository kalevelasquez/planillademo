import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../../store/authStore';
import { lavadoGasolinaConfigService } from '../../../services/lavadoGasolinaConfigService';
import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Monto de Lavado y Gasolina (US-VIA-05 CA4). A diferencia de los demás
 * catálogos de esta sección (listas de N filas), este es un único valor por tenant — no hay
 * alta/baja, solo editar y guardar.
 */
export const LavadoGasolinaConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [monto, setMonto] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        lavadoGasolinaConfigService.getConfig()
            .then((config) => setMonto(config ? String(config.monto) : ''))
            .catch((err: unknown) => Logger.error('Error al cargar config de lavado y gasolina', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id) return;
        if (!monto || Number(monto) < 0) { setError(t('viaticos.error_campos_requeridos')); return; }
        setError(null);
        setIsSaving(true);
        try {
            await lavadoGasolinaConfigService.guardarMonto(profile.tenant_id, Number(monto), profile.id);
            showToast(t('viaticos.lavado_gasolina_config_guardado'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al guardar config de lavado y gasolina', {}, err);
            setError(t('viaticos.error_guardar'));
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <PageLoader label={t('common.loading')} />;

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg w-full max-w-96">
                <p className="text-caption text-text-secondary">{t('viaticos.lavado_gasolina_config_desc')}</p>
                <form onSubmit={handleSave} className="flex flex-col gap-md">
                    <InputField
                        label={t('viaticos.field_monto')}
                        type="number"
                        min={0}
                        step="0.01"
                        value={monto}
                        onChange={(e) => setMonto(e.target.value)}
                    />
                    {error && <p className="text-caption text-error">{error}</p>}
                    <Button type="submit" isLoading={isSaving} className="self-start">
                        {t('common.save')}
                    </Button>
                </form>
            </section>
        </div>
    );
};
