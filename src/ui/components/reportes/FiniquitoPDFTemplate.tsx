import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import BrandLogo from '../../../assets/images/logo-imporfrut.png';
import type { FiniquitoDatos, MontoOPendiente } from '../../../utils/finiquitoUtils';

const COLOR = {
    primary: '#10B981', secondary: '#1E293B', muted: '#64748B', light: '#F8FAFC', border: '#E2E8F0', white: '#FFFFFF',
    warningBg: '#FFFBEB', warningBorder: '#FDE68A', warningText: '#B45309',
};

const styles = StyleSheet.create({
    page: { padding: 40, paddingTop: 36, fontFamily: 'Helvetica', fontSize: 9, color: COLOR.secondary, backgroundColor: COLOR.white },
    logo: { width: 90, marginBottom: 14 },
    empresaLinea: { fontSize: 9, marginBottom: 1 },
    titulo: { fontSize: 13, fontWeight: 'bold', marginTop: 10, marginBottom: 10, textTransform: 'uppercase' },
    subtitulo: { fontSize: 9.5, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase', marginTop: 12, marginBottom: 4 },
    grid: { flexDirection: 'row', gap: 12, backgroundColor: COLOR.light, padding: 8, borderRadius: 3, marginBottom: 4 },
    gridItem: { flex: 1 },
    gridLabel: { fontSize: 7, color: COLOR.muted, textTransform: 'uppercase' },
    gridValor: { fontSize: 9, fontWeight: 'bold', marginTop: 1 },
    tablaHeader: { flexDirection: 'row', backgroundColor: COLOR.light, paddingVertical: 5, paddingHorizontal: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLOR.border },
    tablaHeaderTexto: { fontSize: 7.5, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase' },
    fila: { flexDirection: 'row', paddingVertical: 4.5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: COLOR.light, alignItems: 'center' },
    celdaConcepto: { flex: 3, fontSize: 8.5 },
    celdaMonto: { flex: 1.3, fontSize: 8.5, textAlign: 'right' },
    badgePendiente: { fontSize: 7, fontWeight: 'bold', color: COLOR.warningText, backgroundColor: COLOR.warningBg, borderWidth: 1, borderColor: COLOR.warningBorder, borderRadius: 3, paddingVertical: 2, paddingHorizontal: 5, textAlign: 'right' as const, flex: 1.3 },
    notaPendiente: { fontSize: 7.5, color: COLOR.warningText, backgroundColor: COLOR.warningBg, borderWidth: 1, borderColor: COLOR.warningBorder, borderRadius: 3, padding: 8, marginTop: 8, lineHeight: 1.4 },
    totalBox: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, padding: 8, backgroundColor: '#F0FDF4', borderRadius: 3, borderTopWidth: 2, borderTopColor: COLOR.primary, alignItems: 'center' },
    totalLabel: { fontSize: 9.5, fontWeight: 'bold' },
    totalValor: { fontSize: 12, fontWeight: 'bold', color: COLOR.primary },
    totalNota: { fontSize: 7, color: COLOR.muted, marginTop: 3 },
    parrafo: { fontSize: 8.5, lineHeight: 1.4, marginTop: 10, marginBottom: 8 },
    montoLetrasCaja: { backgroundColor: COLOR.light, borderRadius: 3, padding: 8, marginBottom: 8 },
    montoLetrasTexto: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase' },
    firmasFila: { flexDirection: 'row', marginTop: 50, gap: 16 },
    firmaBloque: { flex: 1, borderTopWidth: 1, borderTopColor: COLOR.secondary, paddingTop: 4 },
    firmaTexto: { fontSize: 7.5, color: COLOR.muted, textAlign: 'center' },
    brandingFooter: { position: 'absolute', bottom: 20, left: 40, right: 40, borderTopWidth: 1, borderTopColor: COLOR.light, paddingTop: 6 },
    brandingText: { fontSize: 6.5, color: '#94A3B8', textAlign: 'center' },
});

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** Fila de la tabla desglosada — si el concepto es `MontoOPendiente` en estado `pendiente_definir`,
 * se muestra el badge en vez de un monto (nunca un $0.00 que se confunda con "no aplica"). */
const FilaConcepto: React.FC<{ concepto: string; valor: number | MontoOPendiente }> = ({ concepto, valor }) => {
    const pendiente = typeof valor === 'object' && valor.estado === 'pendiente_definir';
    const monto = typeof valor === 'number' ? valor : valor.estado === 'confirmado' ? valor.monto : 0;
    return (
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>{concepto}</Text>
            {pendiente ? <Text style={styles.badgePendiente}>PENDIENTE DE DEFINIR</Text> : <Text style={styles.celdaMonto}>{fmt(monto)}</Text>}
        </View>
    );
};

const Encabezado: React.FC<{ razonSocial?: string; nit?: string }> = ({ razonSocial, nit }) => (
    <>
        <Image src={BrandLogo} style={styles.logo} />
        {razonSocial ? <Text style={styles.empresaLinea}>{razonSocial}</Text> : null}
        {nit ? <Text style={styles.empresaLinea}>{nit}</Text> : null}
    </>
);

export interface FiniquitoPDFProps {
    datos: FiniquitoDatos;
    razonSocialEmpresa?: string;
    nitEmpresa?: string;
}

/**
 * Finiquito (US-EXP-09, IMPL-162 CA1 reescrito septiembre 2026) — tabla desglosada, NO el párrafo
 * de prosa legal de la versión vieja del ticket (esa resultó ser una plantilla reciclada de otra
 * empresa). Reusa `FiniquitoDatos`, que a su vez reusa `LiquidacionLaboralDatos` (IMPL-161) como
 * única fuente de verdad (CA4) — este template no recalcula nada, solo presenta.
 */
export const FiniquitoPDFTemplate: React.FC<FiniquitoPDFProps> = ({ datos, razonSocialEmpresa, nitEmpresa }) => (
    <Document title={`Finiquito - ${datos.nombreEmpleado}`}>
        <Page size="A4" style={styles.page}>
            <Encabezado razonSocial={razonSocialEmpresa} nit={nitEmpresa} />
            <Text style={styles.titulo}>Finiquito</Text>

            <View style={styles.grid}>
                <View style={{ flex: 2 }}><Text style={styles.gridLabel}>Nombre</Text><Text style={styles.gridValor}>{datos.nombreEmpleado}</Text></View>
                <View style={styles.gridItem}><Text style={styles.gridLabel}>DUI</Text><Text style={styles.gridValor}>{datos.dui}</Text></View>
            </View>
            <View style={styles.grid}>
                <View style={styles.gridItem}><Text style={styles.gridLabel}>Fecha de Inicio</Text><Text style={styles.gridValor}>{fmtFecha(datos.fechaInicio)}</Text></View>
                <View style={styles.gridItem}><Text style={styles.gridLabel}>Fecha de Fin</Text><Text style={styles.gridValor}>{fmtFecha(datos.fechaFin)}</Text></View>
                <View style={styles.gridItem}><Text style={styles.gridLabel}>Fecha de Firma</Text><Text style={styles.gridValor}>{fmtFecha(datos.fechaFirma)}</Text></View>
            </View>

            <Text style={styles.subtitulo}>Ingresos</Text>
            <View style={styles.tablaHeader}>
                <Text style={[styles.tablaHeaderTexto, { flex: 3 }]}>Concepto</Text>
                <Text style={[styles.tablaHeaderTexto, { flex: 1.3, textAlign: 'right' }]}>Valor (US$)</Text>
            </View>
            <FilaConcepto concepto="Indemnización (Art. 58 CT)" valor={datos.indemnizacion} />
            <FilaConcepto concepto="Vacaciones Completas" valor={datos.vacacionesCompletas} />
            <FilaConcepto concepto="Vacación Proporcional" valor={datos.vacacionProporcional} />
            <FilaConcepto concepto="Aguinaldo Completo" valor={datos.aguinaldoCompleto} />
            <FilaConcepto concepto="Aguinaldo Proporcional" valor={datos.aguinaldoProporcional} />
            <FilaConcepto concepto="Sueldo pendiente (último período)" valor={datos.sueldoPendiente} />
            <FilaConcepto concepto="Horas Extras pendientes" valor={datos.horasExtrasPendientes} />
            <FilaConcepto concepto="Viáticos pendientes" valor={datos.viaticosPendientes} />
            <FilaConcepto concepto="Bonificación" valor={datos.bonificacion} />
            <View style={styles.totalBox}>
                <Text style={styles.totalLabel}>Ingresos Totales</Text>
                <Text style={styles.totalValor}>{fmt(datos.ingresosTotales)}</Text>
            </View>
            <Text style={styles.totalNota}>* Total PARCIAL — no incluye Indemnización/Vacaciones Completas/Aguinaldo Completo (ver "PENDIENTE DE DEFINIR" arriba).</Text>

            <View style={styles.grid}>
                <View style={styles.gridItem}><Text style={styles.gridLabel}>Ingresos Afectos a ISSS y AFP</Text><Text style={styles.gridValor}>{fmt(datos.ingresosAfectosIsssAfp)}</Text></View>
                <View style={styles.gridItem}><Text style={styles.gridLabel}>Ingresos Gravados Renta</Text><Text style={styles.gridValor}>{fmt(datos.ingresosGravadosRenta)}</Text></View>
            </View>

            <Text style={styles.subtitulo}>Detalle de Descuentos</Text>
            <View style={styles.tablaHeader}>
                <Text style={[styles.tablaHeaderTexto, { flex: 3 }]}>Concepto</Text>
                <Text style={[styles.tablaHeaderTexto, { flex: 1.3, textAlign: 'right' }]}>Valor (US$)</Text>
            </View>
            <FilaConcepto concepto="ISSS" valor={datos.detalleDescuentos.isss} />
            <FilaConcepto concepto="AFP" valor={datos.detalleDescuentos.afp} />
            <FilaConcepto concepto="Renta" valor={datos.detalleDescuentos.renta} />
            <FilaConcepto concepto="Calzado" valor={datos.detalleDescuentos.calzado} />
            <FilaConcepto concepto="Anticipo de Vacaciones y Aguinaldo" valor={datos.detalleDescuentos.anticipoVacacionesAguinaldo} />
            <FilaConcepto concepto="Otros Descuentos" valor={datos.detalleDescuentos.otrosDescuentos} />
            <View style={styles.totalBox}>
                <Text style={styles.totalLabel}>Total Descuentos</Text>
                <Text style={styles.totalValor}>{fmt(datos.totalDescuentos)}</Text>
            </View>

            <View style={styles.totalBox}>
                <Text style={styles.totalLabel}>Total a Pagar</Text>
                <Text style={styles.totalValor}>{fmt(datos.totalAPagarParcial)}</Text>
            </View>
            <Text style={styles.totalNota}>* Total PARCIAL — ver notas de Ingresos y Descuentos arriba.</Text>

            <View style={styles.montoLetrasCaja}>
                <Text style={styles.montoLetrasTexto}>Cantidad en letras: {datos.montoEnLetras} DÓLARES DE LOS ESTADOS UNIDOS DE AMÉRICA</Text>
            </View>

            <Text style={styles.parrafo}>
                Recibí de {razonSocialEmpresa || 'la empresa'} la cantidad antes indicada, en concepto de finiquito
                por la terminación de mi relación laboral, declarando que nada más se me adeuda por ningún concepto
                derivado de dicha relación de trabajo, por lo que renuncio a cualquier reclamo futuro relacionado
                con la misma.
            </Text>

            <View style={styles.firmasFila}>
                <View style={styles.firmaBloque}><Text style={styles.firmaTexto}>{datos.nombreEmpleado}</Text></View>
                <View style={styles.firmaBloque}><Text style={styles.firmaTexto}>Recursos Humanos</Text></View>
            </View>

            <View style={styles.brandingFooter} fixed>
                <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador</Text>
            </View>
        </Page>
    </Document>
);
