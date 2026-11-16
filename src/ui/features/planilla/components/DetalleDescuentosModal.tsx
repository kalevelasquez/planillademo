import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle } from 'lucide-react';

export type TipoDescuentoItem = 'fijo' | 'variable' | 'anticipo';

export interface DescuentoDetalleItem {
    concepto: string;
    tipo: TipoDescuentoItem;
    monto: number;
}

interface DetalleDescuentosModalProps {
    empleadoNombre: string;
    items: DescuentoDetalleItem[];
    /** Textos ya traducidos de las alertas activas para este empleado (ver
     * `getClavesAlertaEmpleado` en CalculoPlanillaView.tsx) — el mismo triángulo que aparece
     * junto al nombre en el listado, pero acá con el texto completo, no solo un tooltip. */
    alertas?: string[];
    onClose: () => void;
}

const TIPO_BADGE_CLASS: Record<TipoDescuentoItem, string> = {
    fijo: 'bg-blue-50 text-blue-600',
    variable: 'bg-amber-50 text-amber-600',
    anticipo: 'bg-purple-50 text-purple-600',
};

/**
 * US-CALC-03 (fidelidad al DEMO) — desglose de descuentos por empleado, abierto desde un
 * ícono en la fila de la tabla/card. Los items ya vienen resueltos por el caller (ver
 * `getDescuentosDetalleItems` en CalculoPlanillaView.tsx) a partir del snapshot real
 * (`isss_empleado`/`afp_empleado`/`renta_isr`/`renta_bono10`/`descuentos_detalle`) — este
 * componente es puramente de presentación, no deriva nada.
 */
export const DetalleDescuentosModal: React.FC<DetalleDescuentosModalProps> = ({ empleadoNombre, items, alertas = [], onClose }) => {
    const { t } = useTranslation();
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const total = items.reduce((s, i) => s + i.monto, 0);

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[480px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[85dvh] animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="sm:hidden flex justify-center pt-sm shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>
                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div>
                            <h3 className="text-body font-bold text-heading">{t('calculoPlanilla.modal_descuentos_title')}</h3>
                            <p className="text-[12px] text-text-secondary mt-0.5">{empleadoNombre}</p>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading p-xs"><X size={18} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-lg py-lg">
                        {alertas.length > 0 && (
                            <div className="mb-md flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-sm">
                                {alertas.map((alerta, i) => (
                                    <p key={i} className="flex items-start gap-1.5 text-[12px] text-amber-700">
                                        <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {alerta}
                                    </p>
                                ))}
                            </div>
                        )}
                        {items.length === 0 ? (
                            <p className="text-[13px] text-text-secondary text-center py-lg">{t('calculoPlanilla.modal_descuentos_empty')}</p>
                        ) : (
                            <div className="bg-white rounded-xl border border-border overflow-hidden">
                                <table className="w-full text-[12px]">
                                    <thead>
                                        <tr className="bg-surface border-b border-border">
                                            <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-left">{t('calculoPlanilla.modal_descuentos_col_concepto')}</th>
                                            <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-left">{t('calculoPlanilla.modal_descuentos_col_tipo')}</th>
                                            <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-error text-right">{t('calculoPlanilla.modal_descuentos_col_monto')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, i) => (
                                            <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                                                <td className="px-md py-sm text-heading font-medium">{item.concepto}</td>
                                                <td className="px-md py-sm">
                                                    <span className={`inline-block px-sm py-0.5 rounded-full text-[10px] font-bold ${TIPO_BADGE_CLASS[item.tipo]}`}>
                                                        {t(`calculoPlanilla.modal_descuentos_tipo_${item.tipo}`)}
                                                    </span>
                                                </td>
                                                <td className="px-md py-sm text-error font-semibold text-right">{fmt(item.monto)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    <div className="px-lg py-md border-t border-border shrink-0 flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('calculoPlanilla.modal_descuentos_total')}</p>
                            <p className="text-[1.1rem] font-bold text-error">{fmt(total)}</p>
                        </div>
                        <button type="button" onClick={onClose} className="px-lg py-sm bg-primary text-white rounded-xl font-semibold text-[13px] hover:bg-primary-dark transition-colors">
                            {t('calculoPlanilla.action_cerrar')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
