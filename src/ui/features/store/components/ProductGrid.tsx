import React from 'react';
import type { StoreProduct } from '../../../../services/storeService';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
    products: StoreProduct[];
    /** Nombre accesible de la lista. */
    label: string;
    headingLevel?: 2 | 3;
}

export const ProductGrid: React.FC<ProductGridProps> = ({ products, label, headingLevel = 3 }) => (
    <ul
        aria-label={label}
        className="m-0 grid list-none grid-cols-2 gap-sm p-0 md:grid-cols-3 md:gap-lg xl:grid-cols-4"
    >
        {products.map((product) => (
            <li key={product.productKey} className="min-w-0">
                <ProductCard product={product} headingLevel={headingLevel} />
            </li>
        ))}
    </ul>
);
