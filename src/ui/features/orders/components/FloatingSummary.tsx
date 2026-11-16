import { ShoppingCart, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FloatingSummaryProps {
    totalItems: number;
    subtotal: number;
    onCheckout: () => void;
}

/**
 * Floating Action Bar persistente — CA8 (Blueprint v2.0 §2.2, RN-04, RN-05).
 * z-50 · fixed · bottom-0 · animación slide-up/down.
 * Visible solo cuando totalItems > 0.
 */
export const FloatingSummary: React.FC<FloatingSummaryProps> = ({
    totalItems,
    subtotal,
    onCheckout,
}) => {
    const { t } = useTranslation();
    const isVisible = totalItems > 0;

    const formattedSubtotal = subtotal.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
    });

    return (
        <div
            className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out
                ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}
            aria-hidden={!isVisible}
        >
            <div className="bg-white/95 backdrop-blur-sm border-t border-border shadow-modals px-md py-sm md:px-lg">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-md">

                    {/* Left: Contador + Subtotal */}
                    <div className="flex items-center gap-md min-w-0">
                        <div className="relative shrink-0">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <ShoppingCart size={20} className="text-primary" />
                            </div>
                            <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm leading-none">
                                {totalItems > 99 ? '99+' : totalItems}
                            </span>
                        </div>
                        <div className="min-w-0">
                            <p className="text-caption text-text-secondary truncate">
                                <span>{totalItems}</span> <span>{totalItems === 1 ? t('catalog.summary_item_one') : t('catalog.summary_items_other')}</span>
                            </p>
                            <p className="text-h3 font-display font-bold text-heading">
                                <span>{formattedSubtotal}</span>
                            </p>
                        </div>
                    </div>

                    {/* Right: CTA */}
                    <button
                        onClick={onCheckout}
                        className="shrink-0 flex items-center gap-xs bg-primary text-white font-semibold text-body px-lg py-sm rounded-lg shadow-sm hover:bg-primary-dark active:scale-95 transition-all duration-150"
                    >
                        {t('catalog.btn_view_summary')}
                        <ArrowRight size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
