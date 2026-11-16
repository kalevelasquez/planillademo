import { supabase } from '../config/supabaseClient';
import { normalizarTexto } from '../utils/fuzzyMatchUtils';
import type { EmpleadoImportListo } from '../utils/empleadosExcelUtils';

export interface Empleado {
    id: string;
    tenant_id: string;
    codigo: string;
    // IMPL-120: código de negocio de captura manual (numeración histórica real de Imporfrut),
    // distinto de `codigo` (auto-generado) y `codigo_reloj_marcador` (reloj checador).
    codigo_empleado_manual: string | null;
    nombre_completo: string;
    dui: string | null;
    nit: string | null;
    nup: string | null;
    /** Alternativa al DUI para empleados extranjeros (2026-10-15) — el formulario exige al
     * menos uno de los dos, nunca ambos vacíos. */
    pasaporte: string | null;
    fecha_nacimiento: string | null;
    sexo: 'M' | 'F' | null;
    telefono: string;
    correo: string | null;
    direccion: string | null;
    contacto_emergencia_nombre: string | null;
    contacto_emergencia_telefono: string | null;
    cargo: string | null;
    departamento: string | null;
    sucursal: string | null;
    centro_costos: string | null;
    fecha_ingreso: string;
    sueldo_mensual: number | null;
    tipo_afiliacion: 'afp_crecer' | 'afp_confia' | 'upiss' | 'jubilado' | 'ipsfa' | null;
    numero_afiliacion_afp: string | null;
    /** IMPL-99, columna 7 de la Planilla Única ISSS/AFP. `null` hasta que se capture. */
    numero_afiliado_isss: string | null;
    retencion_especial_viatico: boolean;
    es_gerente_general: boolean;
    banco: string | null;
    numero_cuenta: string | null;
    estado: 'activo' | 'inactivo' | 'liquidado';
    tipo_contrato: string | null;
    foto_url: string | null;
    codigo_reloj_marcador: string | null;
    ubicacion_id: string | null;
    created_at: string;
    deleted_at: string | null;
}

export interface EmpleadoFilters {
    estado?: 'activo' | 'inactivo' | 'liquidado';
}

export interface GetEmpleadosResult {
    data: Empleado[];
    total: number;
}

export type CreateEmpleadoDTO = Omit<Empleado, 'id' | 'codigo' | 'created_at' | 'deleted_at'>;
export type UpdateEmpleadoDTO = Partial<Omit<CreateEmpleadoDTO, 'tenant_id'>>;

export interface Indemnizacion {
    id: string;
    tenant_id: string;
    empleado_id: string;
    fecha: string;
    motivo: string | null;
    created_at: string;
}

export type DocumentoTipo = 'dui' | 'afp' | 'isss' | 'incapacidad' | 'amonestacion' | 'constancia' | 'liquidacion' | 'anticipo';

export interface EmpleadoDocumento {
    id: string;
    tenant_id: string;
    empleado_id: string;
    tipo: DocumentoTipo;
    storage_path: string;
    nombre_archivo: string;
    tamano_bytes: number | null;
    mime_type: string | null;
    origen: 'manual' | 'anticipo';
    uploaded_by: string | null;
    created_at: string;
}

const DOCUMENTOS_BUCKET = 'planilla_empleado_documentos';

export interface EmpleadosIndicadores {
    total: number;
    activos: number;
    inactivos: number;
    nuevos: number; // altas dentro del período de la quincena seleccionada (CA5, IMPL-2 — revisión épica por épica)
}

export interface PeriodoQuincena {
    fechaInicio: string;
    fechaFin: string;
}

export const PAGE_SIZE = 20;
// Fallback cuando todavía no hay ninguna quincena creada (tenant nuevo) — CA5 pide el período de
// la quincena seleccionada, pero sin quincenas no hay período que usar.
const NUEVOS_DIAS_FALLBACK = 30;

export const planillaEmpleadosService = {
    /**
     * Obtiene la lista de empleados con paginación y búsqueda.
     * El filtro por tenant_id se aplica automáticamente por RLS.
     */
    async getEmpleados(
        page: number = 1,
        searchQuery: string = '',
        filters?: EmpleadoFilters,
        limit: number = PAGE_SIZE
    ): Promise<GetEmpleadosResult> {
        let query = supabase
            .from('planilla_empleados')
            .select('*', { count: 'exact' });

        if (searchQuery.trim()) {
            const term = `%${searchQuery.trim()}%`;
            query = query.or(`nombre_completo.ilike.${term},cargo.ilike.${term},departamento.ilike.${term},codigo.ilike.${term},codigo_empleado_manual.ilike.${term}`);
        }

        if (filters?.estado) {
            query = query.eq('estado', filters.estado);
        }

        query = query.is('deleted_at', null).order('nombre_completo', { ascending: true });

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data, error, count } = await query.range(from, to);

        if (error) throw error;
        return { data: data || [], total: count ?? 0 };
    },

    /**
     * Indicadores del panel: Total, Activos, Inactivos, Nuevos.
     * "Nuevos" cuenta altas dentro del período de `periodo` (quincena seleccionada en la UI); sin
     * `periodo` (todavía no hay quincenas creadas) cae a una ventana fija de 30 días.
     */
    async getIndicadores(periodo?: PeriodoQuincena): Promise<EmpleadosIndicadores> {
        const nuevosBase = supabase.from('planilla_empleados').select('id', { count: 'exact', head: true }).is('deleted_at', null);
        const nuevosQuery = periodo
            ? nuevosBase.gte('fecha_ingreso', periodo.fechaInicio).lte('fecha_ingreso', periodo.fechaFin)
            : nuevosBase.gte('fecha_ingreso', new Date(Date.now() - NUEVOS_DIAS_FALLBACK * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

        const [totalRes, activosRes, inactivosRes, nuevosRes] = await Promise.all([
            supabase.from('planilla_empleados').select('id', { count: 'exact', head: true }).is('deleted_at', null),
            supabase.from('planilla_empleados').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('estado', 'activo'),
            supabase.from('planilla_empleados').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('estado', 'inactivo'),
            nuevosQuery,
        ]);

        if (totalRes.error) throw totalRes.error;
        if (activosRes.error) throw activosRes.error;
        if (inactivosRes.error) throw inactivosRes.error;
        if (nuevosRes.error) throw nuevosRes.error;

        return {
            total: totalRes.count ?? 0,
            activos: activosRes.count ?? 0,
            inactivos: inactivosRes.count ?? 0,
            nuevos: nuevosRes.count ?? 0,
        };
    },

    /**
     * Conteo de empleados activos agrupado por departamento (US-QNA-08 CA3). `departamento`
     * es texto libre en el esquema (sin catálogo propio) — se agrupa por el valor tal cual
     * viene, y null/vacío se agrupa bajo "sin departamento" en el caller.
     */
    async getEmpleadosPorDepartamento(): Promise<{ departamento: string | null; count: number }[]> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('departamento')
            .is('deleted_at', null)
            .eq('estado', 'activo');

        if (error) throw error;

        const counts = new Map<string | null, number>();
        for (const row of data || []) {
            const key = row.departamento?.trim() || null;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        return Array.from(counts, ([departamento, count]) => ({ departamento, count })).sort((a, b) => b.count - a.count);
    },

    /**
     * Fetch liviano (solo los campos necesarios para matchear) de todos los empleados con
     * `codigo_empleado_manual` asignado — usado por la validación de importación de Horas
     * Extras (US-HEX-04 CA1) para resolver "ID de usuario" del archivo contra un empleado
     * real. Sin paginar: el volumen de empleados por tenant es bajo.
     *
     * Antes matcheaba contra `codigo_reloj_marcador`, un campo sin ningún punto de captura en
     * la UI (quedó a medio construir) — por eso el import nunca encontraba a nadie. Se cambió
     * a `codigo_empleado_manual`, el código real de Imporfrut que sí se captura en el alta de
     * empleado (IMPL-120).
     */
    /** `cargo`/`departamento` (IMPL-22 CA4) — necesarios para resolver la jornada ordinaria del
     * empleado (`resolveJornadaOrdinaria`, US-HEX-01) al calcular HED/HEN/Nocturnidad/Feriado
     * por fila en la importación del Reloj Marcador. */
    async getEmpleadosConCodigoManual(): Promise<Pick<Empleado, 'id' | 'codigo_empleado_manual' | 'nombre_completo' | 'estado' | 'cargo' | 'departamento' | 'sueldo_mensual' | 'ubicacion_id'>[]> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('id, codigo_empleado_manual, nombre_completo, estado, cargo, departamento, sueldo_mensual, ubicacion_id')
            .is('deleted_at', null)
            .not('codigo_empleado_manual', 'is', null);
        if (error) throw error;
        return data || [];
    },

    /**
     * Fetch liviano de TODOS los empleados (activos e inactivos, sin paginar) — usado por los
     * reportes de historial (Vacaciones/Permisos IMPL-159/166, Referencia Laboral IMPL-160,
     * Descuentos IMPL-167, Constancia de Salario/Recibo de Sueldo IMPL-157/158), que necesitan
     * poder mostrar registros de empleados que ya no están activos, a diferencia de
     * `getEmpleadosActivos()` (selectores de captura, solo activos). `sueldo_mensual`/
     * `tipo_afiliacion` (IMPL-157/158) necesarios para el sueldo base de la Constancia y para
     * resolver la columna AFP Confía/Crecer/IPSFA/UPISS del Recibo.
     */
    // `dui` sumado al select (IMPL-169/US-EXP-13 CA1) — la Constancia de Retenciones lo necesita
    // en el encabezado y ninguno de los otros 3 reportes que consumen esta función lo usaba hasta
    // ahora; agregarlo al select es aditivo y no rompe a los llamadores existentes.
    // `numero_afiliado_isss` sumado al select (IMPL-99) — la Planilla Única ISSS/AFP lo necesita
    // en su columna 7; aditivo, no rompe a los llamadores existentes.
    // `retencion_especial_viatico` sumado al select (IMPL-184 CA7) — la Constancia de Salario lo
    // necesita para calcular el ISR sobre viáticos (retención 10%); aditivo.
    async getEmpleadosParaReportes(): Promise<Pick<Empleado, 'id' | 'codigo_empleado_manual' | 'codigo' | 'nombre_completo' | 'dui' | 'estado' | 'cargo' | 'departamento' | 'fecha_ingreso' | 'sueldo_mensual' | 'tipo_afiliacion' | 'numero_afiliado_isss' | 'retencion_especial_viatico'>[]> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('id, codigo_empleado_manual, codigo, nombre_completo, dui, estado, cargo, departamento, fecha_ingreso, sueldo_mensual, tipo_afiliacion, numero_afiliado_isss, retencion_especial_viatico')
            .is('deleted_at', null)
            .order('nombre_completo', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    /**
     * Fetch liviano de todos los empleados activos (tenant-wide, sin paginar ni filtrar por
     * ubicación) — usado por selectores de empleado en historias que no tienen dimensión de
     * ubicación (ej. Viáticos, US-VIA-05/US-VIA-03). Incluye `codigo` para el combobox de
     * búsqueda por nombre O código (US-VIA-03 CA1).
     */
    async getEmpleadosActivos(): Promise<Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual' | 'foto_url' | 'sueldo_mensual' | 'fecha_ingreso' | 'departamento'>[]> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('id, nombre_completo, cargo, codigo, codigo_empleado_manual, foto_url, sueldo_mensual, fecha_ingreso, departamento')
            .is('deleted_at', null)
            .eq('estado', 'activo')
            .order('nombre_completo', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    /**
     * IMPL-82 (US-HEX-08) — roster COMPLETO de empleados activos de UNA ubicación, para
     * `detectarAusenciasInjustificadas`: a diferencia de `getEmpleadosConCodigoManual` (que
     * excluye a quien no tiene código del reloj — justo los que más fácil se "pierden" si nunca
     * aparecen en el archivo subido), acá no se filtra por `codigo_empleado_manual`. `cargo`/
     * `departamento` necesarios para `resolveJornadaOrdinaria` (mismo criterio que
     * `getEmpleadosConCodigoManual`).
     */
    async getEmpleadosActivosPorUbicacion(ubicacionId: string): Promise<Pick<Empleado, 'id' | 'codigo_empleado_manual' | 'nombre_completo' | 'estado' | 'cargo' | 'departamento' | 'sueldo_mensual' | 'ubicacion_id'>[]> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('id, codigo_empleado_manual, nombre_completo, estado, cargo, departamento, sueldo_mensual, ubicacion_id')
            .is('deleted_at', null)
            .eq('estado', 'activo')
            .eq('ubicacion_id', ubicacionId);
        if (error) throw error;
        return data || [];
    },

    /**
     * Conteo de empleados activos sin `ubicacion_id` asignado (US-HEX-06) — mitigación del
     * riesgo de que un empleado "desaparezca" silenciosamente de toda carga manual de horas
     * extra por no tener ubicación asignada.
     */
    async contarActivosSinUbicacion(): Promise<number> {
        const { count, error } = await supabase
            .from('planilla_empleados')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('estado', 'activo')
            .is('ubicacion_id', null);
        if (error) throw error;
        return count ?? 0;
    },

    /**
     * Obtiene un empleado por id (perfil completo, para el formulario de edición).
     */
    async getEmpleadoById(id: string): Promise<Empleado> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * Crea un empleado nuevo. Genera el código EMP-YYYY-NNN (año de ingreso + correlativo
     * atómico por tenant/año, RPC `generar_codigo_empleado` — ver gap de IMPL-3 en
     * planilla-contexto.md, resuelto en revisión épica por épica).
     */
    async createEmpleado(empleadoData: CreateEmpleadoDTO): Promise<Empleado> {
        const year = new Date(`${empleadoData.fecha_ingreso}T00:00:00`).getFullYear();

        const { data: codigo, error: codigoError } = await supabase.rpc('generar_codigo_empleado', { p_anio: year });
        if (codigoError) throw codigoError;

        const { data, error } = await supabase
            .from('planilla_empleados')
            .insert([{ ...empleadoData, codigo }])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * Actualiza el perfil de un empleado existente.
     */
    async updateEmpleado(id: string, empleadoData: UpdateEmpleadoDTO): Promise<Empleado> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .update(empleadoData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * DUIs y códigos de empleado manual ya registrados (empleados no borrados) — usado por la
     * carga masiva por Excel para detectar duplicados contra la base ANTES de intentar el INSERT
     * (mejor UX que dejar que el índice único de la migración `20260928100000` rechace el lote
     * entero). Los códigos vienen normalizados (`normalizarTexto`) porque su duplicado se trata
     * insensible a mayúsculas, igual que la validación dentro del mismo archivo.
     */
    async getExistentesParaImportacion(): Promise<{ duis: Set<string>; codigosNormalizados: Set<string> }> {
        const { data, error } = await supabase
            .from('planilla_empleados')
            .select('dui, codigo_empleado_manual')
            .is('deleted_at', null);
        if (error) throw error;

        const duis = new Set<string>();
        const codigosNormalizados = new Set<string>();
        for (const row of data || []) {
            if (row.dui) duis.add(row.dui);
            if (row.codigo_empleado_manual) codigosNormalizados.add(normalizarTexto(row.codigo_empleado_manual));
        }
        return { duis, codigosNormalizados };
    },

    /**
     * Confirma la carga masiva — RPC transaccional `confirmar_importacion_empleados`. Recibe SOLO
     * filas ya validadas por el cliente (`empleadosExcelUtils.validarFilasImportacionEmpleados`);
     * si alguna choca igual en el servidor (ej. carrera real entre dos importaciones simultáneas),
     * el RPC lanza y NINGÚN empleado del lote se guarda (mismo criterio que
     * `confirmar_importacion_reloj_marcador`: todo o nada a nivel SQL, la tolerancia a errores
     * vive en el cliente antes de llegar acá). Devuelve la cantidad de empleados creados.
     */
    async confirmarImportacion(empleados: EmpleadoImportListo[]): Promise<number> {
        const { data, error } = await supabase.rpc('confirmar_importacion_empleados', { p_empleados: empleados });
        if (error) throw error;
        return data as number;
    },

    /**
     * Elimina (soft-delete) un empleado — RPC public.eliminar_empleado (US-UX-02, fidelidad
     * al prototipo). Valida server-side que no tenga movimientos en las tablas relacionadas
     * y que quien llama sea admin; si alguna condición falla, el RPC lanza una excepción con
     * mensaje de negocio legible (ver migración 20260907160000).
     */
    async eliminarEmpleado(id: string): Promise<void> {
        const { error } = await supabase.rpc('eliminar_empleado', { p_empleado_id: id });
        if (error) throw error;
    },

    /**
     * Historial de indemnizaciones de un empleado, más reciente primero (CA1).
     */
    async getIndemnizaciones(empleadoId: string): Promise<Indemnizacion[]> {
        const { data, error } = await supabase
            .from('planilla_empleado_indemnizaciones')
            .select('*')
            .eq('empleado_id', empleadoId)
            .order('fecha', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Registra una indemnización nueva Y reinicia fecha_ingreso del empleado en una sola
     * operación atómica (CA2) — ver RPC public.register_indemnizacion.
     */
    async registrarIndemnizacion(empleadoId: string, fecha: string, motivo: string | null): Promise<Indemnizacion> {
        const { data, error } = await supabase.rpc('register_indemnizacion', {
            p_empleado_id: empleadoId,
            p_fecha: fecha,
            p_motivo: motivo,
        });

        if (error) throw error;
        return data;
    },

    /**
     * Documentos adjuntos de un empleado (CA1/CA3), más reciente primero.
     */
    async getDocumentos(empleadoId: string): Promise<EmpleadoDocumento[]> {
        const { data, error } = await supabase
            .from('planilla_empleado_documentos')
            .select('*')
            .eq('empleado_id', empleadoId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Sube un archivo al bucket privado y registra sus metadatos (CA1).
     * Path: {tenant_id}/{empleado_id}/{uuid}_{nombre_sanitizado} (exigido por la RLS de storage).
     */
    async uploadDocumento(
        tenantId: string,
        empleadoId: string,
        file: File,
        tipo: DocumentoTipo,
        uploadedBy: string,
        origen: EmpleadoDocumento['origen'] = 'manual'
    ): Promise<EmpleadoDocumento> {
        const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `${tenantId}/${empleadoId}/${crypto.randomUUID()}_${sanitized}`;

        const { error: uploadError } = await supabase.storage
            .from(DOCUMENTOS_BUCKET)
            .upload(storagePath, file, { contentType: file.type, upsert: false });

        if (uploadError) throw uploadError;

        const { data, error } = await supabase
            .from('planilla_empleado_documentos')
            .insert([{
                tenant_id: tenantId,
                empleado_id: empleadoId,
                tipo,
                storage_path: storagePath,
                nombre_archivo: file.name,
                tamano_bytes: file.size,
                mime_type: file.type,
                origen,
                uploaded_by: uploadedBy,
            }])
            .select()
            .single();

        if (error) {
            // El registro de metadatos falló — limpiar el archivo huérfano en storage.
            await supabase.storage.from(DOCUMENTOS_BUCKET).remove([storagePath]);
            throw error;
        }
        return data;
    },

    /**
     * URL firmada de descarga (el bucket es privado — CA3). Expira en 60 segundos.
     */
    async getDocumentoSignedUrl(storagePath: string): Promise<string> {
        const { data, error } = await supabase.storage
            .from(DOCUMENTOS_BUCKET)
            .createSignedUrl(storagePath, 60);

        if (error) throw error;
        return data.signedUrl;
    },

    /**
     * Elimina un documento (archivo + metadatos). El DELETE en la tabla dispara el trigger
     * de auditoría automático (fn_capture_audit) que ya captura quién/qué/cuándo — CA4.
     */
    async deleteDocumento(documentoId: string, storagePath: string): Promise<void> {
        const { error: storageError } = await supabase.storage
            .from(DOCUMENTOS_BUCKET)
            .remove([storagePath]);

        if (storageError) throw storageError;

        const { error } = await supabase
            .from('planilla_empleado_documentos')
            .delete()
            .eq('id', documentoId);

        if (error) throw error;
    },
};
