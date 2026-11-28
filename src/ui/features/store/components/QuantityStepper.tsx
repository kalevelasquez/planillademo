import React from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import { MAX_ORDER_QUANTITY } from '../../../../services/storeService';

interface QuantityStepperProps {
    /** Nombre del producto: solo para las etiquetas accesibles. */
    name: string;
    value: number;
    onChange: (next: number) => void;
    min?: number;
    max?: number;
}

const BTN =
    'inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-paper text-primary transition-colors hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-40';

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
    name,
    value,
    onChange,
    min = 1,
    max = MAX_ORDER_QUANTITY,
}) => {
    const { t } = useTranslation();

    return (
        <div className="inline-flex items-center gap-2">
            <button
                type="button"
                aria-label={t('store.cart.decrease', { name })}
                disabled={value <= min}
                onClick={() => onChange(value - 1)}
                className={BTN}
            >
                <Minus size={16} aria-hidden="true" />
            </button>
            <span aria-live="polite" className="min-w-8 text-center font-display text-lg font-bold">
                {value}
            </span>
            <button
                type="button"
                aria-label={t('store.cart.increase', { name })}
                disabled={value >= max}
                onClick={() => onChange(value + 1)}
                className={BTN}
            >
                <Plus size={16} aria-hidden="true" />
            </button>
        </div>
    );
};
