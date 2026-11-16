import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Check } from 'lucide-react';

interface ConfigCrudModalProps {
    title: string;
    onClose: () => void;
    onSave: (e: React.FormEvent) => void;
    saving?: boolean;
    saveDisabled?: boolean;
    children: React.ReactNode;
}

/**
 * Modal bottom-sheet genérico para alta en los catálogos de Configuración de Planilla
 * (fidelidad al DEMO, mismo chrome que BonificacionModal/DetalleDescuentosModal: fixed
 * inset-0 z-50, bg-heading/40 backdrop-blur-xs, rounded-t-2xl sm:rounded-2xl, slide-in).
 */
export const ConfigCrudModal: React.FC<ConfigCrudModalProps> = ({ title, onClose, onSave, saving, saveDisabled, children }) => {
    const { t } = useTranslation();
    // Portal a document.body: este modal se usa desde CatalogSelectQuickAdd, adentro del <form>
    // grande de crear/editar empleado. Un <form> anidado dentro de otro <form> es invalido en
    // HTML y el comportamiento del submit nativo entre navegadores no es confiable (podia
    // terminar disparando o afectando al formulario ancestro) — sacándolo del árbol del DOM del
    // formulario con un portal evita el anidado por completo, en vez de parchear el síntoma.
    return createPortal(
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <form
                    onSubmit={onSave}
                    className="pointer-events-auto w-full sm:max-w-[480px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[90dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300"
                >
                    <div className="sm:hidden flex justify-center pt-sm shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>
                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <h3 className="text-body font-bold text-heading">{title}</h3>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading p-xs"><X size={18} /></button>
                    </div>
                    <div className="overflow-y-auto flex-1 px-lg py-lg flex flex-col gap-md">{children}</div>
                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        <button
                            type="submit"
                            disabled={saving || saveDisabled}
                            className="flex-1 flex items-center justify-center gap-xs px-lg py-sm bg-primary text-white rounded-xl font-semibold text-body hover:bg-primary-dark transition-colors disabled:opacity-60"
                        >
                            <Check size={16} /> {saving ? t('configuracion.modal_guardando') : t('configuracion.modal_guardar')}
                        </button>
                        <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                            {t('configuracion.modal_cancelar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
};
