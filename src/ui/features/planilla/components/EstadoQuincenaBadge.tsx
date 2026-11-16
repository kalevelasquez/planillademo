import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Send, CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import type { EstadoQuincenaVisual } from '../../../../services/quincenasService';

/**
 * Colores/ícono de los estados visuales de la quincena (US-QNA-02 CA1 + IMPL-102). El
 * valor 'rechazada' NO es un valor real de la columna `estado` en BD — es derivado
 * client-side por quincenasService.getEstadoVisual, ver esa función para el detalle de
 * por qué Rechazo/Reapertura comparten el valor real 'en_proceso'.
 */
type EstadoLabelKey =
    | 'quincenas.estado_en_proceso' | 'quincenas.estado_enviada_aprobacion' | 'quincenas.estado_aprobada_cerrada'
    | 'quincenas.estado_reabierta' | 'quincenas.estado_rechazada';

export const ESTADO_QUINCENA_STYLE: Record<EstadoQuincenaVisual, { labelKey: EstadoLabelKey; className: string; classNameDark: string; icon: typeof Clock }> = {
    en_proceso: { labelKey: 'quincenas.estado_en_proceso', className: 'bg-blue-50 text-blue-600', classNameDark: 'bg-white/20 text-white border border-white/30', icon: Clock },
    enviada_aprobacion: { labelKey: 'quincenas.estado_enviada_aprobacion', className: 'bg-amber-50 text-amber-600', classNameDark: 'bg-amber-400/20 text-amber-200 border border-amber-300/40', icon: Send },
    aprobada_cerrada: { labelKey: 'quincenas.estado_aprobada_cerrada', className: 'bg-emerald-600 text-white', classNameDark: 'bg-green-400/20 text-green-200 border border-green-300/40', icon: CheckCircle2 },
    reabierta: { labelKey: 'quincenas.estado_reabierta', className: 'bg-orange-50 text-orange-600', classNameDark: 'bg-orange-400/20 text-orange-200 border border-orange-300/40', icon: RotateCcw },
    rechazada: { labelKey: 'quincenas.estado_rechazada', className: 'bg-red-50 text-red-600', classNameDark: 'bg-red-400/20 text-red-200 border border-red-300/40', icon: XCircle },
};

interface EstadoQuincenaBadgeProps {
    estado: EstadoQuincenaVisual;
    className?: string;
    /** 'dark' para usar sobre fondos oscuros (ej. la tarjeta hero navy de Preparador/Aprobador) — pill semi-transparente con texto claro en vez del fondo pastel por defecto. */
    variant?: 'light' | 'dark';
}

export const EstadoQuincenaBadge: React.FC<EstadoQuincenaBadgeProps> = ({ estado, className = '', variant = 'light' }) => {
    const { t } = useTranslation();
    const config = ESTADO_QUINCENA_STYLE[estado];
    const Icon = config.icon;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide rounded-full ${variant === 'dark' ? config.classNameDark : config.className} ${className}`}>
            <Icon size={12} />
            {t(config.labelKey)}
        </span>
    );
};
