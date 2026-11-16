import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../../../store/authStore';
import { useTranslation } from 'react-i18next';
import {
    reportService,
    type SellerReportItem,
    type ProductReportItem,
    type CustomerReportItem
} from '../../../../services/reportService';

type TabType = 'sellers' | 'products' | 'customers';

export const useReportExplorer = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const [activeTab, setActiveTab] = useState<TabType>('sellers');
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Filtros de fecha (Default: Mes actual)
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = now.toISOString().split('T')[0];

    const [dateRange, setDateRange] = useState({
        start: firstDay,
        end: lastDay
    });

    const [sellersData, setSellersData] = useState<SellerReportItem[]>([]);
    const [productsData, setProductsData] = useState<ProductReportItem[]>([]);
    const [customersData, setCustomersData] = useState<CustomerReportItem[]>([]);

    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

    const fetchData = async () => {
        if (!profile?.tenant_id) return;
        setIsLoading(true);
        try {
            const startStr = `${dateRange.start}T00:00:00Z`;
            const endStr = `${dateRange.end}T23:59:59Z`;

            if (activeTab === 'sellers') {
                const res = await reportService.getSellerReport(profile.tenant_id, startStr, endStr);
                setSellersData(res);
            } else if (activeTab === 'products') {
                const res = await reportService.getProductReport(profile.tenant_id, startStr, endStr);
                setProductsData(res);
            } else if (activeTab === 'customers') {
                const res = await reportService.getCustomerReport(profile.tenant_id, startStr, endStr);
                setCustomersData(res);
            }
        } catch (error: unknown) {
            console.error('Error fetching report:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setSortConfig(null);
    }, [activeTab, dateRange, profile?.tenant_id]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData = useMemo(() => {
        const dataMap = {
            sellers: sellersData,
            products: productsData,
            customers: customersData
        };
        const currentData = [...dataMap[activeTab]];

        if (!sortConfig) return currentData;

        return currentData.sort((a: any, b: any) => {
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [activeTab, sellersData, productsData, customersData, sortConfig]);

    const getReportTitle = () => {
        return activeTab === 'sellers' ? t('reports.tab_sellers') :
            activeTab === 'products' ? t('reports.tab_products') :
                t('reports.tab_customers');
    };

    const exportToExcel = async () => {
        if (sortedData.length === 0) return;
        setIsExporting(true);
        try {
            const { exportToExcel: centralExport } = await import('../../../../utils/exportUtils');

            let tableData;
            if (activeTab === 'sellers') {
                tableData = sellersData.map(item => ({
                    [t('reports.table_seller')]: item.seller_name,
                    [t('reports.table_orders')]: item.orders_count,
                    [t('reports.table_total')]: item.total_sales,
                    [t('reports.table_avg_ticket')]: item.avg_ticket
                }));
            } else if (activeTab === 'products') {
                tableData = productsData.map(item => ({
                    [t('reports.table_product')]: item.product_name,
                    [t('reports.table_category')]: item.category,
                    [t('reports.table_quantity')]: item.total_quantity,
                    [t('reports.table_revenue')]: item.total_revenue
                }));
            } else {
                tableData = customersData.map(item => ({
                    [t('reports.table_customer')]: item.business_name,
                    [t('reports.table_frequency')]: item.monthly_frequency,
                    [t('reports.table_last_order')]: item.last_order_at ? new Date(item.last_order_at).toLocaleDateString() : 'N/A',
                    [t('reports.table_status')]: item.is_inactive ? t('reports.status_inactive') : t('reports.status_active'),
                    [t('reports.table_total')]: item.accumulated_amount
                }));
            }

            const fileName = `Export_${activeTab}_${dateRange.start}_al_${dateRange.end}`;
            await centralExport(tableData, fileName, 'Reporte', {
                title: `RESUMEN DE ${getReportTitle().toUpperCase()}`,
                author: profile?.full_name || 'Admin'
            });

        } catch (error) {
            console.error('Error exporting to Excel:', error);
        } finally {
            setIsExporting(false);
        }
    };

    const exportToPDF = async () => {
        if (sortedData.length === 0) return;
        setIsExporting(true);
        try {
            const { pdf, Document, Page, Text, View, StyleSheet } = await import('@react-pdf/renderer');

            const styles = StyleSheet.create({
                page: { padding: 40, fontFamily: 'Helvetica' },
                header: { marginBottom: 20, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 10 },
                title: { fontSize: 24, fontWeight: 'bold', color: '#1E293B' },
                meta: { fontSize: 10, color: '#64748B', marginTop: 4 },
                tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', minHeight: 24, alignItems: 'center' },
                tableHeader: { backgroundColor: '#F8FAFC', color: '#475569', fontWeight: 'bold' },
                tableCell: { flex: 1, fontSize: 8, padding: 4, color: '#334155' },
                tableCellBold: { flex: 1, fontSize: 8, padding: 4, fontWeight: 'bold', color: '#0F172A' },
                rightAlign: { textAlign: 'right' },
                footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8, color: '#94A3B8', textAlign: 'center' }
            });

            const getColumns = () => {
                if (activeTab === 'sellers') return [
                    { label: t('reports.table_seller'), key: 'seller_name', flex: 2 },
                    { label: t('reports.table_orders'), key: 'orders_count', align: 'right' },
                    { label: t('reports.table_total'), key: 'total_sales', align: 'right' },
                    { label: t('reports.table_avg_ticket'), key: 'avg_ticket', align: 'right' }
                ];
                if (activeTab === 'products') return [
                    { label: t('reports.table_product'), key: 'product_name', flex: 2 },
                    { label: t('reports.table_category'), key: 'category' },
                    { label: 'Cant.', key: 'total_quantity', align: 'right' },
                    { label: 'Venta', key: 'total_revenue', align: 'right' }
                ];
                return [
                    { label: t('reports.table_customer'), key: 'business_name', flex: 2 },
                    { label: 'Frec.', key: 'monthly_frequency', align: 'right' },
                    { label: 'U. Pedido', key: 'last_order_at' },
                    { label: 'Venta Acum.', key: 'accumulated_amount', align: 'right' }
                ];
            };

            const columns = getColumns();

            const MyDocument = (
                <Document>
                    <Page size="A4" style={styles.page}>
                        <View style={styles.header}>
                            <Text style={styles.title}>IMPORFRUT - Reporte</Text>
                            <Text style={styles.meta}>{getReportTitle()}</Text>
                            <Text style={styles.meta}>{t('reports.report_filter_period')} {dateRange.start} al {dateRange.end}</Text>
                            <Text style={styles.meta}>{t('reports.report_generated_at')} {new Date().toLocaleString()}</Text>
                        </View>

                        <View style={[styles.tableRow, styles.tableHeader]}>
                            {columns.map((col, i) => (
                                <Text key={i} style={[
                                    styles.tableCellBold,
                                    col.flex ? { flex: col.flex } : {} as any,
                                    col.align === 'right' ? styles.rightAlign : {} as any
                                ] as any}>
                                    {col.label}
                                </Text>
                            ))}
                        </View>

                        {sortedData.map((item: any, i) => (
                            <View key={i} style={styles.tableRow}>
                                {columns.map((col, j) => {
                                    let val = item[col.key];
                                    if (['total_sales', 'total_revenue', 'accumulated_amount', 'avg_ticket'].includes(col.key)) {
                                        val = `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
                                    }
                                    if (col.key === 'last_order_at' && val) {
                                        val = new Date(val).toLocaleDateString();
                                    }
                                    return (
                                        <Text key={j} style={[
                                            styles.tableCell,
                                            col.flex ? { flex: col.flex } : {} as any,
                                            col.align === 'right' ? styles.rightAlign : {} as any
                                        ] as any}>
                                            {val || 'N/A'}
                                        </Text>
                                    );
                                })}
                            </View>
                        ))}

                        <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
                            `Página ${pageNumber} de ${totalPages} - Teknergy ImporFrut System`
                        )} fixed />
                    </Page>
                </Document>
            );

            const blob = await pdf(MyDocument).toBlob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Reporte_${activeTab}_${new Date().toISOString().split('T')[0]}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting to PDF:', error);
        } finally {
            setIsExporting(false);
        }
    };

    return {
        activeTab,
        setActiveTab,
        isLoading,
        isExporting,
        dateRange,
        setDateRange,
        sortedData,
        sortConfig,
        handleSort,
        exportToExcel,
        exportToPDF
    };
};
