import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Pencil } from 'lucide-react';

import { useUbicacionesStore } from '../../../store/ubicacionesStore';
import { ImportacionMarcacionesSection } from './components/ImportacionMarcacionesSection';
import { CargaManualHorasSection } from './components/CargaManualHorasSection';
import { usePlanillaContext } from './PlanillaLayout';

/**
 * Módulo Horas Extras (IMPL-20), landing con un tab por ubicación (US-HEX-00 CA3). Cada tab
 * indica su modalidad de captura junto al nombre. Las ubicaciones con Reloj Marcador usan la
 * importación de archivo (US-HEX-02); las de modalidad Manual usan la carga manual (US-HEX-06).
 */
export const HorasExtrasView: React.FC = () => {
    const { t } = useTranslation();
    const { quincena, quincenaCerrada } = usePlanillaContext();
    const { ubicaciones, isLoading, fetchUbicaciones } = useUbicacionesStore();
    const [tabActivo, setTabActivo] = useState<string | null>(null);

    useEffect(() => { fetchUbicaciones(); }, [fetchUbicaciones]);

    const ubicacionesActivas = useMemo(() => ubicaciones.filter((u) => u.estado === 'activo'), [ubicaciones]);

    useEffect(() => {
        if (!tabActivo && ubicacionesActivas.length > 0) setTabActivo(ubicacionesActivas[0].id);
    }, [tabActivo, ubicacionesActivas]);

    const ubicacionActiva = ubicacionesActivas.find((u) => u.id === tabActivo);

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <div className="h-24 bg-surface rounded-lg animate-pulse" />
            ) : ubicacionesActivas.length === 0 ? (
                <div className="bg-white rounded-lg shadow-cards border border-border p-xl text-center">
                    <p className="text-body text-text-secondary">{t('horasExtras.sin_ubicaciones')}</p>
                </div>
            ) : (
                <>
                    <div className="flex gap-sm overflow-x-auto pb-1">
                        {ubicacionesActivas.map((u) => {
                            const activo = u.id === tabActivo;
                            const Icon = u.modalidad_captura === 'reloj_marcador' ? Clock : Pencil;
                            return (
                                <button
                                    key={u.id}
                                    onClick={() => setTabActivo(u.id)}
                                    className={`flex flex-col items-start gap-0.5 px-md py-sm rounded-lg border shrink-0 transition-colors ${activo ? 'bg-primary text-white border-primary shadow-cards' : 'bg-white text-heading border-border hover:bg-surface'}`}
                                >
                                    <span className="text-[13px] font-bold">{u.nombre}</span>
                                    <span className={`flex items-center gap-1 text-[10px] ${activo ? 'text-white/80' : 'text-text-secondary'}`}>
                                        <Icon size={10} />
                                        {u.modalidad_captura === 'reloj_marcador' ? t('horasExtras.modalidad_reloj_marcador') : t('horasExtras.modalidad_manual')}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {ubicacionActiva && (
                        ubicacionActiva.modalidad_captura === 'reloj_marcador' ? (
                            <ImportacionMarcacionesSection key={ubicacionActiva.id} ubicacionId={ubicacionActiva.id} ubicacionNombre={ubicacionActiva.nombre} quincena={quincena} quincenaCerrada={quincenaCerrada} />
                        ) : (
                            <CargaManualHorasSection key={ubicacionActiva.id} ubicacionId={ubicacionActiva.id} ubicacionNombre={ubicacionActiva.nombre} quincena={quincena} quincenaCerrada={quincenaCerrada} />
                        )
                    )}
                </>
            )}
        </div>
    );
};
