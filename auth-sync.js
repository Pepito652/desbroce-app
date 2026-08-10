/**
 * SERVICIO DE INTEGRACIÓN DE SUPABASE Y AUTENTICACIÓN
 * DesbroceApp-Web
 */

// Inicialización del cliente Supabase
const supabaseUrl = 'https://amowklcahxlqxgkvcumg.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtb3drbGNhaHhscXhna3ZjdW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMzNTQ1MjYsImV4cCI6MjAzODkzMDUyNn0.your-anon-key-mock'; // Reemplazar con la real o usar variable global

let supabaseClient = null;
let syncQueue = [];
let isSyncing = false;
let userSession = null;
let lastSyncTimestamp = '1970-01-01T00:00:00.000Z';

function initSupabase() {
    try {
        if (typeof supabaseUrl !== 'undefined' && typeof supabaseAnonKey !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
            supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
            console.log("Supabase Client inicializado correctamente.");
            
            // Escuchar cambios de estado en la autenticación
            supabaseClient.auth.onAuthStateChange((event, session) => {
                userSession = session;
                const offlinePanel = document.getElementById('authOfflineState');
                const onlinePanel = document.getElementById('authOnlineState');
                const userEmailLabel = document.getElementById('authUserEmail');
                const headerAuthBtn = document.getElementById('btnHeaderAuth');
                const inviteBanner = document.getElementById('authInviteBanner');
                
                if (session) {
                    if (offlinePanel) offlinePanel.style.display = 'none';
                    if (onlinePanel) onlinePanel.style.display = 'block';
                    if (userEmailLabel) userEmailLabel.innerText = session.user.email;
                    
                    // Actualizar botón de la cabecera del logo
                    if (headerAuthBtn) {
                        headerAuthBtn.title = `Sesión iniciada: ${session.user.email}`;
                        headerAuthBtn.style.borderColor = 'var(--accent)';
                        headerAuthBtn.innerHTML = '<i data-lucide="user-check" style="width: 16px; height: 16px; color: var(--accent);"></i>';
                    }

                    // Ocultar banner de invitación
                    if (inviteBanner) {
                        inviteBanner.classList.remove('show');
                        setTimeout(() => inviteBanner.style.display = 'none', 400);
                    }
                    
                    // Al iniciar sesión, sincronizamos
                    syncDataWithCloud();
                } else {
                    if (offlinePanel) offlinePanel.style.display = 'block';
                    if (onlinePanel) onlinePanel.style.display = 'none';
                    if (userEmailLabel) userEmailLabel.innerText = '-';

                    // Restaurar botón de la cabecera del logo
                    if (headerAuthBtn) {
                        headerAuthBtn.title = "Iniciar Sesión / Mi Cuenta";
                        headerAuthBtn.style.borderColor = 'var(--border-color)';
                        headerAuthBtn.innerHTML = '<i data-lucide="user" style="width: 16px; height: 16px;"></i>';
                    }

                    // Mostrar banner de invitación si no ha sido descartado expresamente
                    const isBannerDismissed = localStorage.getItem('auth-invite-dismissed') === 'true';
                    if (inviteBanner && !isBannerDismissed) {
                        inviteBanner.style.display = 'flex';
                        setTimeout(() => inviteBanner.classList.add('show'), 100);
                    }
                }
                if (typeof refreshLucideIcons === 'function') {
                    refreshLucideIcons();
                }
            });
        }
    } catch (e) {
        console.error("Error al inicializar Supabase client:", e);
    }
}

// Controladores del Modal de Login flotante
function openAuthModal() {
    const modal = document.getElementById('authModalOverlay');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModalOverlay');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Controladores del Banner de Invitación
function dismissAuthInviteBanner() {
    const inviteBanner = document.getElementById('authInviteBanner');
    if (inviteBanner) {
        inviteBanner.classList.remove('show');
        setTimeout(() => inviteBanner.style.display = 'none', 400);
    }
    localStorage.setItem('auth-invite-dismissed', 'true');
}

// Configurar formulario
let authMode = 'login';
function setAuthMode(mode) {
    authMode = mode;
    const btnTabLogin = document.getElementById('btnAuthTabLogin');
    const btnTabRegister = document.getElementById('btnAuthTabRegister');
    const btnSubmit = document.getElementById('btnAuthSubmit');
    
    if (mode === 'login') {
        if (btnTabLogin) btnTabLogin.classList.add('active');
        if (btnTabRegister) btnTabRegister.classList.remove('active');
        if (btnSubmit) {
            btnSubmit.innerHTML = '<i data-lucide="log-in" style="width: 16px; height: 16px;"></i> Iniciar Sesión';
        }
    } else {
        if (btnTabLogin) btnTabLogin.classList.remove('active');
        if (btnTabRegister) btnTabRegister.classList.add('active');
        if (btnSubmit) {
            btnSubmit.innerHTML = '<i data-lucide="user-plus" style="width: 16px; height: 16px;"></i> Registrar Cuenta';
        }
    }
    if (typeof refreshLucideIcons === 'function') {
        refreshLucideIcons();
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    if (!supabaseClient) {
        appAlert("Supabase no está listo. Intenta de nuevo.", "error");
        return;
    }
    
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const btnSubmit = document.getElementById('btnAuthSubmit');
    
    btnSubmit.disabled = true;
    
    try {
        if (authMode === 'login') {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            appAlert("Sesión iniciada con éxito.", "success");
            closeAuthModal();
        } else {
            const { data, error } = await supabaseClient.auth.signUp({ email, password });
            if (error) throw error;
            appAlert("Cuenta registrada. Verifica tu correo si es necesario.", "success");
            closeAuthModal();
        }
    } catch (err) {
        console.error(err);
        appAlert("Error de autenticación: " + err.message, "error");
    } finally {
        btnSubmit.disabled = false;
    }
}

async function handleLogout() {
    if (!supabaseClient) return;
    const confirmado = await appConfirm("¿Estás seguro de que quieres cerrar la sesión? Los datos locales permanecerán en este dispositivo.", "Cerrar Sesión", false);
    if (confirmado) {
        await supabaseClient.auth.signOut();
        appAlert("Sesión cerrada correctamente.", "info");
        closeAuthModal();
    }
}

// Lógica de cola de sincronización e IndexedDB (Fallback offline-first)
function addToSyncQueue(table, action, recordId, payload) {
    syncQueue.push({ table, action, recordId, payload, timestamp: new Date().toISOString() });
    localStorage.setItem('desbroce_sync_queue', JSON.stringify(syncQueue));
    
    // Intentar sincronizar si hay internet
    if (navigator.onLine) {
        processSyncQueue();
    }
}

async function processSyncQueue() {
    if (isSyncing || !supabaseClient || !userSession) return;
    
    const rawQueue = localStorage.getItem('desbroce_sync_queue');
    if (rawQueue) {
        syncQueue = JSON.parse(rawQueue);
    }
    
    if (syncQueue.length === 0) return;
    
    isSyncing = true;
    updateSyncStatus('syncing', 'Sincronizando...');
    
    try {
        while (syncQueue.length > 0) {
            const task = syncQueue[0];
            const { table, action, recordId, payload } = task;
            
            payload.user_id = userSession.user.id;
            
            let error = null;
            if (action === 'INSERT' || action === 'UPDATE') {
                const { error: upsertErr } = await supabaseClient
                    .from(table)
                    .upsert(payload);
                error = upsertErr;
            } else if (action === 'DELETE') {
                const { error: deleteErr } = await supabaseClient
                    .from(table)
                    .delete()
                    .eq('id', recordId);
                error = deleteErr;
            }
            
            if (error) {
                console.error(`Error procesando tarea en ${table}:`, error);
                // Si es un error temporal (ej. red), detenemos
                if (!navigator.onLine) break;
            }
            
            // Retirar de la cola local
            syncQueue.shift();
            localStorage.setItem('desbroce_sync_queue', JSON.stringify(syncQueue));
        }
        updateSyncStatus('success', 'Al día');
    } catch (e) {
        console.error("Fallo al procesar cola de sincronización:", e);
        updateSyncStatus('error', 'Error sync');
    } finally {
        isSyncing = false;
    }
}

function updateSyncStatus(status, text) {
    const statusEl = document.getElementById('syncCloudStatus');
    if (!statusEl) return;
    
    if (status === 'success') {
        statusEl.style.color = 'var(--accent)';
        statusEl.innerHTML = `<i data-lucide="cloud-check" style="width: 14px; height: 14px;"></i> ${text}`;
    } else if (status === 'syncing') {
        statusEl.style.color = '#60a5fa';
        statusEl.innerHTML = `<i data-lucide="refresh-cw" class="spin-icon" style="width: 14px; height: 14px;"></i> ${text}`;
    } else {
        statusEl.style.color = 'var(--danger)';
        statusEl.innerHTML = `<i data-lucide="cloud-off" style="width: 14px; height: 14px;"></i> ${text}`;
    }
    if (typeof refreshLucideIcons === 'function') {
        refreshLucideIcons();
    }
}

// Bajar datos remotos y mezclar con local
async function syncDataWithCloud() {
    if (!supabaseClient || !userSession) return;
    
    updateSyncStatus('syncing', 'Sincronizando...');
    
    try {
        // 1. Enviar cambios pendientes locales
        await processSyncQueue();
        
        // 2. Descargar archivos cargados
        const { data: remoteFiles, error: filesErr } = await supabaseClient
            .from('files')
            .select('*');
            
        if (filesErr) throw filesErr;
        
        // 3. Descargar tramos
        const { data: remoteTramos, error: tramosErr } = await supabaseClient
            .from('tramos')
            .select('*');
            
        if (tramosErr) throw tramosErr;
        
        // Si hay datos remotos, sobreescribir e integrar localmente
        if (remoteFiles && remoteFiles.length > 0) {
            state.loadedFiles = remoteFiles.map(f => ({
                id: f.id,
                name: f.name,
                tramosCount: f.tramosCount,
                hidden: f.hidden
            }));
            state.fileLoaded = true;
        }
        
        if (remoteTramos && remoteTramos.length > 0) {
            state.tramos = remoteTramos.map(t => ({
                id: t.id,
                fileId: t.fileId,
                name: t.name,
                length: t.length,
                coordinates: t.coordinates,
                originalCoordinates: t.originalCoordinates,
                status: t.status,
                dateCompleted: t.dateCompleted,
                rightMarginStatus: t.rightMarginStatus,
                rightMarginDate: t.rightMarginDate,
                leftMarginStatus: t.leftMarginStatus,
                leftMarginDate: t.leftMarginDate,
                observaciones: t.observaciones || [],
                weekGroup: t.weekGroup,
                color: t.color
            }));
            
            // Re-generar orden de ruta
            state.routeOrder = state.tramos.map(t => t.id);
        }
        
        // Guardar localmente el estado reconstruido
        localStorage.setItem('desbroce_app_state', JSON.stringify({
            loadedFiles: state.loadedFiles,
            fileLoaded: state.fileLoaded,
            tramos: state.tramos,
            routeOrder: state.routeOrder,
            currentBaseLayer: currentBaseLayer,
            customColors: state.customColors
        }));
        
        // Refrescar UI y mapa
        if (typeof updateUI === 'function') updateUI();
        if (typeof renderTramosOnMap === 'function') renderTramosOnMap();
        if (typeof fitMapToBounds === 'function') fitMapToBounds();
        
        updateSyncStatus('success', 'Al día');
    } catch (err) {
        console.error("Fallo al descargar de Supabase:", err);
        updateSyncStatus('error', 'Error de red');
    }
}

async function forceSync() {
    if (!navigator.onLine) {
        appAlert("Sin conexión a Internet.", "warning");
        return;
    }
    await syncDataWithCloud();
    appAlert("Sincronización completada.", "success");
}

// Exponer funciones globalmente
window.setAuthMode = setAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
window.handleLogout = handleLogout;
window.forceSync = forceSync;
window.initSupabase = initSupabase;
window.addToSyncQueue = addToSyncQueue;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.dismissAuthInviteBanner = dismissAuthInviteBanner;
