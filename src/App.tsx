import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { authService, supabase } from './services/authService';
import { Logger } from './utils/logger';
import { FORCE_REFRESH_FLAG } from './utils/chunkImportRetry';

// --- Utilería de Resiliencia para Lazy Loading (UX-Ajuste) ---
// Mismo flag que `importWithRetry` (chunkImportRetry.ts) — un solo reload por sesión ante un
// chunk fallido, sin importar si lo disparó una vista lazy o un import dinámico suelto (ej. el
// generador de reportes Word).
const lazyWithRetry = <T extends React.ComponentType<any>>(componentImport: () => Promise<{ default: T }>) =>
  lazy(async () => {
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.localStorage.getItem(FORCE_REFRESH_FLAG) || 'false'
    );

    try {
      const module = await componentImport();
      if (!module || !module.default) {
        throw new Error('Module default export not found');
      }
      return module;
    } catch (error) {
      if (!pageHasAlreadyBeenForceRefreshed) {
        window.localStorage.setItem(FORCE_REFRESH_FLAG, 'true');
        window.location.reload();
        // Return a never-resolving promise to allow the browser to reload without React crashing
        return new Promise<{ default: T }>(() => { });
      }
      Logger.error('Fallo crítico al cargar vista (ChunkLoadError)', { path: window.location.pathname }, error);
      throw error;
    }
  });

// --- Lazy Loading de Vistas (US-PER-01 CA3) ---
// --- Lazy Loading de Vistas con Resiliencia ---
const LoginView = lazyWithRetry(() => import('./ui/features/auth/LoginView').then(m => ({ default: m.LoginView })));
const ForgotPasswordView = lazyWithRetry(() => import('./ui/features/auth/ForgotPasswordView').then(m => ({ default: m.ForgotPasswordView })));
const ResetPasswordView = lazyWithRetry(() => import('./ui/features/auth/ResetPasswordView').then(m => ({ default: m.ResetPasswordView })));
const SetupAccountView = lazyWithRetry(() => import('./ui/features/auth/SetupAccountView').then(m => ({ default: m.SetupAccountView })));
const ForcePasswordChangeView = lazyWithRetry(() => import('./ui/features/auth/ForcePasswordChangeView').then(m => ({ default: m.ForcePasswordChangeView })));

const MainLayout = lazyWithRetry(() => import('./ui/layout/MainLayout').then(m => ({ default: m.MainLayout })));
const DashboardView = lazyWithRetry(() => import('./ui/features/reports/DashboardView').then(m => ({ default: m.DashboardView })));
const CustomerListView = lazyWithRetry(() => import('./ui/features/customers/CustomerListView').then(m => ({ default: m.CustomerListView })));
const CatalogView = lazyWithRetry(() => import('./ui/features/orders/CatalogView').then(m => ({ default: m.CatalogView })));
const OrderSummaryView = lazyWithRetry(() => import('./ui/features/orders/OrderSummaryView').then(m => ({ default: m.OrderSummaryView })));
const OrderListView = lazyWithRetry(() => import('./ui/features/orders/OrderListView').then(m => ({ default: m.OrderListView })));
const OrderDetailView = lazyWithRetry(() => import('./ui/features/orders/OrderDetailView').then(m => ({ default: m.OrderDetailView })));
const ProductManagementView = lazyWithRetry(() => import('./ui/features/products/ProductManagementView').then(m => ({ default: m.ProductManagementView })));
const DispatcherDashboard = lazyWithRetry(() => import('./ui/features/dispatch/DispatcherDashboard').then(m => ({ default: m.DispatcherDashboard })));
const TeamView = lazyWithRetry(() => import('./ui/features/team/TeamView').then(m => ({ default: m.TeamView })));
const ProfileView = lazyWithRetry(() => import('./ui/features/profile/ProfileView').then(m => ({ default: m.ProfileView })));
const SettingsView = lazyWithRetry(() => import('./ui/features/settings/SettingsView').then(m => ({ default: m.SettingsView })));
const UserManagementView = lazyWithRetry(() => import('./ui/features/admin/UserManagementView').then(m => ({ default: m.UserManagementView })));
const RoleMatrixView = lazyWithRetry(() => import('./ui/features/admin/RoleMatrixView').then(m => ({ default: m.RoleMatrixView })));
const RoleManagementView = lazyWithRetry(() => import('./ui/features/admin/RoleManagementView').then(m => ({ default: m.RoleManagementView })));
const AuditLogView = lazyWithRetry(() => import('./ui/features/admin/AuditLogView').then(m => ({ default: m.AuditLogView })));
const ReportExplorerView = lazyWithRetry(() => import('./ui/features/reports/ReportExplorerView').then(m => ({ default: m.ReportExplorerView })));
const MonitoringView = lazyWithRetry(() => import('./ui/features/admin/MonitoringView').then(m => ({ default: m.MonitoringView })));
const DesignSystemView = lazyWithRetry(() => import('./ui/features/dev/DesignSystemView').then(m => ({ default: m.DesignSystemView })));
const EmpleadosListView = lazyWithRetry(() => import('./ui/features/planilla/EmpleadosListView').then(m => ({ default: m.EmpleadosListView })));
const EmpleadoDetailView = lazyWithRetry(() => import('./ui/features/planilla/EmpleadoDetailView').then(m => ({ default: m.EmpleadoDetailView })));
const PlanillaHomeView = lazyWithRetry(() => import('./ui/features/planilla/PlanillaHomeView').then(m => ({ default: m.PlanillaHomeView })));
const FeriadosConfigView = lazyWithRetry(() => import('./ui/features/planilla/FeriadosConfigView').then(m => ({ default: m.FeriadosConfigView })));
const HistorialQuincenasView = lazyWithRetry(() => import('./ui/features/planilla/HistorialQuincenasView').then(m => ({ default: m.HistorialQuincenasView })));
const QuincenaDetalleView = lazyWithRetry(() => import('./ui/features/planilla/QuincenaDetalleView').then(m => ({ default: m.QuincenaDetalleView })));
const UbicacionesConfigView = lazyWithRetry(() => import('./ui/features/planilla/UbicacionesConfigView').then(m => ({ default: m.UbicacionesConfigView })));
const DepartamentosConfigView = lazyWithRetry(() => import('./ui/features/planilla/DepartamentosConfigView').then(m => ({ default: m.DepartamentosConfigView })));
const CargosConfigView = lazyWithRetry(() => import('./ui/features/planilla/CargosConfigView').then(m => ({ default: m.CargosConfigView })));
const BancosConfigView = lazyWithRetry(() => import('./ui/features/planilla/BancosConfigView').then(m => ({ default: m.BancosConfigView })));
const TiposContratoConfigView = lazyWithRetry(() => import('./ui/features/planilla/TiposContratoConfigView').then(m => ({ default: m.TiposContratoConfigView })));
const HorasExtrasView = lazyWithRetry(() => import('./ui/features/planilla/HorasExtrasView').then(m => ({ default: m.HorasExtrasView })));
const JornadasConfigView = lazyWithRetry(() => import('./ui/features/planilla/JornadasConfigView').then(m => ({ default: m.JornadasConfigView })));
const ViaticosView = lazyWithRetry(() => import('./ui/features/planilla/ViaticosView').then(m => ({ default: m.ViaticosView })));
const TarifasKmConfigView = lazyWithRetry(() => import('./ui/features/planilla/TarifasKmConfigView').then(m => ({ default: m.TarifasKmConfigView })));
const LavadoGasolinaConfigView = lazyWithRetry(() => import('./ui/features/planilla/LavadoGasolinaConfigView').then(m => ({ default: m.LavadoGasolinaConfigView })));
const DestinosConfigView = lazyWithRetry(() => import('./ui/features/planilla/DestinosConfigView').then(m => ({ default: m.DestinosConfigView })));
const EmpresaConfigView = lazyWithRetry(() => import('./ui/features/planilla/EmpresaConfigView').then(m => ({ default: m.EmpresaConfigView })));
const IncapacidadesView = lazyWithRetry(() => import('./ui/features/planilla/IncapacidadesView').then(m => ({ default: m.IncapacidadesView })));
const AnticiposView = lazyWithRetry(() => import('./ui/features/planilla/AnticiposView').then(m => ({ default: m.AnticiposView })));
const DescuentosView = lazyWithRetry(() => import('./ui/features/planilla/DescuentosView').then(m => ({ default: m.DescuentosView })));
const VacacionesView = lazyWithRetry(() => import('./ui/features/planilla/VacacionesView').then(m => ({ default: m.VacacionesView })));
const PermisosView = lazyWithRetry(() => import('./ui/features/planilla/PermisosView').then(m => ({ default: m.PermisosView })));
const OtrosIngresosConceptosConfigView = lazyWithRetry(() => import('./ui/features/planilla/OtrosIngresosConceptosConfigView').then(m => ({ default: m.OtrosIngresosConceptosConfigView })));
const DescuentoCategoriasConfigView = lazyWithRetry(() => import('./ui/features/planilla/DescuentoCategoriasConfigView').then(m => ({ default: m.DescuentoCategoriasConfigView })));
const TablasIncentivosConfigView = lazyWithRetry(() => import('./ui/features/planilla/TablasIncentivosConfigView').then(m => ({ default: m.TablasIncentivosConfigView })));
const OtrosIngresosView = lazyWithRetry(() => import('./ui/features/planilla/OtrosIngresosView').then(m => ({ default: m.OtrosIngresosView })));
const BonificacionesView = lazyWithRetry(() => import('./ui/features/planilla/BonificacionesView').then(m => ({ default: m.BonificacionesView })));
const CalculoPlanillaView = lazyWithRetry(() => import('./ui/features/planilla/CalculoPlanillaView').then(m => ({ default: m.CalculoPlanillaView })));
const ExportacionesContablesView = lazyWithRetry(() => import('./ui/features/planilla/ExportacionesContablesView').then(m => ({ default: m.ExportacionesContablesView })));
const ReportesPlanillaView = lazyWithRetry(() => import('./ui/features/planilla/ReportesPlanillaView').then(m => ({ default: m.ReportesPlanillaView })));
const PermisosMatrixView = lazyWithRetry(() => import('./ui/features/planilla/PermisosMatrixView').then(m => ({ default: m.PermisosMatrixView })));
const GoLiveChecklistView = lazyWithRetry(() => import('./ui/features/planilla/GoLiveChecklistView').then(m => ({ default: m.GoLiveChecklistView })));
const ConfiguracionLayout = lazyWithRetry(() => import('./ui/features/planilla/ConfiguracionLayout').then(m => ({ default: m.ConfiguracionLayout })));
const AsistenteIaView = lazyWithRetry(() => import('./ui/features/planilla/AsistenteIaView').then(m => ({ default: m.AsistenteIaView })));
const PlanillaLayout = lazyWithRetry(() => import('./ui/features/planilla/PlanillaLayout').then(m => ({ default: m.PlanillaLayout })));

// Componentes Síncronos y UI
import { NetworkStatusBanner } from './ui/components/NetworkStatusBanner';
import { ProtectedRoute } from './ui/components/ProtectedRoute';
import { ROLES } from './config/constants';
import { TableSkeleton } from './ui/components/Skeleton';
import ReloadPrompt from './ui/components/ReloadPrompt';

import BrandLogo from './assets/images/logo-imporfrut.png';

function AppContent() {
  const navigate = useNavigate();
  const { profile, isLoading, setAuth, logout, stopLoading } = useAuthStore();
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let authSubscription: any = null;

    const initAuth = async () => {
      // 0. Interceptar errores en el URL (ej: reset password link caducado)
      const hash = window.location.hash;
      if (hash && hash.includes('error=')) {
        const params = new URLSearchParams(hash.substring(1));
        const errorCode = params.get('error_code');

        if (errorCode === 'otp_expired') {
          setAuthError('El enlace ha expirado o ya fue utilizado. Por favor solicita uno nuevo.');
        } else {
          const errorDesc = params.get('error_description')?.replace(/\+/g, ' ');
          setAuthError(`Error de autenticación: ${errorDesc || 'Token inválido'}`);
        }

        window.location.hash = '';
        await authService.logout().catch(() => null);
        logout();
        stopLoading();
        return;
      }

      // 1. Verificación inicial consolidada (US-PERF-01) con Timeout de 10s
      try {
        const data = await authService.getBootstrapData();
        if (data) {
          setAuth(data.profile, data.permissions, data.serverTime);
        } else {
          logout();
        }
      } catch (error) {
        Logger.error('Fallo crítico en Bootstrap Inicial (Timeout o Red)', { path: window.location.pathname }, error);
        // No cerramos sesión inmediatamente para permitir reintentos manuales si es solo lag
        stopLoading();
      }

      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        // US-PERF-01/RES: Filtrar eventos para evitar "Re-bootstrap" innecesario
        const currentProfile = useAuthStore.getState().profile;

        if (event === 'TOKEN_REFRESHED' && currentProfile) {
          // Solo actualizamos si el token cambió pero no hace falta pedir todos los permisos de nuevo
          return;
        }

        // INITIAL_SESSION se maneja por el flujo síncrono initAuth superior
        if (event === ("INITIAL_SESSION" as any)) return;

        if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
          try {
            const bootstrap = await authService.getBootstrapData();
            if (bootstrap) {
              setAuth(bootstrap.profile, bootstrap.permissions, bootstrap.serverTime);
            }
          } catch (err) {
            Logger.warn('Fallo al refrescar datos tras cambio de estado auth', { event }, err);
          }
        } else if (event === 'SIGNED_OUT') {
          logout();
        }
      });

      authSubscription = data.subscription;
    };

    initAuth();
    // US-PERF-01/RES: La re-validación proactiva se deja al listener de onAuthStateChange 
    // y al timer interno de Supabase para evitar "falsos positivos" de cierre de sesión en red inestable.

    return () => {
      if (authSubscription) authSubscription.unsubscribe();
    };
  }, [setAuth, logout, stopLoading]);

  // --- GUARDIÁN DE PERFIL CENTRALIZADO (Realtime + Kill-Switch) ---
  useEffect(() => {
    if (!profile?.id) return;

    // Reset de resiliencia de chunks cuando ya estamos autenticados y navegando
    window.localStorage.removeItem(FORCE_REFRESH_FLAG);

    const subscription = supabase
      .channel(`central-profile-sync:${profile.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_profiles',
        filter: `id=eq.${profile.id}`
      }, async (payload: { new: any }) => {
        const updatedData = payload.new;

        // Lógica de Kill-Switch (Seguridad Crítica)
        if (updatedData.is_active === false) {
          Logger.warn('[KILL-SWITCH] Cuenta inactiva detectada por Realtime. Expulsando usuario.');
          logout();
          await authService.logout().catch(() => null);
          return;
        }

        // Sincronización proactiva de roles y datos
        const rawRoles = updatedData.role || [];
        const roleArray = Array.isArray(rawRoles) ? rawRoles : [rawRoles];

        setAuth({
          ...profile,
          full_name: updatedData.full_name,
          phone: updatedData.phone,
          is_active: updatedData.is_active,
          role: roleArray[0] || '',
          roles: roleArray,
        });
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [profile?.id, setAuth, logout]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <img src={BrandLogo} alt="Logo ImporFrut" className="h-32 w-auto mb-lg object-contain" />
          <p className="text-text-secondary text-[10px] font-bold uppercase tracking-[0.2em]">
            Cargando Plataforma...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        {/* Rutas Públicas */}
        <Route path="/login" element={
          !profile ? <LoginView onForgotPassword={() => navigate('/forgot-password')} initialError={authError} /> : <Navigate to="/" replace />
        } />
        <Route path="/forgot-password" element={<ForgotPasswordView onBackToLogin={() => navigate('/login')} />} />
        <Route path="/reset-password" element={<ResetPasswordView />} />
        <Route path="/setup-account" element={<SetupAccountView onComplete={() => navigate('/login')} />} />
        <Route path="/force-password-change" element={
          profile?.needs_password_change ? <ForcePasswordChangeView /> : <Navigate to="/" replace />
        } />

        {/* Rutas Protegidas (Con Layout) */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Suspense fallback={<TableSkeleton />}>
                <MainLayout />
              </Suspense>
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardView />} />

          <Route path="/clientes" element={<CustomerListView onStartOrder={() => navigate('/catalogo')} />} />
          <Route path="/catalogo" element={<CatalogView onBack={() => navigate('/clientes')} onCheckout={() => navigate('/resumen-pedido')} />} />
          <Route path="/resumen-pedido" element={<OrderSummaryView onBack={() => navigate('/catalogo')} onHome={() => navigate('/')} onNewOrder={() => navigate('/clientes')} />} />
          <Route path="/pedidos" element={<OrderListView onResumeDraft={() => navigate('/resumen-pedido')} onViewDetail={(order: any) => navigate(`/pedidos/${order.id}`)} />} />
          <Route path="/pedidos/:id" element={<OrderDetailView />} />
          <Route path="/despacho/:id" element={<OrderDetailView isDispatchView={true} />} />
          <Route path="/inventario" element={<ProductManagementView />} />
          <Route path="/despacho" element={<DispatcherDashboard />} />
          <Route path="/administrar/usuarios" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.SUPERVISOR]}><UserManagementView /></ProtectedRoute>} />
          <Route path="/administrar/roles" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.SUPERVISOR]}><RoleManagementView /></ProtectedRoute>} />
          <Route path="/administrar/roles/:roleName" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.SUPERVISOR]}><RoleMatrixView /></ProtectedRoute>} />
          <Route path="/administrar/auditoria" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.SUPERVISOR]}><AuditLogView /></ProtectedRoute>} />
          <Route path="/administrar/monitoreo" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.SUPERVISOR]}><MonitoringView /></ProtectedRoute>} />
          <Route path="/administrar/reportes" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.SUPERVISOR]}><ReportExplorerView /></ProtectedRoute>} />
          {/* Páginas de detalle/alta de foco único — fuera de PlanillaLayout a propósito, ver su comentario */}
          <Route path="/planilla/empleados/nuevo" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><EmpleadoDetailView /></ProtectedRoute>} />
          <Route path="/planilla/empleados/:id" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><EmpleadoDetailView /></ProtectedRoute>} />
          <Route path="/planilla/historial/:id" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><QuincenaDetalleView /></ProtectedRoute>} />

          {/* Páginas "módulo" de Planilla — comparten el submenú persistente de PlanillaLayout (US-QNA-00) */}
          <Route path="/planilla" element={<PlanillaLayout />}>
            <Route index element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><PlanillaHomeView /></ProtectedRoute>} />
            <Route path="empleados" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><EmpleadosListView /></ProtectedRoute>} />
            <Route path="historial" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><HistorialQuincenasView /></ProtectedRoute>} />
            <Route path="horas-extras" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><HorasExtrasView /></ProtectedRoute>} />
            <Route path="viaticos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><ViaticosView /></ProtectedRoute>} />
            <Route path="incapacidades" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><IncapacidadesView /></ProtectedRoute>} />
            <Route path="anticipos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><AnticiposView /></ProtectedRoute>} />
            <Route path="descuentos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><DescuentosView /></ProtectedRoute>} />
            <Route path="vacaciones" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><VacacionesView /></ProtectedRoute>} />
            <Route path="permisos-empleados" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><PermisosView /></ProtectedRoute>} />
            <Route path="otros-ingresos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><OtrosIngresosView /></ProtectedRoute>} />
            <Route path="bonificaciones" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><BonificacionesView /></ProtectedRoute>} />
            <Route path="calculo" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><CalculoPlanillaView /></ProtectedRoute>} />
            <Route path="exportaciones" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><ExportacionesContablesView /></ProtectedRoute>} />
            <Route path="reportes" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA]}><ReportesPlanillaView /></ProtectedRoute>} />
            <Route path="permisos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><PermisosMatrixView /></ProtectedRoute>} />
            <Route path="configuracion" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><ConfiguracionLayout /></ProtectedRoute>}>
              <Route index element={<Navigate to="empresa" replace />} />
              <Route path="empresa" element={<EmpresaConfigView />} />
              <Route path="ubicaciones" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><UbicacionesConfigView /></ProtectedRoute>} />
              <Route path="departamentos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><DepartamentosConfigView /></ProtectedRoute>} />
              <Route path="cargos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><CargosConfigView /></ProtectedRoute>} />
              <Route path="bancos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><BancosConfigView /></ProtectedRoute>} />
              <Route path="tipos-contrato" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><TiposContratoConfigView /></ProtectedRoute>} />
              <Route path="jornadas" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><JornadasConfigView /></ProtectedRoute>} />
              <Route path="tarifas-km" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><TarifasKmConfigView /></ProtectedRoute>} />
              <Route path="lavado-gasolina" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><LavadoGasolinaConfigView /></ProtectedRoute>} />
              <Route path="destinos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><DestinosConfigView /></ProtectedRoute>} />
              <Route path="otros-ingresos-conceptos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><OtrosIngresosConceptosConfigView /></ProtectedRoute>} />
              <Route path="descuento-categorias" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><DescuentoCategoriasConfigView /></ProtectedRoute>} />
              <Route path="tablas-incentivos" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><TablasIncentivosConfigView /></ProtectedRoute>} />
              <Route path="feriados" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><FeriadosConfigView /></ProtectedRoute>} />
            </Route>
            <Route path="go-live" element={<ProtectedRoute requiredRole={[ROLES.ADMIN]}><GoLiveChecklistView /></ProtectedRoute>} />
            <Route path="asistente" element={<ProtectedRoute requiredRole={[ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA]}><AsistenteIaView /></ProtectedRoute>} />
          </Route>
          <Route path="/equipo" element={<TeamView />} />
          <Route path="/perfil" element={<ProfileView />} />
          <Route path="/configuracion" element={<SettingsView />} />

          {import.meta.env.DEV && <Route path="/design-system" element={<DesignSystemView />} />}
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NetworkStatusBanner />
      <ReloadPrompt />

    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
