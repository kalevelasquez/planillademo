import React from 'react';
import type { OrderItemDetail } from '../../../services/orderService';
import { StickyNote } from 'lucide-react';


export const ReadOnlyOrderItemsTable: React.FC<{ items: OrderItemDetail[] }> = ({ items }) => {
    if (!items || items.length === 0) return null;

    return (
        <div className="w-full flex flex-col gap-2">
            <h4 className="font-display font-bold text-heading text-sm mb-1 px-2 md:px-0">MERCADERÍA A DESPACHAR</h4>

            {/* MOBILE LAYOUT */}
            <div className="md:hidden flex flex-col gap-2 bg-surface/30 p-2 rounded-md">
                {items.map(item => (
                    <div key={item.id} className="bg-white p-3 rounded shadow-sm border border-border flex justify-between items-center">
                        <div className="flex flex-col">
                            <span className="font-bold text-heading text-sm">{item.products?.name}</span>
                            <span className="text-xs text-text-secondary">
                                {[item.products?.brand, item.products?.caliber, item.products?.quality, item.products?.shipment_number].filter(Boolean).join(' · ')}
                            </span>
                            {item.notes && (
                                <p className="text-[11px] text-primary font-medium italic mt-1 flex items-center gap-1">
                                    <StickyNote size={10} /> {item.notes}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-xs text-text-secondary uppercase tracking-wider font-bold">Cant.</span>
                            <span className="font-display font-bold text-lg text-primary">{item.quantity}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* DESKTOP LAYOUT */}
            <div className="hidden md:block overflow-x-auto border border-border rounded-lg bg-white">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-surface text-caption text-text-secondary uppercase tracking-wider border-b border-border">
                            <th className="px-md py-sm font-semibold">Producto</th>
                            <th className="px-md py-sm font-semibold">Embarque</th>
                            <th className="px-md py-sm font-semibold">Calidad / Calibre</th>
                            <th className="px-md py-sm font-semibold text-right">Cant. Físicas</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                        {items.map((item, idx) => (
                            <tr key={item.id || idx} className="hover:bg-surface/30 transition-colors">
                                <td className="px-md py-sm">
                                    <div className="flex flex-col">
                                        <span className="font-bold text-heading text-sm">{item.products?.name}</span>
                                        {item.notes && (
                                            <p className="text-[11px] text-primary font-medium italic flex items-center gap-1 mt-0.5">
                                                <StickyNote size={10} /> {item.notes}
                                            </p>
                                        )}
                                    </div>
                                </td>
                                <td className="px-md py-sm text-sm font-bold text-heading">
                                    {item.products?.shipment_number || <span className="text-text-secondary opacity-50">—</span>}
                                </td>
                                <td className="px-md py-sm text-sm text-text-secondary">
                                    {[item.products?.brand, item.products?.caliber, item.products?.quality].filter(Boolean).join(' · ')}
                                </td>
                                <td className="px-md py-sm text-right">
                                    <span className="font-display font-bold text-primary">{item.quantity}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
