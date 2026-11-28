import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Availability } from '../../../../services/storeService';

interface AvailabilityBadgeProps {
    availability: Availability;
}

/** Estado publico del producto. Solo Disponible/Agotado: jamas cantidades. */
export const AvailabilityBadge: React.FC<AvailabilityBadgeProps> = ({ availability }) => {
    const { t } = useTranslation();
    const available = availability === 'Disponible';

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                available ? 'bg-success-light text-success-dark' : 'bg-surface text-text-secondary'
            }`}
        >
            <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${available ? 'bg-success' : 'bg-text-secondary'}`}
            />
            {available ? t('store.catalog.available') : t('store.catalog.soldOut')}
        </span>
    );
};
