import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type QuincenaNotificationType = 'quincena_enviada_aprobacion' | 'quincena_rechazada' | 'quincena_aprobada_cerrada';

export interface Notification {
    id: string;
    title: string;
    message: string;
    type: 'order_approved' | 'system' | 'alert' | QuincenaNotificationType;
    referenceId?: string; // e.g., orderId o quincenaId
    createdAt: string;
    isRead: boolean;
}

interface NotificationState {
    notifications: Notification[];
    unreadCount: number;
    addNotification: (notification: Omit<Notification, 'id' | 'isRead' | 'createdAt'>) => void;
    markAsRead: (id: string) => void;
    markAllAsRead: () => void;
    clearNotifications: () => void;
    /** US-CIE-04 (IMPL-127) — mezcla notificaciones ya persistidas en la tabla `notificaciones`
     * (con su propio id/isRead/createdAt reales) sin pisar las que ya llegaron por otra vía
     * (ej. las de Pedidos, que siguen siendo 100% client-side). Dedupe por id. */
    hydrateFromDb: (dbNotifications: Notification[]) => void;
}

export const useNotificationStore = create<NotificationState>()(
    persist(
        (set) => ({
            notifications: [],
            unreadCount: 0,
            addNotification: (notif) => {
                const newNotif: Notification = {
                    ...notif,
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                    isRead: false,
                };
                set((state) => {
                    const updated = [newNotif, ...state.notifications].slice(0, 50); // Keep last 50
                    return {
                        notifications: updated,
                        unreadCount: updated.filter(n => !n.isRead).length
                    };
                });
            },
            markAsRead: (id) => set((state) => {
                const updated = state.notifications.map(n =>
                    n.id === id ? { ...n, isRead: true } : n
                );
                return {
                    notifications: updated,
                    unreadCount: updated.filter(n => !n.isRead).length
                };
            }),
            markAllAsRead: () => set((state) => {
                const updated = state.notifications.map(n => ({ ...n, isRead: true }));
                return {
                    notifications: updated,
                    unreadCount: 0
                };
            }),
            clearNotifications: () => set({ notifications: [], unreadCount: 0 }),
            hydrateFromDb: (dbNotifications) => set((state) => {
                const dbIds = new Set(dbNotifications.map((n) => n.id));
                const merged = [...dbNotifications, ...state.notifications.filter((n) => !dbIds.has(n.id))];
                merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                const updated = merged.slice(0, 50);
                return { notifications: updated, unreadCount: updated.filter((n) => !n.isRead).length };
            }),
        }),
        {
            name: 'imporfrut-notifications',
        }
    )
);
