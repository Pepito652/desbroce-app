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

            // Cambiar icono de cabecera a conectado (verde)
            if (headerIcon) headerIcon.setAttribute('data-lucide', 'user-check');
            if (headerBtn) headerBtn.style.borderColor = 'var(--accent)';

            // Lanzar sincronización inicial de fondo
            triggerOfflineSync();
        } else {
            // Usuario desconectado
            title.innerText = "Iniciar Sesión";
            if (loginForm) loginForm.style.display = 'flex';
            if (userView) userView.style.display = 'none';
            if (btnSkip) btnSkip.style.display = 'block';

            if (headerIcon) headerIcon.setAttribute('data-lucide', 'user');
            if (headerBtn) headerBtn.style.borderColor = 'var(--border-color)';
        }

        if (window.refreshLucideIcons) refreshLucideIcons();
    } catch (e) {
        console.error("Error al comprobar sesión:", e);
    }
}

// Iniciar sesión
async function handleLoginSubmit(event) {
    event.preventDefault();
    if (!supabaseClient) {
        alert("El servicio de base de datos no está disponible.");
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
            alert("Error de acceso: " + error.message);
        } else {
            closeAuthModal();
            checkSessionState();
            
            // Forzar recarga del LocalStorage bajo la nueva sesión online
            if (typeof loadFromLocalStorage === 'function') {
                loadFromLocalStorage();
            }

            if (typeof appAlert === 'function') {
                appAlert("Sesión iniciada correctamente.", "success");
            }
        }
    } catch (err) {
        alert("Fallo de red al intentar conectar.");
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
            if (item.changes.status === 'completed') dbStatus = 'completado';
            else if (item.changes.status === 'partial') dbStatus = 'en_progreso';
            else if (item.changes.status === 'incidencia') dbStatus = 'incidencia';

            // Construir un paquete de información rica en formato JSON estructurado dentro del campo notes
            const enrichedNotesObj = {
                left_margin: item.changes.leftMarginStatus || 'pending',
                right_margin: item.changes.rightMarginStatus || 'pending',
                week: item.changes.weekCompleted || null,
                date: item.changes.dateCompleted || new Date().toISOString(),
                alerts_count: item.changes.observaciones ? item.changes.observaciones.length : 0,
                alerts: item.changes.observaciones || [],
                user_comment: item.changes.comment || ''
            };
            const enrichedNotesStr = JSON.stringify(enrichedNotesObj);

            // 1. Intentar actualizar directamente el registro existente en work_logs para este segmento
            let query = supabaseClient
                .from('work_logs')
                .update({
                    status: dbStatus,
                    reported_by: session.user.id,
                    notes: enrichedNotesStr,
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
                            reported_by: session.user.id,
                            status: dbStatus,
                            notes: enrichedNotesStr,
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

// Escuchar cambios de red de forma nativa para disparar sincronizaciones pendientes
window.addEventListener('online', () => {
    console.log("[Red] Conexión recuperada. Disparando cola de sincronización...");
    triggerOfflineSync();
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
            // Cargar tramos asignados de forma automática
            if (typeof loadAssignedSegments === 'function') {
                loadAssignedSegments(session.user.id);
            }
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
