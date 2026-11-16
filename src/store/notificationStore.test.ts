import { describe, it, expect, beforeEach, vi } from 'vitest';

// El store usa zustand/persist (localStorage) — no es lo que este test ejercita (eso es
// lógica de reducer pura), y jsdom en este entorno no deja `setItem` disponible a tiempo
// para el middleware. Se reemplaza `persist` por passthrough, igual que se haría para
// aislar cualquier otro middleware de infraestructura al testear la lógica del store.
vi.mock('zustand/middleware', async () => {
    const actual = await vi.importActual<typeof import('zustand/middleware')>('zustand/middleware');
    return { ...actual, persist: (config: unknown) => config };
});

const { useNotificationStore } = await import('./notificationStore');
type Notification = import('./notificationStore').Notification;

function makeNotif(overrides: Partial<Notification> = {}): Notification {
    return {
        id: 'n1', title: 'Título', message: 'Mensaje', type: 'system',
        createdAt: '2026-01-01T00:00:00Z', isRead: false,
        ...overrides,
    };
}

describe('notificationStore.hydrateFromDb (US-CIE-04 / IMPL-127)', () => {
    beforeEach(() => {
        useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    });

    it('agrega notificaciones de la DB al store vacío y recalcula unreadCount', () => {
        useNotificationStore.getState().hydrateFromDb([
            makeNotif({ id: 'q1', isRead: false }),
            makeNotif({ id: 'q2', isRead: true }),
        ]);

        const { notifications, unreadCount } = useNotificationStore.getState();
        expect(notifications).toHaveLength(2);
        expect(unreadCount).toBe(1);
    });

    it('no duplica una notificación que ya existía en el store (por id) — la versión de la DB gana', () => {
        useNotificationStore.setState({
            notifications: [makeNotif({ id: 'q1', isRead: false, title: 'Vieja' })],
            unreadCount: 1,
        });

        useNotificationStore.getState().hydrateFromDb([makeNotif({ id: 'q1', isRead: true, title: 'Actualizada' })]);

        const { notifications, unreadCount } = useNotificationStore.getState();
        expect(notifications).toHaveLength(1);
        expect(notifications[0].title).toBe('Actualizada');
        expect(unreadCount).toBe(0);
    });

    it('mezcla notificaciones de la DB con las que ya llegaron por otra vía (ej. Pedidos, 100% local) sin pisarlas', () => {
        useNotificationStore.setState({
            notifications: [makeNotif({ id: 'local-1', type: 'order_approved', isRead: false })],
            unreadCount: 1,
        });

        useNotificationStore.getState().hydrateFromDb([makeNotif({ id: 'q1', type: 'quincena_enviada_aprobacion', isRead: false })]);

        const { notifications, unreadCount } = useNotificationStore.getState();
        expect(notifications.map((n) => n.id).sort()).toEqual(['local-1', 'q1']);
        expect(unreadCount).toBe(2);
    });

    it('ordena por createdAt descendente después de mezclar', () => {
        useNotificationStore.setState({
            notifications: [makeNotif({ id: 'viejo', createdAt: '2026-01-01T00:00:00Z' })],
            unreadCount: 1,
        });

        useNotificationStore.getState().hydrateFromDb([makeNotif({ id: 'nuevo', createdAt: '2026-06-01T00:00:00Z' })]);

        const { notifications } = useNotificationStore.getState();
        expect(notifications.map((n) => n.id)).toEqual(['nuevo', 'viejo']);
    });
});
