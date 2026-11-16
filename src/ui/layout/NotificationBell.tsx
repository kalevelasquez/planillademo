import React, { useState, useRef, useEffect } from 'react';
import { Bell, Package, CheckCheck, Trash2, X, Send, XCircle, CalendarCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore, type Notification, type QuincenaNotificationType } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../config/supabaseClient';
import { ORDER_STATUS, ROLES } from '../../config/constants';
import { notificacionesService, type Notificacion } from '../../services/notificacionesService';
import { Logger } from '../../utils/logger';

const QUINCENA_TYPES: QuincenaNotificationType[] = ['quincena_enviada_aprobacion', 'quincena_rechazada', 'quincena_aprobada_cerrada'];
const isQuincenaType = (type: Notification['type']): type is QuincenaNotificationType =>
    (QUINCENA_TYPES as string[]).includes(type);

function mapDbNotificacion(n: Notificacion): Notification {
    return {
        id: n.id,
        title: n.titulo,
        message: n.mensaje,
        type: n.tipo as Notification['type'],
        referenceId: n.referencia_id ?? undefined,
        createdAt: n.created_at,
        isRead: n.leida,
    };
}

function getNotifIcono(type: Notification['type']): { Icon: typeof Package; className: string } {
    switch (type) {
        case 'order_approved':
            return { Icon: Package, className: 'bg-success/10 text-success' };
        case 'quincena_enviada_aprobacion':
            return { Icon: Send, className: 'bg-primary/10 text-primary' };
        case 'quincena_rechazada':
            return { Icon: XCircle, className: 'bg-error/10 text-error' };
        case 'quincena_aprobada_cerrada':
            return { Icon: CalendarCheck, className: 'bg-success/10 text-success' };
        default:
            return { Icon: CheckCheck, className: 'bg-primary/10 text-primary' };
    }
}

export const NotificationBell: React.FC = () => {
    const navigate = useNavigate();
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { profile } = useAuthStore();
    const {
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotifications,
        hydrateFromDb
    } = useNotificationStore();

    const [isOpen, setIsOpen] = useState(false);

    // US-CIE-04 (IMPL-127) — hidratar desde la tabla `notificaciones` (persistente, a
    // diferencia de las de Pedidos que son 100% client-side) y suscribirse a nuevas.
    useEffect(() => {
        if (!profile?.id) return;
        let cancelado = false;

        notificacionesService.getTodas(profile.id)
            .then((rows) => { if (!cancelado) hydrateFromDb(rows.map(mapDbNotificacion)); })
            .catch((err: unknown) => Logger.error('Error al cargar notificaciones', { usuarioId: profile.id }, err));

        const channel = supabase
            .channel(`notificaciones-${profile.id}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `usuario_id=eq.${profile.id}` },
                (payload) => hydrateFromDb([mapDbNotificacion(payload.new as Notificacion)])
            )
            .subscribe();

        return () => {
            cancelado = true;
            supabase.removeChannel(channel);
        };
    }, [profile?.id, hydrateFromDb]);

    // Listen to real-time order approvals (US-HIS-03 CA4)
    useEffect(() => {
        if (!profile?.tenant_id || !profile?.id) return;

        // Solo activar para despachadores, supervisores y admins
        const allowedRoles = [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.DESPACHADOR];
        const userRoles = Array.isArray(profile.roles) ? profile.roles : [profile.role || ''];
        const hasAccess = userRoles.some(r => allowedRoles.map(ar => ar.toLowerCase()).includes(r?.toLowerCase()));

        if (!hasAccess) return;

        console.log(`[NOTIFICATIONS] Subscribing for tenant: ${profile.tenant_id}`);

        const channel = supabase
            .channel(`order-approvals-${profile.tenant_id}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // Escuchar todo para debug
                    schema: 'public',
                    table: 'orders',
                    filter: `tenant_id=eq.${profile.tenant_id}`
                },
                (payload) => {
                    console.log('[NOTIFICATIONS] Realtime Event Received:', payload.eventType, (payload.new as any)?.status);

                    const newOrder = payload.new as any;
                    const oldOrder = payload.old as any;

                    if (!newOrder) return;

                    // Lógica de activación:
                    // 1. Es un UPDATE y el nuevo estado es APPROVED y el anterior no lo era (o no lo sabemos)
                    // 2. Es un INSERT y el estado inicial ya es APPROVED
                    const isNewApproval =
                        (payload.eventType === 'UPDATE' &&
                            newOrder.status === ORDER_STATUS.APPROVED &&
                            (!oldOrder || oldOrder.status !== ORDER_STATUS.APPROVED)) ||
                        (payload.eventType === 'INSERT' &&
                            newOrder.status === ORDER_STATUS.APPROVED);

                    if (isNewApproval) {
                        console.log('[NOTIFICATIONS] Triggering notification for order #', newOrder.order_number);
                        addNotification({
                            title: 'Nuevo Pedido Aprobado',
                            message: `El pedido #${newOrder.order_number} está listo para despacho.`,
                            type: 'order_approved',
                            referenceId: newOrder.id
                        });

                        try {
                            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                            audio.play().catch(() => null);
                        } catch (e) { }
                    }
                }
            )
            .subscribe((status) => {
                console.log('[NOTIFICATIONS] Subscription status:', status);
                if (status === 'CHANNEL_ERROR') {
                    console.error('[NOTIFICATIONS] Error: Realtime might be disabled for "orders" table.');
                }
            });

        return () => {
            console.log('[NOTIFICATIONS] Unsubscribing...');
            supabase.removeChannel(channel);
        };
    }, [profile?.tenant_id, profile?.id, profile?.roles, profile?.role, addNotification]);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleNotificationClick = (notif: Notification) => {
        markAsRead(notif.id);
        setIsOpen(false);

        if (isQuincenaType(notif.type)) {
            notificacionesService.marcarLeida(notif.id)
                .catch((err: unknown) => Logger.error('Error al marcar notificación como leída', { id: notif.id }, err));
            if (notif.referenceId) navigate(`/planilla/historial/${notif.referenceId}`);
            return;
        }

        if (notif.type === 'order_approved' && notif.referenceId) {
            // Navegar al detalle (CA6)
            // Si es despachador, vamos a la vista de despacho, si no a la estándar
            const isDispatcher = profile?.role === ROLES.DESPACHADOR || (Array.isArray(profile?.roles) && profile.roles.includes(ROLES.DESPACHADOR));
            const path = isDispatcher ? `/despacho/${notif.referenceId}` : `/pedidos/${notif.referenceId}`;
            navigate(path);
        }
    };

    const handleMarkAllAsRead = () => {
        markAllAsRead();
        if (profile?.id) {
            notificacionesService.marcarTodasLeidas(profile.id)
                .catch((err: unknown) => Logger.error('Error al marcar todas las notificaciones como leídas', { usuarioId: profile.id }, err));
        }
    };

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Icon & Badge (CA5) */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`p-2 rounded-full transition-all relative hover:bg-surface
                    ${isOpen ? 'bg-surface text-primary' : 'text-text-secondary hover:text-heading'}`}
            >
                <Bell size={22} className={unreadCount > 0 ? 'animate-swing' : ''} />
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4.5 h-4.5 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm scale-in">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div
                    className="absolute right-0 mt-3 w-80 md:w-96 bg-white border border-border rounded-2xl shadow-modals z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200"
                >
                    {/* Header */}
                    <div className="p-lg border-b border-border flex items-center justify-between bg-surface/30">
                        <div className="flex items-center gap-2">
                            <h3 className="text-body font-bold text-heading">Notificaciones</h3>
                            {unreadCount > 0 && (
                                <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                                    {unreadCount} nuevas
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {notifications.length > 0 && (
                                <button
                                    onClick={handleMarkAllAsRead}
                                    className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-md hover:bg-white"
                                    title="Marcar todo como leído"
                                >
                                    <CheckCheck size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 text-text-secondary hover:text-heading transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* List */}
                    <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
                        {notifications.length === 0 ? (
                            <div className="p-xl flex flex-col items-center justify-center text-center gap-3 opacity-60">
                                <div className="w-12 h-12 bg-surface rounded-full flex items-center justify-center">
                                    <Bell size={24} className="text-text-secondary/40" />
                                </div>
                                <div>
                                    <p className="text-caption font-bold text-heading">Bandeja vacía</p>
                                    <p className="text-[11px] text-text-secondary">No tienes notificaciones por ahora.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="divide-y divide-border">
                                {notifications.map((notif) => {
                                    const { Icon, className: iconClassName } = getNotifIcono(notif.type);
                                    return (
                                    <div
                                        key={notif.id}
                                        onClick={() => handleNotificationClick(notif)}
                                        className={`p-lg flex items-start gap-md cursor-pointer transition-all hover:bg-surface/50 relative group
                                            ${!notif.isRead ? 'bg-primary/5' : ''}`}
                                    >
                                        {!notif.isRead && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                                        )}

                                        <div className={`mt-0.5 shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${iconClassName}`}>
                                            <Icon size={18} />
                                        </div>

                                        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={`text-[13px] leading-tight truncate ${notif.isRead ? 'text-heading font-medium' : 'text-heading font-bold'}`}>
                                                    {notif.title}
                                                </span>
                                                <span className="text-[10px] text-text-secondary whitespace-nowrap">
                                                    {formatTime(notif.createdAt)}
                                                </span>
                                            </div>
                                            <p className="text-[12px] text-text-secondary line-clamp-2 leading-snug">
                                                {notif.message}
                                            </p>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                        <div className="p-md border-t border-border bg-surface/10 flex justify-center">
                            <button
                                onClick={(e) => { e.stopPropagation(); clearNotifications(); }}
                                className="flex items-center gap-2 text-[11px] font-bold text-error/70 hover:text-error transition-colors uppercase tracking-wider"
                            >
                                <Trash2 size={12} />
                                Limpiar Notificaciones
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Swing Animation Keyframes (Injected via Utility if not present in CSS) */}
            <style>{`
                @keyframes swing {
                    0% { transform: rotate(0); }
                    10% { transform: rotate(10deg); }
                    20% { transform: rotate(-10deg); }
                    30% { transform: rotate(6deg); }
                    40% { transform: rotate(-6deg); }
                    50% { transform: rotate(0); }
                    100% { transform: rotate(0); }
                }
                .animate-swing {
                    transform-origin: top center;
                    animation: swing 2s ease-in-out infinite;
                }
                .scale-in {
                    animation: scaleIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                }
                @keyframes scaleIn {
                    from { transform: scale(0); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
};
