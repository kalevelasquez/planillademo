import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Image,
} from '@react-pdf/renderer';
import type { Customer } from '../../../services/customerService';
import type { OrderItem } from '../../../store/orderStore';
import BrandLogo from '../../../assets/images/logo-imporfrut.png';

// ─────────────────────────────────────────────────────────────────
// Diseño Premium ImporFrut
// ─────────────────────────────────────────────────────────────────
const COLOR = {
    primary: '#10B981',   // Emerald 500
    primaryDark: '#065F46', // Emerald 800
    secondary: '#1E293B',  // Slate 800
    muted: '#64748B',      // Slate 500
    light: '#F8FAFC',      // Slate 50
    border: '#E2E8F0',     // Slate 200
    white: '#FFFFFF',
    danger: '#EF4444',     // Red 500
};

const styles = StyleSheet.create({
    page: {
        padding: 40,
        fontFamily: 'Helvetica',
        fontSize: 9,
        color: COLOR.secondary,
        backgroundColor: COLOR.white,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 30,
        borderBottomWidth: 1,
        borderBottomColor: COLOR.border,
        paddingBottom: 20,
    },
    logo: {
        width: 100,
    },
    headerRight: {
        alignItems: 'flex-end',
    },
    docLabel: {
        fontSize: 8,
        color: COLOR.muted,
        textTransform: 'uppercase',
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    orderNum: {
        fontSize: 18,
        fontWeight: 'bold',
        color: COLOR.primary,
        marginTop: 2,
    },
    date: {
        fontSize: 9,
        color: COLOR.muted,
        marginTop: 4,
    },

    // Info Grid
    infoGrid: {
        flexDirection: 'row',
        gap: 40,
        marginBottom: 30,
    },
    infoSection: {
        flex: 1,
    },
    sectionLabel: {
        fontSize: 8,
        color: COLOR.muted,
        textTransform: 'uppercase',
        fontWeight: 'bold',
        marginBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: COLOR.light,
        paddingBottom: 2,
    },
    infoName: {
        fontSize: 11,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    infoText: {
        fontSize: 9,
        color: COLOR.muted,
        marginBottom: 2,
    },

    // Table
    table: {
        marginTop: 10,
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: COLOR.light,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderTopWidth: 1,
        borderTopColor: COLOR.border,
        borderBottomWidth: 1,
        borderBottomColor: COLOR.border,
    },
    headerText: {
        fontSize: 8,
        fontWeight: 'bold',
        color: COLOR.muted,
        textTransform: 'uppercase',
    },
    tableRow: {
        flexDirection: 'row',
        paddingVertical: 10,
        paddingHorizontal: 10,
        borderBottomWidth: 1,
        borderBottomColor: COLOR.light,
        alignItems: 'center',
    },
    cellDesc: { flex: 3 },
    cellQty: { flex: 0.8, textAlign: 'center' },
    cellPrice: { flex: 1, textAlign: 'right' },
    cellTotal: { flex: 1, textAlign: 'right' },
    tableCell: {
        fontSize: 9,
        color: COLOR.secondary,
    },
    prodName: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    prodDetails: {
        fontSize: 8,
        color: COLOR.muted,
        marginTop: 2,
    },
    discountNote: {
        fontSize: 8,
        color: COLOR.danger,
        marginTop: 1,
    },

    // Totals Section
    footerContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 30,
    },
    totalsSection: {
        width: 180,
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
    totalLabel: {
        fontSize: 9,
        color: COLOR.muted,
    },
    totalValue: {
        fontSize: 9,
        fontWeight: 'bold',
        textAlign: 'right',
    },
    grandTotalContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 10,
        marginTop: 10,
        borderTopWidth: 2,
        borderTopColor: COLOR.primary,
        backgroundColor: '#F0FDF4', // Light green bg
        paddingHorizontal: 10,
        borderRadius: 4,
    },
    grandTotalLabel: {
        fontSize: 11,
        fontWeight: 'bold',
        color: COLOR.primaryDark,
    },
    grandTotalValue: {
        fontSize: 12,
        fontWeight: 'bold',
        color: COLOR.primary,
    },

    // Static Footer
    brandingFooter: {
        position: 'absolute',
        bottom: 30,
        left: 40,
        right: 40,
        borderTopWidth: 1,
        borderTopColor: COLOR.light,
        paddingTop: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    brandingText: {
        fontSize: 7,
        color: '#94A3B8',
    },
    // Nuevos estilos para PDF Interno
    internalHeader: {
        backgroundColor: '#F1F5F9',
        padding: 6,
        borderRadius: 4,
        marginBottom: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#475569',
    },
    internalBold: {
        fontSize: 10,
        fontWeight: 'bold',
        fontFamily: 'Helvetica-Bold',
        color: '#0F172A',
    },
    internalShipment: {
        fontSize: 10,
        fontWeight: 'bold',
        fontFamily: 'Helvetica-Bold',
        color: COLOR.primaryDark,
    },
    internalNotes: {
        marginTop: 15,
        padding: 10,
        backgroundColor: '#FEFCE8', // Yellow 50
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#FEF3C7', // Yellow 100
    }
});

export interface OrderPDFProps {
    orderNumber: string;
    createdAt: string;
    customer: Customer;
    sellerName: string;
    items: OrderItem[];
    subtotal: number;
    discount_amount: number;
    notes?: string;
    isInternal?: boolean;
}

const fmtMoney = (val: number) => `$${val.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const OrderPDFTemplate: React.FC<OrderPDFProps> = ({
    orderNumber,
    createdAt,
    customer,
    sellerName,
    items,
    subtotal,
    discount_amount,
    notes,
    isInternal = false,
}) => {
    const total = Math.max(0, subtotal - (discount_amount || 0));

    return (
        <Document title={`Pedido ${orderNumber} - ImporFrut`}>
            <Page size="A4" style={styles.page}>
                {/* Header */}
                <View style={styles.header}>
                    <Image src={BrandLogo} style={styles.logo} />
                    <View style={styles.headerRight}>
                        <Text style={styles.docLabel}>
                            {isInternal ? 'ORDEN DE DESPACHO E INTERNA' : 'COMPROBANTE DE PEDIDO'}
                        </Text>
                        <Text style={styles.orderNum}>#{orderNumber}</Text>
                        <Text style={styles.date}>Emitido: {new Date(createdAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}</Text>
                    </View>
                </View>

                {isInternal && (
                    <View style={styles.internalHeader}>
                        <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#475569' }}>MODO DESPACHO: Verificando Stock y Lotes</Text>
                    </View>
                )}

                {/* Info Grid */}
                <View style={styles.infoGrid}>
                    <View style={styles.infoSection}>
                        <Text style={styles.sectionLabel}>Datos del Cliente</Text>
                        <Text style={styles.infoName}>{customer.business_name}</Text>
                        {customer.contact_name && <Text style={styles.infoText}>Atención: {customer.contact_name}</Text>}
                        <Text style={styles.infoText}>{customer.phone || 'Sin teléfono registrado'}</Text>
                    </View>
                    <View style={styles.infoSection}>
                        <Text style={styles.sectionLabel}>Atendido Por</Text>
                        <Text style={styles.infoName}>{sellerName}</Text>
                        <Text style={styles.infoText}>ImporFrut S.A. de C.V.</Text>
                        <Text style={styles.infoText}>info@imporfrut.com</Text>
                    </View>
                </View>

                {/* Items Table */}
                <View style={styles.table}>
                    <View style={styles.tableHeader}>
                        <Text style={[styles.headerText, styles.cellDesc]}>Producto / Descripción</Text>
                        <Text style={[styles.headerText, styles.cellQty]}>Cant.</Text>
                        <Text style={[styles.headerText, styles.cellPrice]}>P. Unit</Text>
                        <Text style={[styles.headerText, styles.cellTotal]}>Subtotal</Text>
                    </View>

                    {items.map((item, idx) => (
                        <View key={idx} style={styles.tableRow} wrap={false}>
                            <View style={styles.cellDesc}>
                                <Text style={styles.prodName}>{item.product.name}</Text>

                                {isInternal ? (
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 3, gap: 4 }}>
                                        <Text style={styles.internalBold}>{item.product.brand}</Text>
                                        <Text style={{ fontSize: 10, color: COLOR.muted }}>•</Text>
                                        <Text style={styles.internalBold}>{item.product.caliber}</Text>
                                        <Text style={{ fontSize: 10, color: COLOR.muted }}>•</Text>
                                        <Text style={styles.internalBold}>{item.product.quality}</Text>
                                        <Text style={{ fontSize: 10, color: COLOR.muted }}>•</Text>
                                        <Text style={styles.internalShipment}>#{item.product.shipment_number || 'N/A'}</Text>
                                    </View>
                                ) : (
                                    <Text style={styles.prodDetails}>
                                        {[item.product.brand, item.product.caliber, item.product.quality].filter(Boolean).join(' • ')}
                                    </Text>
                                )}

                                {/* Notas de Producto: Solo visibles en versión interna */}
                                {isInternal && item.note && (
                                    <View style={{ marginTop: 4, padding: 4, backgroundColor: '#EEF2FF', borderRadius: 2, borderLeftWidth: 2, borderLeftColor: '#6366F1' }}>
                                        <Text style={{ fontSize: 7, fontWeight: 'bold', color: '#4338CA', textTransform: 'uppercase' }}>Instrucción:</Text>
                                        <Text style={{ fontSize: 8, color: '#1E1B4B', marginTop: 1 }}>{item.note}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.tableCell, styles.cellQty, isInternal ? { fontSize: 11, fontWeight: 'bold' } : {}]}>{item.quantity}</Text>
                            <Text style={[styles.tableCell, styles.cellPrice]}>{fmtMoney(item.unitPrice || item.product.price)}</Text>
                            <Text style={[styles.tableCell, styles.cellTotal, { fontWeight: 'bold' }]}>
                                {fmtMoney((item.unitPrice || item.product.price) * item.quantity)}
                            </Text>
                        </View>
                    ))}
                </View>

                {/* Notas Administrativas: Solo visibles en versión interna, forzamos en la misma hoja si es posible */}
                {isInternal && notes && (
                    <View style={styles.internalNotes} wrap={false}>
                        <Text style={[styles.sectionLabel, { color: '#92400E', borderBottomColor: '#FDE68A', marginBottom: 4 }]}>Observaciones Generales de Pedido</Text>
                        <Text style={{ fontSize: 10, color: '#78350F', lineHeight: 1.4, fontWeight: 'bold', fontFamily: 'Helvetica-Bold' }}>{notes}</Text>
                    </View>
                )}

                {/* Footer Section: Notes & Totals */}
                <View style={styles.footerContainer}>
                    <View style={styles.totalsSection}>
                        <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>Subtotal</Text>
                            <Text style={styles.totalValue}>{fmtMoney(subtotal)}</Text>
                        </View>
                        {discount_amount > 0 && (
                            <View style={styles.totalRow}>
                                <Text style={styles.totalLabel}>Descuento General</Text>
                                <Text style={[styles.totalValue, { color: COLOR.danger }]}>-{fmtMoney(discount_amount)}</Text>
                            </View>
                        )}
                        <View style={styles.grandTotalContainer}>
                            <Text style={styles.grandTotalLabel}>TOTAL A PAGAR</Text>
                            <Text style={styles.grandTotalValue}>{fmtMoney(total)}</Text>
                        </View>
                    </View>
                </View>


                {/* Sticky Branding Footer */}
                <View style={styles.brandingFooter} fixed>
                    <Text style={styles.brandingText}>ImporFrut S.A. de C.V. • El Salvador • {new Date().getFullYear()}</Text>
                    <Text style={styles.brandingText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
                </View>
            </Page>
        </Document>
    );
};
