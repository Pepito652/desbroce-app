// Cliente Supabase y Gestión de Sesiones para DesbroceApp
const supabaseUrl = 'https://ttxshuqgjieqooirlldt.supabase.co';
// API Key pública (anon key) real de Supabase
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0eHNodXFnamllcW9vaXJsbGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MDM0NDEsImV4cCI6MjEwMjQ3OTQ0MX0.EZRQYQeJeQcxDND5boItMUYkt9GiF6Zjodl79TYqYas'; 

let supabaseClient = null;

// Inicializar el cliente
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
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
        console.log(`[Sync] Sincronizando ${syncQueue.length} cambios pendientes con Supabase...`);

        // Procesar en orden cronológico
        for (const item of syncQueue) {
            // Actualizar tabla work_logs en Supabase para el tramo y equipo
            const { error } = await supabaseClient
                .from('work_logs')
                .upsert({
                    segment_id: item.tramoId,
                    reported_by: session.user.id,
                    status: item.changes.status || 'pendiente',
                    notes: item.changes.comment || '',
                    updated_at: new Date(item.timestamp).toISOString()
                }, { onConflict: 'segment_id' });

            if (error) {
                console.error(`[Sync] Error al sincronizar tramo ${item.tramoId}:`, error);
                throw error; // Detener bucle y reintentar en el próximo ciclo
            }
        }

        // Si todo se ha subido bien, limpiar cola
        localStorage.removeItem('desbroce_sync_queue');
        console.log("[Sync] Sincronización offline completada con éxito.");
    } catch (e) {
        console.error("[Sync] Fallo en el ciclo de sincronización:", e.message);
    } finally {
        isSyncing = false;
    }
}

// Escuchar cambios de red de forma nativa para disparar sincronizaciones pendientes
window.addEventListener('online', () => {
    console.log("[Red] Conexión recuperada. Disparando cola de sincronización...");
    triggerOfflineSync();
});

// Al cargar el documento, evaluar si mostramos el banner de invitación
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
        if (!supabaseClient) return;
        const { data: { session } } = await supabaseClient.auth.getSession();
        const banner = document.getElementById('authInviteBanner');
        if (!session && banner) {
            // Mostrar banner sutil de login tras 3 segundos si no está autenticado
            banner.style.display = 'flex';
        }
        checkSessionState();
    }, 3000);
});
