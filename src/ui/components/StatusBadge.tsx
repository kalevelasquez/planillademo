import { Badge, type BadgeVariant } from './Badge';
import { useTranslation } from 'react-i18next';

interface StatusBadgeProps {
    status: string;
    customLabel?: string;
}

export function StatusBadge({ status, customLabel }: StatusBadgeProps) {
    const { t } = useTranslation();
    if (customLabel) {
        // Mapear variantes básicas por status si hay customLabel
        let variant: BadgeVariant = 'info';
        const s = status.toLowerCase();
        if (s === 'approved') variant = 'success';
        if (s === 'delivered') variant = 'delivered';
        if (s === 'pending' || s === 'in preparation') variant = 'warning';
        if (s === 'cancelled') variant = 'error';

        return <Badge variant={variant} label={customLabel} dot={status.toLowerCase() !== 'draft'} />;
    }

    switch (status.toLowerCase()) {
        case 'approved':
            return <Badge variant="success" label={t('status.approved')} dot />;
        case 'delivered':
            return <Badge variant="delivered" label={t('status.delivered')} dot />;
        case 'in preparation':
            return <Badge variant="warning" label={t('status.in_preparation')} dot />;
        case 'pending':
            return <Badge variant="warning" label={t('status.pending')} dot />;
        case 'draft':
            return <Badge variant="info" label={t('status.draft')} />;
        case 'cancelled':
            return <Badge variant="error" label={t('status.cancelled')} dot />;
        default:
            return <Badge variant="info" label={customLabel || status} />;
    }
}
