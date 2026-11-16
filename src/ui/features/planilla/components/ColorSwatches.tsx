import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import type { ColorKey } from '../../../../services/departamentosService';
import { DEPARTAMENTO_COLOR_KEYS, getColorClasses } from '../../../../utils/departamentoColorUtils';

interface ColorSwatchesProps {
    valor: ColorKey;
    onPick: (c: ColorKey) => void;
    disabled?: boolean;
}

export const ColorSwatches: React.FC<ColorSwatchesProps> = ({ valor, onPick, disabled }) => {
    const { t } = useTranslation();
    return (
        <div className="inline-flex bg-surface border border-border rounded-lg p-1 gap-1 shrink-0">
            {DEPARTAMENTO_COLOR_KEYS.map((key) => (
                <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    title={t(`empleados.color_${key}`)}
                    onClick={() => onPick(key)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-50 ${getColorClasses(key)} ${valor === key ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                >
                    {valor === key && <Check size={12} />}
                </button>
            ))}
        </div>
    );
};
