import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Product } from '../../../../services/productService';
import { useOrderStore } from '../../../../store/orderStore';
import { Package, AlertTriangle } from 'lucide-react';

interface ProductListItemProps {
    product: Product;
}

/**
 * Vista de Lista para Selección de Productos (US-ORD-10)
 * Un diseño ultra-compacto y eficiente para usuarios que manejan catálogos densos.
 */
export const ProductListItem: React.FC<ProductListItemProps> = ({ product }) => {
    const { t } = useTranslation();
    const orderItem = useOrderStore(state => state.items[product.id]);
    const updateQuantity = useOrderStore(state => state.updateQuantity);
    const updateUnitPrice = useOrderStore(state => state.updateUnitPrice);
    const toggleOverride = useOrderStore(state => state.toggleItemOverride);

    const quantity = orderItem?.quantity ?? 0;
    const isUnavailable = product.status === 'unavailable';
    const isOutOfStock = product.available_quantity <= 0;
    const isDisabled = isUnavailable;
    const isOverInventory = quantity > product.available_quantity;
    const isOverridden = orderItem?.isOverridden ?? false;
    const hasItems = quantity > 0;
    const price = orderItem?.unitPrice ?? Number(product.price || 0);

    return (
        <div
            className={`flex flex-row items-center justify-between gap-sm sm:gap-md p-sm sm:p-md rounded-lg border transition-all relative overflow-hidden
                ${isDisabled
                    ? 'bg-surface border-border opacity-70'
                    : isOutOfStock
                        ? 'bg-error/5 border-error/30 opacity-80' // US-ORD-10: Identificador visual de stock agotado
                        : isOverInventory && !isOverridden
                            ? 'bg-warning/5 border-warning/30'
                            : hasItems
                                ? 'bg-primary/5 border-primary/20 shadow-sm'
                                : 'bg-white border-border hover:border-text-secondary/20 shadow-sm hover:shadow-md'
                }`}
        >
            {/* Color accent bar for active items */}
            {hasItems && !isDisabled && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg" />
            )}

            {/* Product Basic Info + Inventory (Compact on mobile) */}
            <div className="flex-1 min-w-0 flex items-start gap-2 sm:gap-md">
                <div className={`p-1.5 sm:p-2 rounded-lg shrink-0 ${hasItems ? 'bg-primary/10 text-primary' : 'bg-surface text-text-secondary'}`}>
                    <Package size={18} className="sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0 flex-1">
                    {/* Contenedor de Información Adaptable (US-ORD-10) */}
                    <div className="flex flex-col gap-0.5 sm:gap-1">
                        {/* Nombre del Producto */}
                        <h3 className="text-sm sm:text-body font-bold text-heading truncate leading-tight">
                            {product.name}
                        </h3>

                        {/* Datos Técnicos (Fila Compacta) */}
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 min-w-0 opacity-90">
                            {/* Calibre */}
                            <span className="text-[10px] sm:text-xs font-bold text-primary-dark/80 tracking-tight">
                                {product.caliber || 'S/C'}
                            </span>

                            <span className="w-px h-2.5 bg-border/40 hidden sm:block" />

                            {/* Marca */}
                            <span className="text-[10px] sm:text-xs font-bold text-primary-dark/80 uppercase tracking-tight">
                                {product.brand}
                            </span>

                            <span className="w-px h-2.5 bg-border/40 hidden sm:block" />

                            {/* Calidad */}
                            {product.quality && (
                                <span className="text-[9px] sm:text-[10px] font-bold text-secondary-dark/80 bg-secondary-light/10 px-1.5 py-[0.5px] rounded border border-secondary/10 uppercase tracking-tighter">
                                    {product.quality}
                                </span>
                            )}

                            <span className="w-px h-2.5 bg-border/40 hidden sm:block" />

                            {/* Embarque */}
                            <span className="text-[10px] sm:text-xs font-bold text-primary-dark/80 tracking-tight">
                                {product.shipment_number || 'N/A'}
                            </span>
                        </div>

                        {/* Stock (Solo Mobile - Línea inferior) */}
                        <div className="sm:hidden mt-0.5">
                            {isUnavailable ? (
                                <span className="text-[9px] font-bold text-text-secondary/60 uppercase tracking-wide">{t('catalog.unavailable_badge')}</span>
                            ) : isOutOfStock ? (
                                <span className="text-[9px] font-bold text-error uppercase tracking-wide">{t('catalog.no_stock')}</span>
                            ) : (
                                <span className={`text-[10px] font-bold ${product.available_quantity > 10 ? 'text-success/90' : 'text-warning/90'}`}>
                                    {t('catalog.dispo_label')} {product.available_quantity} <span className="text-[8px] font-medium text-text-secondary uppercase">unid.</span>
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Inventory (Desktop Only) */}
            <div className="hidden sm:flex flex-col items-end gap-1 min-w-[100px]">
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-tight">
                    {isUnavailable ? (
                        <span className="text-text-secondary">{t('catalog.unavailable_badge')}</span>
                    ) : isOutOfStock ? (
                        <span className="text-error">{t('catalog.no_stock')}</span>
                    ) : (
                        <>
                            {t('catalog.dispo_label')} <span className={product.available_quantity > 10 ? 'text-success' : 'text-warning'}>{product.available_quantity}</span>
                        </>
                    )}
                </span>

                {isOverInventory && !isDisabled && (
                    <button
                        onClick={() => toggleOverride(product.id)}
                        className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded transition-colors
                            ${isOverridden
                                ? 'bg-success text-white'
                                : 'bg-error/10 text-error hover:bg-error hover:text-white border border-error/20'
                            }`}
                    >
                        <AlertTriangle size={12} />
                        {isOverridden ? t('catalog.btn_confirm_override') : t('catalog.btn_accept_override')}
                    </button>
                )}
            </div>

            {/* Price & Quantity Input */}
            <div className="flex items-center gap-3 sm:gap-md shrink-0 sm:pl-md sm:border-l border-border/50">
                {/* Override Trigger for Mobile (shows icon only if over inventory) */}
                {isOverInventory && !isDisabled && !isOverridden && (
                    <button
                        onClick={() => toggleOverride(product.id)}
                        className="sm:hidden text-error animate-pulse"
                    >
                        <AlertTriangle size={16} />
                    </button>
                )}

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
                                className={`w-[85px] h-9 sm:h-10 pl-5 pr-2 border rounded-lg text-right font-bold text-sm sm:text-body focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm
                                    ${price !== Number(product.price)
                                        ? 'bg-primary/5 border-primary/40 text-primary-dark ring-1 ring-primary/20'
                                        : 'bg-white border-border text-heading'
                                    }`}
                                placeholder={Number(product.price).toFixed(2)}
                            />
                        </div>
                        <div className="absolute -bottom-4 right-0 text-[8px] text-text-secondary uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                            {price !== Number(product.price) ? 'Precio Especial' : 'Editar Precio'}
                        </div>
                    </div>
                    {isOverridden && <span className="absolute -bottom-4 left-0 text-[8px] text-success font-bold uppercase sm:hidden">Over</span>}
                </div>

                <div className={`relative flex items-center ${isDisabled ? 'opacity-30 pointer-events-none' : ''}`}>
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
                        className={`w-14 sm:w-20 h-9 sm:h-10 border rounded-lg bg-white text-center font-bold text-sm sm:text-body text-heading 
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
