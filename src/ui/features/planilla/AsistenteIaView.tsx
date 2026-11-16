import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Send, User, AlertTriangle } from 'lucide-react';

import { asistenteIaService, type MensajeChat } from '../../../services/asistenteIaService';
import { Button } from '../../components/Button';
import { Logger } from '../../../utils/logger';

/**
 * Chat de consulta del Asistente de IA (US-IA-02 / IMPL-117). CA1: vive dentro de Planilla,
 * no en Pedidos. El envío queda deshabilitado con un aviso claro mientras el backend
 * responda `no_configurado` (todavía no existe la cuenta de Anthropic dedicada a este uso) —
 * mismo criterio que los botones deshabilitados de Cierre y Aprobación antes de que esa
 * épica existiera.
 */
export const AsistenteIaView: React.FC = () => {
    const { t } = useTranslation();
    const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
    const [isLoadingHistorial, setIsLoadingHistorial] = useState(true);
    const [input, setInput] = useState('');
    const [isEnviando, setIsEnviando] = useState(false);
    const [noConfigurado, setNoConfigurado] = useState(false);
    const finRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelado = false;
        asistenteIaService.obtenerHistorial()
            .then((historial) => { if (!cancelado) setMensajes(historial); })
            .catch((err: unknown) => Logger.error('Error al cargar el historial del asistente de IA', {}, err))
            .finally(() => { if (!cancelado) setIsLoadingHistorial(false); });
        return () => { cancelado = true; };
    }, []);

    useEffect(() => {
        finRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [mensajes, isEnviando]);

    const handleEnviar = async () => {
        const texto = input.trim();
        if (!texto || isEnviando) return;

        const nuevoMensaje: MensajeChat = { role: 'user', content: texto };
        setMensajes((prev) => [...prev, nuevoMensaje]);
        setInput('');
        setIsEnviando(true);

        try {
            const resultado = await asistenteIaService.enviarMensaje(texto);
            if (resultado.no_configurado) {
                setNoConfigurado(true);
                setMensajes((prev) => prev.slice(0, -1)); // no consumir el turno si nunca se procesó
                return;
            }
            setMensajes((prev) => [...prev, { role: 'assistant', content: resultado.respuesta }]);
        } catch (err: unknown) {
            Logger.error('Error al consultar al asistente de IA', {}, err);
            setMensajes((prev) => [...prev, { role: 'assistant', content: t('asistenteIa.error_respuesta') }]);
        } finally {
            setIsEnviando(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleEnviar();
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-4 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md h-[calc(100vh-5rem)]">
            {noConfigurado && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm font-medium shrink-0">
                    <AlertTriangle size={16} />
                    {t('asistenteIa.no_configurado')}
                </div>
            )}

            <div className="flex-1 overflow-y-auto flex flex-col gap-3 bg-white rounded-lg shadow-cards border border-border p-lg">
                {isLoadingHistorial ? (
                    <div className="h-24 bg-surface rounded-lg animate-pulse" />
                ) : mensajes.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-text-secondary">
                        <Bot size={32} className="opacity-30" />
                        <p className="text-caption">{t('asistenteIa.empty_state')}</p>
                    </div>
                ) : (
                    mensajes.map((m, i) => (
                        <div key={i} className={`flex items-start gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {m.role === 'assistant' && <Bot size={18} className="text-primary shrink-0 mt-1.5" />}
                            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-white' : 'bg-surface text-heading'}`}>
                                {m.content}
                            </div>
                            {m.role === 'user' && <User size={18} className="text-text-secondary shrink-0 mt-1.5" />}
                        </div>
                    ))
                )}
                {isEnviando && (
                    <div className="flex items-center gap-2 justify-start">
                        <Bot size={18} className="text-primary shrink-0" />
                        <div className="bg-surface rounded-lg px-3 py-2 text-sm text-text-secondary italic">{t('asistenteIa.pensando')}</div>
                    </div>
                )}
                <div ref={finRef} />
            </div>

            <div className="flex items-end gap-2 shrink-0">
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    placeholder={t('asistenteIa.input_placeholder')}
                    className="flex-1 rounded-md border border-border bg-white p-sm text-body text-heading resize-none"
                />
                <Button onClick={handleEnviar} disabled={!input.trim() || isEnviando} isLoading={isEnviando} className="flex items-center gap-2 h-full">
                    <Send size={16} />
                </Button>
            </div>
        </div>
    );
};
