# Public Storefront Routing Specification (F1)

## Purpose

Shell público (landing, tienda, cuenta) separado del shell admin, dashboard en `/inicio`, PWA ajustada y sesiones aisladas.

## Requirements

### Requirement: Mapa de rutas

El sistema MUST servir `/` como landing, `/tienda` como catálogo, `/cuenta` como cuenta de cliente e `/inicio` como dashboard admin. Las demás rutas admin MUST permanecer sin cambios.

#### Scenario: Landing pública
- GIVEN un visitante anon
- WHEN abre `/`
- THEN ve la landing sin disparar bootstrap admin ni redirect a login

#### Scenario: Dashboard movido
- GIVEN un usuario interno autenticado
- WHEN abre `/inicio`
- THEN ve el dashboard

#### Scenario: Rutas admin intactas
- GIVEN un usuario interno con permiso
- WHEN abre `/inventario` (u otra ruta admin existente)
- THEN se renderiza igual que antes

#### Scenario: Admin sin sesión
- GIVEN un visitante anon
- WHEN abre una ruta admin (ej. `/inicio`)
- THEN es redirigido a `/login`
- AND tras login interno vuelve a la ruta pedida

#### Scenario: Cliente de tienda en ruta admin
- GIVEN un cliente autenticado sin `user_profiles`
- WHEN abre una ruta admin
- THEN no ve datos admin y es redirigido (login/tienda)

### Requirement: PublicApp aislado y lazy

El shell público MUST cargarse con lazy loading y MUST NOT ejecutar el bootstrap admin (perfil, permisos, notificaciones).

#### Scenario: Sin bootstrap admin
- GIVEN un visitante en `/tienda`
- WHEN carga la página
- THEN no se consultan `user_profiles`, permisos ni `notificaciones`

### Requirement: Aislamiento de sesión

La tienda MUST usar un cliente Supabase con `storageKey` propia, distinta del cliente admin.

#### Scenario: Cliente y vendedor en el mismo navegador
- GIVEN un vendedor con sesión admin activa
- WHEN un cliente inicia sesión en `/cuenta`
- THEN la sesión admin no cambia y viceversa
- AND cerrar sesión en uno no cierra el otro

### Requirement: PWA

Los chunks admin MUST excluirse del precache (prefijo de `manualChunks` + `globIgnores`) y SHOULD cachearse en runtime. El manifest MUST usar `start_url:'/inicio'`. `devOptions` MUST estar apagado.

#### Scenario: Precache sin admin
- GIVEN la config PWA
- WHEN se evalúa la configuración
- THEN `globIgnores` cubre el prefijo de chunks admin y `start_url` es `/inicio`

#### Scenario: Instalación como app
- GIVEN un vendedor abre la PWA instalada
- WHEN arranca
- THEN aterriza en `/inicio`

### Requirement: Contacto comercial

`brand.ts` MUST NOT exponer email/teléfono personales en la landing; MUST usar valores de contacto comercial configurables. Valores provisionales: `ventas@teknergy.com` y teléfono placeholder, a reemplazar.

#### Scenario: Landing sin datos personales
- GIVEN la landing renderizada
- WHEN se inspecciona el contacto
- THEN muestra el contacto comercial de `brand.ts` y ningún dato personal previo
