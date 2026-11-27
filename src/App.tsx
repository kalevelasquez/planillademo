import { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { RootGate } from './ui/components/RootGate';
import { TableSkeleton } from './ui/components/Skeleton';
import ReloadPrompt from './ui/components/ReloadPrompt';

/**
 * Router delgado. Cada shell se carga lazy y trae su propio cliente Supabase:
 *  - "/"            gate interino (RootGate) hasta que B4 monte la landing en PublicApp
 *  - /tienda, /cuenta (B4/C2): PublicApp lazy, SIN bootstrap admin
 *  - todo lo demas  AdminApp lazy (dashboard en /inicio; el resto de rutas admin sin cambios)
 *
 * El bootstrap admin (perfil, permisos, notificaciones) vive SOLO en AdminApp: un visitante en
 * "/" nunca lo dispara. ReloadPrompt (PWA) es global.
 */
const AdminApp = lazyWithRetry(() => import('./AdminApp'));

export function AppRoutes() {
  return (
    <>
      <Routes>
        {/* TODO(B4): <Route element={<PublicApp />}> con "/", "/tienda/*" y "/cuenta/*" */}
        <Route path="/" element={<RootGate />} />
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
