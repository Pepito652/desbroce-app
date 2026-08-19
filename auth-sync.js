// Cliente Supabase y Gestión de Sesiones para DesbroceApp
const supabaseUrl = 'https://ttxshuqgjieqooirlldt.supabase.co';
// API Key pública (anon key) real de Supabase
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0eHNodXFnamllcW9vaXJsbGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MDM0NDEsImV4cCI6MjEwMjQ3OTQ0MX0.EZRQYQeJeQcxDND5boItMUYkt9GiF6Zjodl79TYqYas'; 

let supabaseClient = null;

// Inicializar el cliente
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
    // Mantener la sesión activa en memoria global síncrona
    window.currentAuthSession = null;
    supabaseClient.auth.onAuthStateChange((event, session) => {
        window.currentAuthSession = session;
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            console.log("[Auth] Sesión activa confirmada:", session?.user?.email);
        }
    });
    // Obtener sesión inicial
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
        window.currentAuthSession = session;
    }).catch(e => console.warn("Error recuperando sesión:", e));
} else {
    console.warn("Librería de Supabase no cargada. Trabajando en modo local offline.");
}

// Funciones de control de interfaz de autenticación
function openAuthModal() {
    const modal = document.getElementById('authModalOverlay');
    if (modal) {
        modal.style.display = 'flex';
        // Ajustar vistas según sesión
        checkSessionState();
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModalOverlay');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Verificar estado de sesión y cambiar vista en el modal
async function checkSessionState() {
    if (!supabaseClient) return;

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const loginForm = document.getElementById('loginForm');
        const userView = document.getElementById('userProfileView');
        const title = document.getElementById('authModalTitle');
        const btnSkip = document.getElementById('btnAuthSkip');
        const headerIcon = document.getElementById('headerAuthIcon');
        const headerBtn = document.getElementById('btnHeaderAuth');

        if (session) {
            // Usuario conectado
            title.innerText = "Mi Cuenta";
            if (loginForm) loginForm.style.display = 'none';
            if (userView) userView.style.display = 'flex';
            if (btnSkip) btnSkip.style.display = 'none';

            // Consultar datos de perfil en Supabase
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('full_name, role')
                .eq('id', session.user.id)
                .single();

            if (profile) {
                document.getElementById('userProfileName').innerText = profile.full_name || session.user.email;
                const roleLabel = document.getElementById('userProfileRole');
                roleLabel.innerText = profile.role.toUpperCase();
                
                // Cambiar color de fondo según rol
                if (profile.role === 'admin') {
                    roleLabel.style.background = 'rgba(59, 130, 246, 0.15)';
                    roleLabel.style.color = '#60a5fa';
                } else {
                    roleLabel.style.background = 'rgba(16, 185, 129, 0.15)';
                    roleLabel.style.color = '#10b981';
                }
            } else {
                // Si no hay perfil en public.profiles, mostrar su email y rol peón de forma temporal
                document.getElementById('userProfileName').innerText = session.user.email;
                const roleLabel = document.getElementById('userProfileRole');
                roleLabel.innerText = "PEÓN (SIN PERFIL)";
                roleLabel.style.background = 'rgba(239, 68, 68, 0.15)';
                roleLabel.style.color = '#ef4444';
            }

            // Consultar equipo asignado
            const { data: teamMember } = await supabaseClient
                .from('team_members')
                .select('team_id')
                .eq('profile_id', session.user.id)
                .maybeSingle();

            if (teamMember && teamMember.team_id) {
                const { data: team } = await supabaseClient
                    .from('work_teams')
                    .select('name')
                    .eq('id', teamMember.team_id)
                    .single();
                if (team) {
                    document.getElementById('userProfileTeam').innerText = team.name;
                }
            } else {
                document.getElementById('userProfileTeam').innerText = "Sin equipo asignado";
            }

            // Actualizar icono de usuario (monigote verde si está conectado)
            if (headerIcon) {
                headerIcon.style.color = '#10b981';
            }
            if (headerBtn) {
                headerBtn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                headerBtn.title = `Conectado como: ${profile?.full_name || session.user.email}`;
            }

            // Actualizar indicador de nube a conectado en verde
            updateCloudConnectionStatus(true);

            // Lanzar sincronización inicial de fondo
            triggerOfflineSync();
        } else {
            // Usuario desconectado
            title.innerText = "Iniciar Sesión";
            if (loginForm) loginForm.style.display = 'flex';
            if (userView) userView.style.display = 'none';
            if (btnSkip) btnSkip.style.display = 'block';

            if (headerIcon) {
                headerIcon.style.color = '#a1a1aa';
            }
            if (headerBtn) {
                headerBtn.style.borderColor = 'var(--border-color)';
                headerBtn.title = "Iniciar Sesión / Mi Cuenta";
            }

            // Indicador de nube en modo local
            updateCloudConnectionStatus(false);
        }

        if (window.refreshLucideIcons) refreshLucideIcons();
    } catch (e) {
        console.error("Error al comprobar sesión:", e);
    }
}

// Función para actualizar el icono de la nube en la barra superior
function updateCloudConnectionStatus(isConnected) {
    const cloudContainer = document.getElementById('headerCloudStatus');
    const cloudIcon = document.getElementById('headerCloudIcon');
    if (!cloudContainer || !cloudIcon) return;

    if (isConnected && navigator.onLine) {
        cloudContainer.style.color = '#10b981';
        cloudContainer.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        cloudContainer.style.background = 'rgba(16, 185, 129, 0.08)';
        cloudContainer.title = "Nube Conectada: Sincronización en tiempo real activa";
        cloudIcon.setAttribute('data-lucide', 'cloud');
    } else {
        cloudContainer.style.color = '#71717a';
        cloudContainer.style.borderColor = 'var(--border-color)';
        cloudContainer.style.background = 'rgba(255, 255, 255, 0.03)';
        cloudContainer.title = "Modo Local: Sin conexión a la nube (los datos se guardan en el móvil)";
        cloudIcon.setAttribute('data-lucide', 'cloud-off');
    }
    if (window.refreshLucideIcons) refreshLucideIcons();
}

// Iniciar sesión
async function handleLoginSubmit(event) {
    event.preventDefault();
    if (!supabaseClient) {
        if (typeof appAlert === 'function') appAlert("El servicio de base de datos no está disponible.", 'error');
        return;
    }

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            if (typeof appAlert === 'function') appAlert("Error de acceso: " + error.message, 'error');
        } else {
            closeAuthModal();
            checkSessionState();
            
            // Iniciar sincronización Realtime con el ID del usuario
            if (data.session && data.session.user) {
                initRealtimeSync(data.session.user.id);
                if (typeof loadAssignedSegments === 'function') {
                    loadAssignedSegments(data.session.user.id);
                }
            }

            if (typeof loadFromLocalStorage === 'function') {
                loadFromLocalStorage();
            }

            if (typeof appAlert === 'function') {
                appAlert("Sesión iniciada correctamente.", "success");
            }
        }
    } catch (err) {
        if (typeof appAlert === 'function') appAlert("Fallo de red al intentar conectar: " + err.message, 'error');
    }
}

// Cerrar sesión
async function handleLogout() {
    if (!supabaseClient) return;

    try {
        const { error } = await supabaseClient.auth.signOut();
        if (!error) {
            checkSessionState();
            closeAuthModal();
            
            // Forzar volver a mostrar pantalla de bienvenida
            const welcomeOverlay = document.getElementById('welcomeScreenOverlay');
            if (welcomeOverlay) {
                welcomeOverlay.classList.remove('fade-out');
                welcomeOverlay.style.display = 'flex';
            }

            // Recargar datos locales aislados del invitado
            if (typeof loadFromLocalStorage === 'function') {
                loadFromLocalStorage();
            }

            if (typeof appAlert === 'function') {
                appAlert("Sesión cerrada correctamente.", "info");
            }
        }
    } catch (e) {
        console.error("Error al cerrar sesión:", e);
    }
}

// --- COLA DE SINCRONIZACIÓN OFFLINE-FIRST ---

let isSyncing = false;

// Encolar los cambios en el LocalStorage
function queueTramoForSync(tramoId, changes) {
    let syncQueue = [];
    try {
        const rawQueue = localStorage.getItem('desbroce_sync_queue');
        if (rawQueue) {
            syncQueue = JSON.parse(rawQueue);
        }
    } catch (e) {
        console.error("Error al leer cola de sincronización:", e);
    }

    // Agregar o actualizar cambio en la cola
    const existingIndex = syncQueue.findIndex(q => q.tramoId === tramoId);
    if (existingIndex > -1) {
        syncQueue[existingIndex].changes = { ...syncQueue[existingIndex].changes, ...changes };
        syncQueue[existingIndex].timestamp = Date.now();
    } else {
        syncQueue.push({
            tramoId: tramoId,
            changes: changes,
            timestamp: Date.now()
        });
    }

    localStorage.setItem('desbroce_sync_queue', JSON.stringify(syncQueue));
    
    // Intentar sincronizar inmediatamente si hay conexión
    triggerOfflineSync();
}

// Intentar vaciar la cola de cambios hacia Supabase
async function triggerOfflineSync() {
    if (isSyncing || !navigator.onLine || !supabaseClient) return;

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return; // No sincronizar si no está autenticado

        const rawQueue = localStorage.getItem('desbroce_sync_queue');
        if (!rawQueue) return;

        const syncQueue = JSON.parse(rawQueue);
        if (syncQueue.length === 0) return;

        isSyncing = true;
        if (typeof logDebug === 'function') {
            logDebug(`[Nube] Enviando ${syncQueue.length} avance(s) a Supabase...`, 'info');
        }

        // Obtener el team_id al que pertenece este operario
        const { data: memberData, error: memErr } = await supabaseClient
            .from('team_members')
            .select('team_id')
            .eq('profile_id', session.user.id)
            .maybeSingle();

        if (memErr) {
            if (typeof logDebug === 'function') logDebug(`[Nube] Error equipo: ${memErr.message}`, 'error');
        }

        const operTeamId = memberData ? memberData.team_id : null;

        // Procesar cada tramo modificado en la cola
        for (const item of syncQueue) {
            // Mapear estados locales del tramo a estados de Supabase
            let dbStatus = 'pendiente';
            if (item.changes.status === 'completed' || item.changes.status === 'completado') dbStatus = 'completado';
            else if (item.changes.status === 'partial' || item.changes.status === 'en_progreso') dbStatus = 'en_progreso';
            else if (item.changes.status === 'incidencia') dbStatus = 'incidencia';

            // Construir un paquete de información rica en formato JSON estructurado dentro del campo notes
            const enrichedNotesObj = {
                left_margin: item.changes.leftMarginStatus || 'pending',
                right_margin: item.changes.rightMarginStatus || 'pending',
                week: item.changes.weekCompleted || null,
                date: item.changes.dateCompleted || new Date().toISOString(),
                alerts_count: item.changes.observaciones ? item.changes.observaciones.length : 0,
                alerts: item.changes.observaciones || [],
                active_rework: (item.changes.active_rework !== undefined) ? item.changes.active_rework : null,
                repass_history: item.changes.repass_history || [],
                user_comment: item.changes.comment || ''
            };
            const enrichedNotesStr = JSON.stringify(enrichedNotesObj);

            // Si el estado vuelve a pendiente (ambos márgenes sin hacer), reported_by se limpia a null
            const reportedByVal = dbStatus === 'pendiente' ? null : session.user.id;

            // 1. Intentar actualizar directamente el registro existente en work_logs para este segmento
            let query = supabaseClient
                .from('work_logs')
                .update({
                    status: dbStatus,
                    reported_by: reportedByVal,
                    notes: dbStatus === 'pendiente' ? null : enrichedNotesStr,
                    updated_at: new Date(item.timestamp).toISOString()
                })
                .eq('segment_id', item.tramoId);

            if (operTeamId) {
                query = query.eq('team_id', operTeamId);
            }

            const { data: updatedRows, error: updateErr } = await query.select();

            if (updateErr) {
                console.error(`[Sync] Error al actualizar tramo ${item.tramoId}:`, updateErr);
                if (typeof logDebug === 'function') {
                    logDebug(`[Nube] Error Supabase: ${updateErr.message}`, 'error');
                }
                throw updateErr;
            }

            // Si no existía la fila asignada, insertarla
            if (!updatedRows || updatedRows.length === 0) {
                if (operTeamId) {
                    const { error: insErr } = await supabaseClient
                        .from('work_logs')
                        .insert({
                            segment_id: item.tramoId,
                            team_id: operTeamId,
                            reported_by: reportedByVal,
                            status: dbStatus,
                            notes: dbStatus === 'pendiente' ? null : enrichedNotesStr,
                            updated_at: new Date(item.timestamp).toISOString()
                        });
                    if (insErr) {
                        if (typeof logDebug === 'function') logDebug(`[Nube] Error insert: ${insErr.message}`, 'error');
                        throw insErr;
                    }
                }
            }

            if (typeof logDebug === 'function') {
                logDebug(`[Nube] Tramo guardado en Supabase -> Estado: ${dbStatus}`, 'success');
            }
        }

        // Si todo se ha subido bien, limpiar cola
        localStorage.removeItem('desbroce_sync_queue');
        console.log("[Sync] Sincronización offline completada con éxito.");
    } catch (e) {
        console.error("[Sync] Fallo en el ciclo de sincronización:", e.message);
        if (typeof logDebug === 'function') {
            logDebug(`[Nube] Fallo de sincronización: ${e.message}`, 'warn');
        }
    } finally {
        isSyncing = false;
    }
}

// --- CANAL REALTIME Y AUTO-ACTUALIZACIÓN SILENCIOSA DE FONDO ---

let realtimeChannel = null;
let realtimePollInterval = null;

function initRealtimeSync(userId) {
    if (!supabaseClient || !userId) return;

    // 1. Limpiar canal previo si existía
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    try {
        // 2. Suscribirse en tiempo real a cualquier cambio en work_logs y segments
        realtimeChannel = supabaseClient
            .channel('desbroce-app-realtime-' + userId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'work_logs' }, (payload) => {
                console.log("[Realtime] Cambio en asignaciones de trabajo:", payload);
                if (typeof loadAssignedSegments === 'function') {
                    loadAssignedSegments(userId, true); // true = silencioso
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'segments' }, (payload) => {
                console.log("[Realtime] Cambio en geometrías de tramos:", payload);
                if (typeof loadAssignedSegments === 'function') {
                    loadAssignedSegments(userId, true); // true = silencioso
                }
            })
            .subscribe((status) => {
                console.log("[Realtime] Estado canal en vivo:", status);
            });
    } catch (err) {
        console.warn("[Realtime] Fallo al iniciar canal de tiempo real:", err);
    }
}

// 3. Auto-recarga inmediata al desbloquear la pantalla o volver a poner la app en primer plano
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && supabaseClient) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && typeof loadAssignedSegments === 'function') {
                loadAssignedSegments(session.user.id, true);
            }
        } catch (e) {}
    }
});

// Escuchar cambios de red de forma nativa para disparar sincronizaciones pendientes
window.addEventListener('online', () => {
    console.log("[Red] Conexión recuperada.");
    updateCloudConnectionStatus(true);
    triggerOfflineSync();
    if (supabaseClient) {
        supabaseClient.auth.getSession().then(({ data: { session } }) => {
            if (session && typeof loadAssignedSegments === 'function') {
                loadAssignedSegments(session.user.id, true);
            }
        });
    }
});

window.addEventListener('offline', () => {
    console.log("[Red] Sin conexión a Internet. Pasando a modo local.");
    updateCloudConnectionStatus(false);
});

// Al cargar el documento, evaluar si mostramos la pantalla de bienvenida o recuperamos la sesión
document.addEventListener('DOMContentLoaded', async () => {
    if (!supabaseClient) {
        welcomeActionLocal();
        return;
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            // Ya está logueado, ocultar pantalla de bienvenida de inmediato
            const welcomeOverlay = document.getElementById('welcomeScreenOverlay');
            if (welcomeOverlay) {
                welcomeOverlay.style.display = 'none';
            }
            checkSessionState();
            // Cargar tramos asignados de forma automática y arrancar canal en tiempo real
            if (typeof loadAssignedSegments === 'function') {
                loadAssignedSegments(session.user.id);
            }
            initRealtimeSync(session.user.id);
        } else {
            // Mostrar pantalla de bienvenida interactiva
            const welcomeOverlay = document.getElementById('welcomeScreenOverlay');
            if (welcomeOverlay) {
                welcomeOverlay.style.display = 'flex';
            }
        }
    } catch (e) {
        console.error("[Session] Error al recuperar sesión inicial:", e);
    }
});

// Exponer funciones globales de sincronización para app.js
window.queueTramoForSync = queueTramoForSync;
window.triggerOfflineSync = triggerOfflineSync;
window.initRealtimeSync = initRealtimeSync;

