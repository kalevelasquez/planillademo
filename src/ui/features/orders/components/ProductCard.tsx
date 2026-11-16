import { useTranslation } from 'react-i18next';
import type { Product } from '../../../../services/productService';
import { useOrderStore } from '../../../../store/orderStore';

interface ProductCardProps {
    product: Product;
}

/**
 * Tarjeta de producto enriquecida con Calidad y Embarque.
 * Blueprint v2.0 §2.2 — ProductCard
 *
 * Consume useOrderStore directamente para eliminar prop-drilling
 * de `quantity` / `onQuantityChange` (Revisión de código 03-Mar-2026).
 */
export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
    // ── Selector directo al store — sin prop drilling ─────────────────────
    const orderItem = useOrderStore(state => state.items[product.id]);
    const updateQuantity = useOrderStore(state => state.updateQuantity);
    const updateUnitPrice = useOrderStore(state => state.updateUnitPrice);
    const { t } = useTranslation();

    const quantity = orderItem?.quantity ?? 0;
    const isUnavailable = product.status === 'unavailable';
    const isOutOfStock = product.available_quantity <= 0;
    const isDisabled = isUnavailable; // US-ORD-03: Ya no deshabilitamos por stock agotado (isOutOfStock), solo por status
    const isOverInventory = quantity > product.available_quantity;
    const isOverridden = orderItem?.isOverridden ?? false;
    const toggleOverride = useOrderStore(state => state.toggleItemOverride);

    const hasItems = quantity > 0;
    const price = orderItem?.unitPrice ?? Number(product.price || 0);

    return (
        <div
            className={`flex flex-col p-md rounded-lg shadow-cards border transition-all h-full relative overflow-hidden scroll-mt-48 md:scroll-mt-64
                ${isDisabled
                    ? 'bg-surface border-border opacity-70 grayscale-[0.5]'
                    : isOutOfStock
                        ? 'bg-error/5 border-error/50 opacity-80' // US-ORD-10: Identificador visual de stock agotado
                        : isOverInventory && !isOverridden
                            ? 'bg-warning/5 border-warning/50 ring-1 ring-warning/30'
                            : hasItems
                                ? 'bg-primary/5 border-primary/30'
                                : 'bg-white border-border hover:border-text-secondary/30'
                }`}
        >
            {/* Status Badge (CA4 US-INV-03) */}
            {isDisabled && (
                <div className="absolute top-0 right-0 z-10">
                    <div className={`px-2 py-1 text-[10px] font-bold text-white rounded-bl-lg shadow-sm
                        ${isUnavailable ? 'bg-text-secondary' : 'bg-error'}
                    `}>
                        {isUnavailable ? t('catalog.unavailable_badge') : t('catalog.out_of_stock_badge')}
                    </div>
                </div>
            )}
            {/* Header: nombre + precio */}
            <div className="flex justify-between items-start mb-xs">
                <div className="flex-1 min-w-0 pr-sm">
                    <h3 className="text-body font-bold text-heading leading-tight truncate">
                        {product.name}
                    </h3>
                    <p className="text-caption text-text-secondary mt-[2px]">
                        {product.brand} · {t('catalog.caliber_label')} {product.caliber}
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1 min-w-[85px] self-center">
                    <div className="relative group flex flex-col items-end">
                        <div className="relative flex items-center">
                            <span className="absolute left-2 text-primary/50 font-bold pointer-events-none text-sm z-10">$</span>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={price === 0 ? '' : price}
                                onChange={(e) => {
                                    const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                    if (!isNaN(val)) updateUnitPrice(product, val);
                                }}
                                className={`w-[85px] h-9 pl-5 pr-2 border rounded-lg text-right font-bold text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm
                                    ${price !== Number(product.price)
                                        ? 'bg-primary/5 border-primary/40 text-primary-dark ring-1 ring-primary/20'
                                        : 'bg-white border-border text-heading'
                                    }`}
                                placeholder={Number(product.price).toFixed(2)}
                            />
                        </div>
                        <div className="absolute -bottom-4 right-0 text-[8px] text-text-secondary uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                            {price !== Number(product.price) ? 'Especial' : 'Editar Price'}
                        </div>
                    </div>
                </div>
            </div>

            {isOverInventory && !isDisabled && (
                <div className={`mb-4 p-3 rounded-lg border-2 shadow-sm flex flex-col gap-2
                    ${isOverridden
                        ? 'bg-success/10 border-success/30 text-success-dark'
                        : 'bg-error/5 border-error/50 text-error-dark'
                    }
                `}>
                    <p className="text-[12px] font-bold leading-tight">
                        ⚠️ <span className="underline decoration-error/50">{t('catalog.stock_insufficient')}</span>
                        <br />
                        <span className="text-error font-extrabold text-[13px]">
                            {t('catalog.inventory_available', { count: product.available_quantity })}
                            <br />
                            {t('catalog.requested_units', { count: quantity })}
                        </span>
                    </p>
                    <button
                        onClick={() => toggleOverride(product.id)}
                        className={`w-full py-2 rounded font-bold uppercase text-[10px] tracking-widest transition-all
                            ${isOverridden
                                ? 'bg-success text-white shadow-success/20'
                                : 'bg-error text-white hover:bg-error-dark shadow-lg shadow-error/20 ring-2 ring-error/20'
                            }
                        `}
                    >
                        {isOverridden ? t('catalog.btn_confirm_override') : t('catalog.btn_accept_override')}
                    </button>
                </div>
            )}

            {/* Badges: Calidad + Embarque — flex-wrap libre (items-stretch del carrusel iguala alturas) */}
            <div className="flex items-center gap-xs flex-wrap mb-sm">
                {product.quality && (
                    <span className="inline-flex items-center rounded-full bg-secondary-light text-secondary-dark text-[10px] font-semibold px-xs py-[2px] border border-secondary/20">
                        ★ {product.quality}
                    </span>
                )}
                {product.shipment_number && (
                    <span className="inline-flex items-center rounded-full bg-surface text-text-secondary text-[10px] font-medium px-xs py-[2px] border border-border">
                        {t('catalog.shipment_label')}{product.shipment_number}
                    </span>
                )}
            </div>

            {/* Footer: disponibilidad + stepper */}
            <div className="mt-auto pt-sm flex items-center justify-between border-t border-border/50">
                <span className="text-caption text-text-secondary flex items-center gap-xs">
                    {isUnavailable ? (
                        <span className="text-text-secondary font-medium">{t('catalog.unavailable_badge').toLowerCase()}</span>
                    ) : isOutOfStock ? (
                        <span className="text-error font-medium">{t('catalog.no_stock')}</span>
                    ) : (
                        <>
                            {t('catalog.dispo_label')}{' '}
                            <strong className={product.available_quantity > 10 ? 'text-success' : 'text-warning'}>
                                {product.available_quantity}
                            </strong>
                        </>
                    )}
                </span>

                {/* Input de cantidad (US-ORD-03) */}
                <div className={`relative flex items-center ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={quantity === 0 ? '' : quantity}
                        onChange={(e) => {
                            const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                            if (!isNaN(val)) updateQuantity(product, val);
                        }}
                        onFocus={(e) => e.target.select()}
                        className={`w-24 h-11 border rounded-lg bg-white text-center font-bold text-body text-heading 
                            focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all shadow-sm
                            ${hasItems ? 'border-primary ring-1 ring-primary/10' : 'border-border'}
                        `}
                        placeholder="0"
                    />
                </div>
            </div>
        </div>
    );
};
