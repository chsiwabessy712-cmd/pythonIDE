import React from "react";

export const Button = ({
    children,
    variant = "primary",
    className = "",
    ...props
}) => {
    const variants = {
        primary: "bg-violet-600 text-white hover:bg-violet-700 dark:hover:bg-violet-500",
        secondary:
            "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700",
        danger: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/30",
        success: "bg-emerald-600 text-white hover:bg-emerald-700",
        warning: "bg-amber-500 text-white hover:bg-amber-600",
        ghost: "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
    };
    return (
        <button
            className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
            {...props}>
            {children}
        </button>
    );
};
