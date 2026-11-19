import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import BrandLogo from '../../../assets/images/logo-teknergy.png';
import type { ConstanciaRetencionesDatos } from '../../../utils/constanciaRetencionesUtils';

const COLOR = { primary: '#10B981', secondary: '#1E293B', muted: '#64748B', light: '#F8FAFC', border: '#E2E8F0', white: '#FFFFFF' };

const styles = StyleSheet.create({
    page: { padding: 56, paddingTop: 48, fontFamily: 'Helvetica', fontSize: 10, color: COLOR.secondary, backgroundColor: COLOR.white },
    logo: { width: 150, marginBottom: 24 },
    empresaLinea: { fontSize: 10, marginBottom: 2 },
    titulo: { fontSize: 13, fontWeight: 'bold', marginTop: 12, marginBottom: 12, textTransform: 'uppercase' },
    parrafo: { fontSize: 10, lineHeight: 1.5, marginBottom: 12, textAlign: 'justify' },
    tablaTitulo: { fontSize: 9, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
    tablaHeader: { flexDirection: 'row', backgroundColor: COLOR.light, paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLOR.border },
    tablaHeaderTexto: { fontSize: 8, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase' },
    fila: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLOR.light },
    celdaConcepto: { flex: 3, fontSize: 9.5 },
    celdaMonto: { flex: 1, fontSize: 9.5, textAlign: 'right' },
    firmaBloque: { marginTop: 36 },
    firmaLinea: { fontSize: 11, fontWeight: 'bold' },
    firmaCargo: { fontSize: 10, color: COLOR.muted, marginTop: 2 },
    brandingFooter: { position: 'absolute', bottom: 24, left: 56, right: 56, borderTopWidth: 1, borderTopColor: COLOR.light, paddingTop: 8 },
    brandingText: { fontSize: 7, color: '#94A3B8', textAlign: 'center' },
});

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface FilaTabla { concepto: string; monto: number }

const Tabla: React.FC<{ titulo: string; filas: FilaTabla[] }> = ({ titulo, filas }) => (
    <View>
        <Text style={styles.tablaTitulo}>{titulo}</Text>
        <View style={styles.tablaHeader}>
            <Text style={[styles.tablaHeaderTexto, { flex: 3 }]}>Concepto</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 1, textAlign: 'right' }]}>Monto (US$)</Text>
        </View>
        {filas.map((f, i) => (
            <View key={i} style={styles.fila}>
                <Text style={styles.celdaConcepto}>{f.concepto}</Text>
                <Text style={styles.celdaMonto}>{fmt(f.monto)}</Text>
            </View>
        ))}
    </View>
);

/**
 * Constancia de Retenciones / Impuesto sobre la Renta (US-EXP-13, IMPL-169) — formato confirmado
 * por Imporfrut (`1.10 Constancia de Renta.docx`, agosto 2026): Razón Social + NIT de la empresa
 * (CA5, `empresaConfigService`), nombre + DUI del empleado, y el detalle de ingresos/retenciones
 * por Código de Ingreso DGII (11 = salario regular, 60 = Honorarios y otros ingresos — CA2/CA3).
 * El período (CA4, siempre el ejercicio fiscal anterior completo) queda impreso explícitamente:
 * el formato de referencia no lo mostraba como línea propia, así que se agregó dentro del párrafo
 * introductorio — decisión de diseño de este ticket, no ambigüedad de negocio.
 */
export const ConstanciaRetencionesPDFTemplate: React.FC<{ datos: ConstanciaRetencionesDatos }> = ({ datos }) => (
    <Document title={`Constancia de Renta - ${datos.nombreCompleto}`}>
        <Page size="A4" style={styles.page}>
            <Image src={BrandLogo} style={styles.logo} />
            {datos.razonSocialEmpresa ? <Text style={styles.empresaLinea}>{datos.razonSocialEmpresa}</Text> : null}
            {datos.nitEmpresa ? <Text style={styles.empresaLinea}>{datos.nitEmpresa}</Text> : null}

            <Text style={styles.titulo}>Constancia de Renta</Text>

            <Text style={styles.parrafo}>
                {`Por medio de la presente hacemos constar que el Señor(a)(ita) ${datos.nombreCompleto} con DUI: ${datos.dui} se le hicieron las siguientes retenciones correspondientes al ejercicio fiscal ${datos.anioFiscal} (del 01 de enero al 31 de diciembre de ${datos.anioFiscal}):`}
            </Text>

            <Tabla
                titulo="Código de ingreso: 11"
                filas={[
                    { concepto: 'Ingresos', monto: datos.ingresosCodigo11 },
                    { concepto: 'Retención', monto: datos.retencionCodigo11 },
                ]}
            />

            <Tabla
                titulo="Código de ingreso: 60"
                filas={[
                    { concepto: 'Honorarios y otros ingresos', monto: datos.ingresosCodigo60 },
                    { concepto: 'Retención', monto: datos.retencionCodigo60 },
                ]}
            />

            <Tabla
                titulo="Descuentos"
                filas={[
                    { concepto: 'ISSS', monto: datos.isss },
                    { concepto: 'AFP', monto: datos.afp },
                ]}
            />

            <Text style={[styles.parrafo, { marginTop: 20 }]}>
                En virtud de lo anterior, se extiende la presente constancia para los usos que estime convenientes, el{' '}
                {new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}.
            </Text>

            <View style={styles.firmaBloque}>
                <Text style={styles.firmaLinea}>Gilda Montiel</Text>
                <Text style={styles.firmaCargo}>Recursos Humanos</Text>
            </View>

            <View style={styles.brandingFooter} fixed>
                <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador</Text>
            </View>
        </Page>
    </Document>
);
