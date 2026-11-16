import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
);

export const DashboardSkeleton: React.FC = () => (
    <div className="p-lg flex flex-col gap-xl w-full">
        <div className="flex justify-between items-center bg-white p-lg border border-border rounded-lg shadow-sm">
            <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-10 w-32" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-lg">
            {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white p-lg border border-border rounded-lg shadow-sm flex flex-col gap-3">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                </div>
            ))}
        </div>

        <div className="bg-white p-lg border border-border rounded-lg shadow-sm h-[300px]">
            <Skeleton className="h-full w-full" />
        </div>
    </div>
);

export const TableSkeleton: React.FC = () => (
    <div className="p-xl bg-white border border-border rounded-lg shadow-sm w-full flex flex-col gap-lg">
        <div className="flex justify-between items-center">
            <Skeleton className="h-8 w-48" />
            <div className="flex gap-2">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
            </div>
        </div>
        <div className="flex flex-col gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="flex gap-4 py-2 border-b border-border">
                    <Skeleton className="h-6 flex-1" />
                    <Skeleton className="h-6 flex-1" />
                    <Skeleton className="h-6 flex-1" />
                    <Skeleton className="h-6 w-20" />
                </div>
            ))}
        </div>
    </div>
);
