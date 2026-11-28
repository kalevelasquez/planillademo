import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { RootGate } from './ui/components/RootGate';
import { TableSkeleton } from './ui/components/Skeleton';
import ReloadPrompt from './ui/components/ReloadPrompt';
import { ROUTES, hasAuthLinkParams } from './config/storePaths';
import { StoreAuthGuard } from './ui/features/store/components/StoreAuthGuard';

/**
 * Router delgado. Cada shell se carga lazy y trae su propio cliente Supabase:
 *  - "/", /tienda/*, /cuenta/*    PublicApp lazy (landing, catalogo, carrito, checkout, cuenta), SIN bootstrap admin
 *  - todo lo demas                 AdminApp lazy (dashboard en /inicio; rutas admin sin cambios)
 *
 * Excepcion en "/": si la URL trae un enlace de email de Supabase del flujo admin (invitacion,
 * recovery, errores `otp_expired`... ver `hasAuthLinkParams`), no se muestra la landing: el gate
 * `RootGate` lo entrega al flujo admin conservando search y hash.
 *
 * El bootstrap admin (perfil, permisos, notificaciones) vive SOLO en AdminApp: un visitante en
 * "/" nunca lo dispara. ReloadPrompt (PWA) es global.
 */
const AdminApp = lazyWithRetry(() => import('./AdminApp'));
const PublicApp = lazyWithRetry(() => import('./ui/features/store/PublicApp'));
const LandingPage = lazyWithRetry(() => import('./ui/features/store/pages/LandingPage'));
const CatalogPage = lazyWithRetry(() => import('./ui/features/store/pages/CatalogPage'));
const ProductDetailPage = lazyWithRetry(() => import('./ui/features/store/pages/ProductDetailPage'));
const CartPage = lazyWithRetry(() => import('./ui/features/store/pages/CartPage'));
const CheckoutPage = lazyWithRetry(() => import('./ui/features/store/pages/CheckoutPage'));
const AccountPage = lazyWithRetry(() => import('./ui/features/store/pages/AccountPage'));
const RegisterPage = lazyWithRetry(() => import('./ui/features/store/pages/RegisterPage'));
const EmailConfirmedPage = lazyWithRetry(() => import('./ui/features/store/pages/EmailConfirmedPage'));
const MyOrdersPage = lazyWithRetry(() => import('./ui/features/store/pages/MyOrdersPage'));

const ShellFallback = () => (
  <div role="status" className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary" />
  </div>
);

function PublicShell() {
  const location = useLocation();
  if (location.pathname === ROUTES.LANDING && hasAuthLinkParams(location)) return <RootGate />;
  return (
    <Suspense fallback={<ShellFallback />}>
      <PublicApp />
    </Suspense>
  );
}

export function AppRoutes() {
  return (
    <>
      <Routes>
        <Route element={<PublicShell />}>
          <Route path={ROUTES.LANDING} element={<LandingPage />} />
          <Route path={ROUTES.STORE} element={<CatalogPage />} />
          <Route path={`${ROUTES.STORE}/p/:productKey`} element={<ProductDetailPage />} />
          <Route path={`${ROUTES.STORE}/carrito`} element={<CartPage />} />
          <Route path={ROUTES.ACCOUNT} element={<AccountPage />} />
          <Route path={`${ROUTES.ACCOUNT}/registro`} element={<RegisterPage />} />
          <Route path={`${ROUTES.ACCOUNT}/confirmado`} element={<EmailConfirmedPage />} />
          <Route element={<StoreAuthGuard />}>
            <Route path={`${ROUTES.STORE}/checkout`} element={<CheckoutPage />} />
            <Route path={`${ROUTES.ACCOUNT}/pedidos`} element={<MyOrdersPage />} />
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <Suspense fallback={<TableSkeleton />}>
              <AdminApp />
            </Suspense>
          }
        />
      </Routes>
      <ReloadPrompt />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
