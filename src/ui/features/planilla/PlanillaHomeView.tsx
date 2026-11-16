import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ClipboardList, CheckSquare, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { ROLES } from '../../../config/constants';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { PreparadorDashboardView } from './PreparadorDashboardView';
import { AprobadorDashboardView } from './AprobadorDashboardView';
import { NuevaQuincenaModal } from './components/NuevaQuincenaModal';
import { usePlanillaContext } from './PlanillaLayout';

type Tab = 'preparar' | 'aprobar';

/**
 * Punto de entrada de /planilla (US-QNA-00 / US-QNA-08 / US-QNA-09). Permisos reales del
 * perfil, no un selector de demostración. `admin` cuenta como "tiene ambos permisos" — el
 * propio Jira de US-QNA-09 usa "ej. Administrador" como ejemplo de usuario dual. Un
 * usuario con un solo permiso no ve pestañas (CA1): sigue exactamente como antes
 * (IMPL-10/18). Con ambos permisos, ve las dos pestañas y alterna libremente (CA2), con
 * "Preparar" por defecto y un badge en "Aprobar" cuando hay quincenas pendientes de
 * revisión (CA5).
 */
export const PlanillaHomeView: React.FC = () => {
    const { t } = useTranslation();
    // IMPL-125 — antes se decidía Preparador/Aprobador leyendo `profile` de forma síncrona,
    // sin esperar a que termine de cargar (authStore.isLoading arranca en `true`). Con `roles`
    // vacío por un instante, un Aprobador-only entraba a ver `<PreparadorDashboardView />`
    // hasta que el store terminaba de resolver el perfil — un parpadeo entre dashboards que se
    // sentía como "esto no termina de cargar bien".
    const { profile, isLoading: isLoadingAuth } = useAuthStore();
    // Reporte UAT: el selector de quincena del header no cambiaba nada en esta pantalla —
    // Preparador/Aprobador derivaban su propia quincena de forma independiente. Se hilvana acá
    // para que elegir otra quincena sí actualice los datos mostrados (ver comentario de cada
    // dashboard: las acciones reales siguen atadas SOLO a la quincena activa/pendiente real).
    const { quincenaId: quincenaSeleccionadaId } = usePlanillaContext();
    const roles = Array.isArray(profile?.roles) ? profile.roles : profile?.role ? [profile.role] : [];
    const esAdmin = roles.includes(ROLES.ADMIN);
    const puedePreparar = esAdmin || roles.includes(ROLES.PREPARADOR_PLANILLA);
    const puedeAprobar = esAdmin || roles.includes(ROLES.APROBADOR_PLANILLA);
    const tieneAmbosPermisos = puedePreparar && puedeAprobar;

    const [tab, setTab] = useState<Tab>('preparar');
    const [showNuevaQuincena, setShowNuevaQuincena] = useState(false);

    const { quincenas, fetchQuincenas } = useQuincenasStore(
        useShallow((state) => ({ quincenas: state.quincenas, fetchQuincenas: state.fetchQuincenas }))
    );
    useEffect(() => {
        if (tieneAmbosPermisos) fetchQuincenas();
    }, [tieneAmbosPermisos, fetchQuincenas]);
    const pendientesAprobacion = useMemo(
        () => quincenas.filter((q) => q.estado === 'enviada_aprobacion').length,
        [quincenas]
    );

    if (isLoadingAuth) {
        return <PageLoader fullPage label={t('common.loading')} />;
    }

    if (!tieneAmbosPermisos) {
        return (
            <>
                {puedeAprobar
                    ? <AprobadorDashboardView quincenaSeleccionadaId={quincenaSeleccionadaId} />
                    : <PreparadorDashboardView quincenaSeleccionadaId={quincenaSeleccionadaId} onNuevaQuincena={() => setShowNuevaQuincena(true)} />}
                {showNuevaQuincena && <NuevaQuincenaModal onClose={() => setShowNuevaQuincena(false)} />}
            </>
        );
    }

    return (
        <>
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-md flex items-center justify-between gap-sm">
                <div className="inline-flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
                    <button
                        onClick={() => setTab('preparar')}
                        className={`flex items-center gap-1.5 px-md py-xs rounded-md text-[13px] font-semibold transition-colors ${tab === 'preparar' ? 'bg-white text-heading shadow-sm border border-border/50' : 'text-text-secondary hover:text-heading'}`}
                    >
                        <ClipboardList size={14} /> {t('quincenas.tab_preparar')}
                    </button>
                    <button
                        onClick={() => setTab('aprobar')}
                        className={`relative flex items-center gap-1.5 px-md py-xs rounded-md text-[13px] font-semibold transition-colors ${tab === 'aprobar' ? 'bg-white text-heading shadow-sm border border-border/50' : 'text-text-secondary hover:text-heading'}`}
                    >
                        <CheckSquare size={14} /> {t('quincenas.tab_aprobar')}
                        {pendientesAprobacion > 0 && (
                            <span className="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-full bg-error text-white text-[10px] font-bold">
                                {pendientesAprobacion}
                            </span>
                        )}
                    </button>
                </div>
                <Button onClick={() => setShowNuevaQuincena(true)} className="flex items-center gap-2 shrink-0">
                    <Plus size={18} /> {t('quincenas.action_nueva_quincena')}
                </Button>
            </div>
            {tab === 'preparar'
                ? <PreparadorDashboardView quincenaSeleccionadaId={quincenaSeleccionadaId} onNuevaQuincena={() => setShowNuevaQuincena(true)} mostrarBotonNuevaQuincena={false} />
                : <AprobadorDashboardView quincenaSeleccionadaId={quincenaSeleccionadaId} />}
            {showNuevaQuincena && <NuevaQuincenaModal onClose={() => setShowNuevaQuincena(false)} />}
        </>
    );
};
