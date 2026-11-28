import { useCallback, useEffect, useState } from 'react';
import { listMyOrders, type MyOrder } from '../../../../services/storeService';

export type MyOrdersStatus = 'loading' | 'ready' | 'error';

interface Settled {
    key: number;
    status: Exclude<MyOrdersStatus, 'loading'>;
    orders: MyOrder[];
}

/** Pedidos del cliente autenticado (RPC `store_list_my_orders`). `loading` se deriva. */
export function useMyOrders() {
    const [attempt, setAttempt] = useState(0);
    const [settled, setSettled] = useState<Settled | null>(null);

    useEffect(() => {
        let cancelled = false;
        listMyOrders()
            .then((orders) => {
                if (!cancelled) setSettled({ key: attempt, status: 'ready', orders });
            })
            .catch(() => {
                if (!cancelled) setSettled({ key: attempt, status: 'error', orders: [] });
            });
        return () => {
            cancelled = true;
        };
    }, [attempt]);

    const reload = useCallback(() => setAttempt((n) => n + 1), []);
    const isCurrent = settled?.key === attempt;

    return {
        status: (isCurrent ? settled.status : 'loading') as MyOrdersStatus,
        orders: isCurrent ? settled.orders : [],
        reload,
    };
}
