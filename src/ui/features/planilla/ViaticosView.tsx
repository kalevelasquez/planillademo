import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Repeat, Gauge, CheckCircle2, PackageOpen, Plus, Loader2 } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { modulosQuincenaService } from '../../../services/modulosQuincenaService';
import { Logger } from '../../../utils/logger';
import { PorRutaSection, type PorRutaSectionHandle } from './components/PorRutaSection';
import { FijosVariablesSection, type FijosVariablesSectionHandle } from './components/FijosVariablesSection';
import { KilometrajeSection, type KilometrajeSectionHandle } from './components/KilometrajeSection';

type TabViaticos = 'por_ruta' | 'fijos_variables' | 'kilometraje';

/**
 * Módulo Viáticos (IMPL-30), landing con tabs por tipo de registro (no por ubicación, a
 * diferencia de Horas Extras — ninguna de las 10 historias de esta épica menciona
 * ubicaciones). La quincena se selecciona una vez acá y se comparte entre tabs, porque todas
 * operan sobre el mismo período. "Confirmar Viáticos" (revisión épica por épica, post-IMPL-35)
 * vive acá y no en un tab individual porque `quincena_modulo_estado` trackea 'viaticos' como
 * una sola fila para los 3 tipos juntos (Por Ruta/Fijos y Variables/Kilometraje) — mismo
 * patrón "sin indicador visual, confirma a ciegas" que ya usan Anticipos/Descuentos.
 */
export const ViaticosView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { quincenaId, quincena: quincenaSeleccionada, quincenaCerrada } = usePlanillaContext();

    const [tabActivo, setTabActivo] = useState<TabViaticos>('por_ruta');
    const [isConfirmando, setIsConfirmando] = useState(false);

    const porRutaRef = useRef<PorRutaSectionHandle>(null);
    const fijosVariablesRef = useRef<FijosVariablesSectionHandle>(null);
    const kilometrajeRef = useRef<KilometrajeSectionHandle>(null);

    // Los botones de agregar viven al nivel de "Confirmar Viáticos" (mismo header), no dentro
    // de cada sección — cada Section expone su apertura de modal vía ref para que el trigger
    // pueda quedar acá sin duplicar el estado del modal en cada una.
    const handleAgregar = () => {
        if (tabActivo === 'por_ruta') porRutaRef.current?.abrirAlta();
        else if (tabActivo === 'fijos_variables') fijosVariablesRef.current?.abrirAlta();
        else kilometrajeRef.current?.abrirAlta();
    };

    const handleImportarLote = () => {
        if (tabActivo === 'por_ruta') porRutaRef.current?.abrirLote();
        else if (tabActivo === 'fijos_variables') fijosVariablesRef.current?.abrirLote();
        else kilometrajeRef.current?.abrirLote();
    };

    const handleConfirmarViaticos = async () => {
        if (!quincenaId || !profile?.tenant_id || !profile.id) return;
        setIsConfirmando(true);
        try {
            await modulosQuincenaService.confirmarModuloConDatos(profile.tenant_id, quincenaId, 'viaticos', profile.id);
            showToast(t('viaticos.toast_confirmado'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al confirmar módulo de viáticos', { quincenaId }, err);
            showToast(t('viaticos.error_confirmar'), 'error');
        } finally {
            setIsConfirmando(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex gap-sm">
                    {([
                        { key: 'por_ruta' as const, label: t('viaticos.tab_por_ruta'), Icon: Route },
                        { key: 'fijos_variables' as const, label: t('viaticos.tab_fijos_variables'), Icon: Repeat },
                        { key: 'kilometraje' as const, label: t('viaticos.tab_kilometraje'), Icon: Gauge },
                    ]).map(({ key, label, Icon }) => (
                        <button
                            key={key}
                            onClick={() => setTabActivo(key)}
                            className={`flex items-center gap-1.5 px-md py-sm rounded-lg border shrink-0 text-[13px] font-bold transition-colors ${tabActivo === key ? 'bg-primary text-white border-primary shadow-cards' : 'bg-white text-heading border-border hover:bg-surface'}`}
                        >
                            <Icon size={14} /> {label}
                        </button>
                    ))}
                </div>

                {quincenaId && !quincenaCerrada && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleConfirmarViaticos}
                            disabled={isConfirmando}
                            className="flex items-center gap-xs px-md py-sm border border-border rounded-lg text-[13px] font-semibold text-text-secondary hover:bg-surface transition-colors disabled:opacity-60 shrink-0"
                        >
                            {isConfirmando ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                            {t('viaticos.action_confirmar_viaticos')}
                        </button>
                        <button
                            type="button"
                            onClick={handleImportarLote}
                            className="flex items-center gap-xs px-md py-sm border border-border rounded-lg text-[13px] font-semibold text-text-secondary hover:bg-surface transition-colors shrink-0"
                        >
                            <PackageOpen size={15} /> {t('viaticos.action_lote')}
                        </button>
                        <button
                            type="button"
                            onClick={handleAgregar}
                            className="flex items-center gap-xs px-md py-sm bg-primary text-white rounded-lg text-[13px] font-semibold hover:bg-primary-dark transition-colors shadow-cards shrink-0"
                        >
                            <Plus size={15} /> {t('viaticos.action_agregar')}
                        </button>
                    </div>
                )}
            </div>

            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                {!quincenaId ? (
                    <p className="text-caption text-text-secondary italic">{t('viaticos.sin_quincenas')}</p>
                ) : tabActivo === 'por_ruta' ? (
                    <PorRutaSection
                        key={quincenaId}
                        ref={porRutaRef}
                        quincenaId={quincenaId}
                        quincenaFechaInicio={quincenaSeleccionada?.fecha_inicio}
                        quincenaFechaFin={quincenaSeleccionada?.fecha_fin}
                    />
                ) : tabActivo === 'fijos_variables' ? (
                    <FijosVariablesSection key={quincenaId} ref={fijosVariablesRef} quincenaId={quincenaId} />
                ) : (
                    <KilometrajeSection
                        key={quincenaId}
                        ref={kilometrajeRef}
                        quincenaId={quincenaId}
                        quincenaFechaInicio={quincenaSeleccionada?.fecha_inicio}
                        quincenaFechaFin={quincenaSeleccionada?.fecha_fin}
                    />
                )}
            </section>
        </div>
    );
};
