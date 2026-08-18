/**
 * components/badges.js
 * Componentes de insignias (badges) de estado, márgenes, semanas y alertas
 * Fieles a la identidad visual de DesbroceApp
 */

export function createMarginBadge(side, status) {
    const isCompleted = status === 'completed';
    const label = side === 'left' ? 'Izq' : 'Der';
    const fullLabel = isCompleted ? 'Finalizado' : 'Pend';
    const color = isCompleted ? '#10b981' : '#71717a';
    
    return `<span style="color:${color}; font-size:0.65rem; font-weight:500;">${label}: ${fullLabel}</span>`;
}

export function createStatusBadge(status, color) {
    let safeColor = color;
    if (!safeColor) {
        if (status === 'completado' || status === 'completed') safeColor = '#10b981';
        else if (status === 'repaso' || status === 'repaso_requerido') safeColor = '#f97316';
        else if (status === 'en_progreso' || status === 'partial') safeColor = '#fbbf24';
        else if (status === 'incidencia') safeColor = '#ef4444';
        else safeColor = '#9ca3af';
    }
    const label = status === 'repaso' ? 'REPASO' : status;
    return `<span style="font-size:0.65rem; text-transform:uppercase; font-weight:700; color:${safeColor};">${label}</span>`;
}

export function createWeekBadge(week) {
    if (!week) return '';
    return `<span style="background:rgba(99,102,241,0.15); color:#818cf8; padding:1px 5px; border-radius:4px; font-size:0.62rem; font-weight:600; border:1px solid rgba(99,102,241,0.25);">${week}</span>`;
}

export function createAlertsBadge(alertsCount) {
    if (!alertsCount || alertsCount <= 0) return '';
    return `<span style="background:rgba(239,68,68,0.18); color:#ef4444; border:1px solid rgba(239,68,68,0.3); padding:1px 5px; border-radius:4px; font-size:0.62rem; font-weight:600;">⚠️ ${alertsCount}</span>`;
}

// Exponer en window para compatibilidad sin módulos
if (typeof window !== 'undefined') {
    window.DesbroceBadges = {
        createMarginBadge,
        createStatusBadge,
        createWeekBadge,
        createAlertsBadge
    };
}
