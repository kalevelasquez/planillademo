import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarOff } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { modulosQuincenaService } from '../../../../services/modulosQuincenaService';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { Logger } from '../../../../utils/logger';

interface BotonSinHorasExtraUbicacionProps {
    quincenaId: string;
    ubicacionId: string;
    disabled?: boolean;
    /** El caller es dueño de su propio `ubicacionEstado` local — este componente solo dispara
     * el RPC y avisa cuándo terminó, sin manejar el estado de la ubicación por sí mismo. */
    onConfirmado: () => void;
}

/**
 * "Sin horas extra esta ubicación" (IMPL-16 US-QNA-06 CA2, corrección de septiembre 2026) —
 * escape POR UBICACIÓN, análogo al botón "Sin registros este período" que ya usan Viáticos/
 * Incapacidades/Vacaciones/Bonificaciones a nivel de módulo completo (ver
 * `ModulosChecklistSection.tsx`). Componente compartido entre `ImportacionMarcacionesSection`
 * y `CargaManualHorasSection` para no duplicar el modal de confirmación entre ambos.
 */
export const BotonSinHorasExtraUbicacion: React.FC<BotonSinHorasExtraUbicacionProps> = ({ quincenaId, ubicacionId, disabled, onConfirmado }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const [showConfirm, setShowConfirm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirmar = async () => {
        if (!profile?.id) return;
        setIsSubmitting(true);
        try {
            await modulosQuincenaService.marcarUbicacionSinRegistros(quincenaId, ubicacionId, 'horas_extras', profile.id);
            setShowConfirm(false);
            onConfirmado();
        } catch (err: unknown) {
            Logger.error('Error al marcar ubicación sin horas extra', { quincenaId, ubicacionId }, err);
            setError(t('horasExtras.error_sin_horas_extra'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={disabled}
                className="self-end flex items-center gap-2 px-md py-2 text-caption font-semibold text-text-secondary hover:text-heading disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                <CalendarOff size={14} /> {t('horasExtras.action_sin_horas_extra_ubicacion')}
            </button>

            <ConfirmModal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                onConfirm={handleConfirmar}
                title={t('horasExtras.sin_horas_extra_confirm_title')}
                message={t('horasExtras.sin_horas_extra_confirm_message')}
                confirmLabel={t('horasExtras.action_confirmar')}
                cancelLabel={t('permisos.action_cancelar')}
                variant="warning"
                Icon={CalendarOff}
                isLoading={isSubmitting}
            />
            {error && <p className="text-caption text-error mt-1">{error}</p>}
        </>
    );
};
