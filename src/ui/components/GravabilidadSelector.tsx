import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Gravabilidad } from '../../services/otrosIngresosConceptosService';

interface GravabilidadSelectorProps {
    value: Gravabilidad;
    onChange: (value: Gravabilidad) => void;
}

const OPCIONES: {
    value: Gravabilidad;
    labelKey: 'otrosIngresos.gravabilidad_gravable' | 'otrosIngresos.gravabilidad_no_gravable' | 'otrosIngresos.gravabilidad_bono_10';
    tagKey: 'otrosIngresos.gravabilidad_tag_gravable' | 'otrosIngresos.gravabilidad_tag_no_gravable' | 'otrosIngresos.gravabilidad_tag_bono_10';
}[] = [
    { value: 'gravable', labelKey: 'otrosIngresos.gravabilidad_gravable', tagKey: 'otrosIngresos.gravabilidad_tag_gravable' },
    { value: 'no_gravable', labelKey: 'otrosIngresos.gravabilidad_no_gravable', tagKey: 'otrosIngresos.gravabilidad_tag_no_gravable' },
    { value: 'bono_10', labelKey: 'otrosIngresos.gravabilidad_bono_10', tagKey: 'otrosIngresos.gravabilidad_tag_bono_10' },
];

/**
 * Selector de tratamiento fiscal de 3 estados (US-OTR-01 CA2, IMPL-78) — reemplaza el toggle
 * binario "¿Es gravable?" anterior. Reutilizado tal cual por US-BON-03 (CA2 de IMPL-75, "mismas
 * 3 opciones que US-OTR-01") y ya usado por Vacaciones (no_gozada) e Incapacidades (trabajo
 * durante incapacidad) para su propio Bono 10%, aunque esos dos NO pasan por este componente
 * todavía — guardan su propio booleano en su tabla (ver gap documentado en planilla-contexto.md).
 */
export const GravabilidadSelector: React.FC<GravabilidadSelectorProps> = ({ value, onChange }) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-1 bg-surface rounded-xl p-1 w-fit">
                {OPCIONES.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={`px-3 py-1.5 text-[13px] font-semibold rounded-lg transition-colors ${value === opt.value ? 'bg-white shadow-sm text-primary' : 'text-text-secondary hover:text-heading'}`}
                    >
                        {t(opt.labelKey)}
                    </button>
                ))}
            </div>
            <p className="text-[11px] text-text-secondary">{t(OPCIONES.find((o) => o.value === value)!.tagKey)}</p>
        </div>
    );
};
