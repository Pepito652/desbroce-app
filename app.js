/**
 * DesbroceApp - Gestor de Rutas y Carreteras
 * Lógica principal en Javascript (Offline-First)
 */

// --- DIAGNÓSTICOS DE DEBUG ---
function logDebug(msg, type = 'info') {
    try {
        const debugLog = document.getElementById('appDebugLog');
        if (debugLog) {
            const time = new Date().toLocaleTimeString();
            const color = type === 'error' ? '#ef4444' : (type === 'warn' ? '#f59e0b' : '#10b981');
            const cleanMsg = typeof msg === 'object' ? JSON.stringify(msg) : msg;
            if (debugLog.innerText === 'Ningún error registrado. La app está funcionando.') {
                debugLog.innerHTML = '';
            }
            debugLog.innerHTML = `<div style="color: ${color}; margin-bottom: 4px; font-family: monospace; white-space: pre-wrap;">[${time}] [${type.toUpperCase()}] ${cleanMsg}</div>` + debugLog.innerHTML;
            
            // Colorear el punto indicador en el cabecero colapsable
            const warningDot = document.getElementById('debugWarningDot');
            if (warningDot) {
                if (type === 'error') {
                    warningDot.style.backgroundColor = '#ef4444';
                } else if (type === 'warn') {
                    // No sobreescribir si ya está en color de error (rojo)
                    if (warningDot.style.backgroundColor !== 'rgb(239, 68, 68)' && warningDot.style.backgroundColor !== '#ef4444') {
                        warningDot.style.backgroundColor = '#f59e0b';
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error al pintar log en pantalla:", e);
    }
}

// Capturar errores no controlados
window.onerror = function(message, source, lineno, colno, error) {
    const filename = source ? source.split('/').pop() : 'desconocido';
    logDebug(`${message} (en ${filename}:${lineno}:${colno})`, 'error');
    return false;
};

// Capturar promesas fallidas (asíncronas)
window.onunhandledrejection = function(event) {
    logDebug(`Promesa fallida sin catch: ${event.reason ? event.reason.message || event.reason : event}`, 'error');
};

const APP_VERSION = '0.1.11';

let state = {
    fileLoaded: false,
    loadedFiles: [],    // Array de archivos cargados: { id, name, tramosCount }
    tramos: [],         // Array de tramos parsed de KML
    routeOrder: [],     // Ordenación de IDs de los tramos
    gpsActive: false,
    userLocation: null, // L.LatLng de la posición actual del GPS
    selectedTramoId: null,
    activeWork: {       // Estado del modo de trabajo activo
        tramoId: null,
        margin: 'right', // 'right' o 'left'
        direction: null, // 'forward' o 'backward'
        startLatLng: null,
        maxFraction: 0,
        startTime: null
    },
    customColors: {},   // Colores de la leyenda personalizados por el usuario
    isSplitMode: false, // Indica si está activo el modo de división/corte de tramos
    splitTramoId: null,  // ID del tramo que se está dividiendo actualmente
    isObsMode: false,   // Indica si está activo el modo de marcación de alerta manual
    obsTramoId: null    // ID del tramo sobre el que se está marcando la alerta
};

// --- PALETA DE COLORES SEMANALES ---
// Colores vibrantes y distinguibles para cada semana de trabajo
const COLOR_PALETTE = [
    '#10b981', // Verde Esmeralda
    '#3b82f6', // Azul
    '#8b5cf6', // Violeta
    '#f59e0b', // Ámbar/Naranja
    '#ec4899', // Rosa
    '#06b6d4', // Cian
    '#eab308', // Amarillo
    '#f43f5e', // Rosa Intenso
    '#a855f7', // Púrpura
    '#6366f1', // Índigo
    '#14b8a6', // Turquesa
    '#f97316'  // Naranja Oscuro
];

// Colores de estado
function getPendingColor() {
    return state && state.customColors && state.customColors['pending'] ? state.customColors['pending'] : '#ef4444';
}
function getPartialColor() {
    return state && state.customColors && state.customColors['partial'] ? state.customColors['partial'] : '#fbbf24';
}
function getBlockedColor() {
    return state && state.customColors && state.customColors['blocked'] ? state.customColors['blocked'] : '#b91c1c';
}
const COLOR_COMPLETED_DEFAULT = '#10b981'; // Verde por defecto
const COLOR_GPS = '#3b82f6';

// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let map;
let tramosLayerGroup;
let gpsMarker;
let gpsCircle;
let hasInitialGpsReorder = false;
let highlightedLayer = null;
let originalStyle = {};
let darkTileLayer = null;
let satelliteTileLayer = null;
let currentBaseLayer = 'dark'; // 'dark' o 'satellite'

// Función para refrescar y renderizar los iconos de Lucide
function refreshLucideIcons() {
    try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    } catch (e) {
        console.error("Error al renderizar iconos de Lucide:", e);
    }
}
window.refreshLucideIcons = refreshLucideIcons;

document.addEventListener('DOMContentLoaded', () => {
    // Inyectar el número de versión dinámicamente en el menú lateral
    const versionLabel = document.getElementById('appVersionLabel');
    if (versionLabel) {
        versionLabel.innerText = `Versión v${APP_VERSION}`;
    }

    initMap();
    initEventListeners();
    loadFromLocalStorage();
    refreshLucideIcons();

    // Ajustar el mapa al cambiar el tamaño de la ventana del navegador
    window.addEventListener('resize', () => {
        if (map) {
            map.invalidateSize();
        }
    });
});

// Inicialización del Mapa Leaflet con tema oscuro
function initMap() {
    // Coordenadas por defecto (Centro de España por si no hay datos)
    map = L.map('map', {
        preferCanvas: true,
        zoomControl: false,
        maxZoom: 21,
        minZoom: 5,
        rotate: true,
        touchRotate: true,
        rotateControl: {
            closeOnZeroBearing: false,
            position: 'bottomleft'
        },
        zoomAnimation: false
    }).setView([40.416775, -3.703790], 6);

    // Añadir el control de zoom en la parte inferior izquierda
    L.control.zoom({
        position: 'bottomleft'
    }).addTo(map);

    // Añadir el nombre de la app como prefijo de atribuciones
    if (map.attributionControl) {
        map.attributionControl.setPrefix('DesbroceApp | ');
    }

    // Capa de mapa oscuro de CartoDB (gratuita, limpia y moderna)
    darkTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 21,
        maxNativeZoom: 20
    });

    // Capa de satélite de Esri World Imagery (gratuita, rápida y detallada)
    satelliteTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri',
        maxZoom: 21,
        maxNativeZoom: 19
    });

    // Por defecto activamos la oscura
    darkTileLayer.addTo(map);

    tramosLayerGroup = L.featureGroup().addTo(map);

    // Hacer los bocadillos de información (popups) arrastrables para que no tapen la carretera seleccionada
    map.on('popupopen', function(e) {
        refreshLucideIcons();
        const popup = e.popup;
        const container = popup.getElement();
        if (!container) return;

        const wrapper = container.querySelector('.leaflet-popup-content-wrapper');
        if (!wrapper) return;

        wrapper.style.cursor = 'move';

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let currentMarginLeft = parseInt(container.style.marginLeft) || 0;
        let currentBottom = parseInt(container.style.bottom) || 0;

        const onMouseDown = function(event) {
            const tag = event.target.tagName.toLowerCase();
            if (tag === 'button' || tag === 'a' || tag === 'select' || tag === 'input' || event.target.closest('.leaflet-popup-close-button')) {
                return;
            }

            isDragging = true;
            startX = event.clientX || (event.touches && event.touches[0].clientX);
            startY = event.clientY || (event.touches && event.touches[0].clientY);
            
            currentMarginLeft = parseInt(container.style.marginLeft) || 0;
            currentBottom = parseInt(container.style.bottom) || 0;

            event.preventDefault();
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        };

        const onMouseMove = function(event) {
            if (!isDragging) return;
            
            const clientX = event.clientX || (event.touches && event.touches[0].clientX);
            const clientY = event.clientY || (event.touches && event.touches[0].clientY);
            
            const dx = clientX - startX;
            const dy = clientY - startY;

            container.style.marginLeft = (currentMarginLeft + dx) + 'px';
            container.style.bottom = (currentBottom - dy) + 'px';
        };

        const onMouseUp = function() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        const onTouchMove = function(event) {
            if (!isDragging) return;
            event.preventDefault(); // Evitar scroll en móvil durante arrastre
            onMouseMove(event);
        };

        const onTouchEnd = function() {
            isDragging = false;
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };

        wrapper.addEventListener('mousedown', onMouseDown);
        wrapper.addEventListener('touchstart', onMouseDown, { passive: false });
    });

    // Invalidador de tamaño mediante ResizeObserver para reaccionar a cualquier cambio de dimensiones del contenedor
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            if (map) {
                map.invalidateSize();
            }
        });
        const mapEl = document.getElementById('map');
        if (mapEl) {
            resizeObserver.observe(mapEl);
        }
    }

    // Rotación estilo Google Earth mediante el botón central del ratón (rueda)
    const mapContainer = map.getContainer();
    let isRotating = false;
    let startX = 0;
    let startBearing = 0;

    mapContainer.addEventListener('mousedown', function(e) {
        if (e.button === 1) { // Botón central (rueda)
            e.preventDefault();
            isRotating = true;
            startX = e.clientX;
            startBearing = map.getBearing();

            map.dragging.disable();

            const onMouseMoveRotate = function(moveEvent) {
                if (!isRotating) return;
                const deltaX = moveEvent.clientX - startX;
                const newBearing = (startBearing + deltaX * 0.5) % 360;
                map.setBearing(newBearing);
            };

            const onMouseUpRotate = function(upEvent) {
                if (upEvent.button === 1) {
                    isRotating = false;
                    map.dragging.enable();
                    document.removeEventListener('mousemove', onMouseMoveRotate);
                    document.removeEventListener('mouseup', onMouseUpRotate);
                }
            };

            document.addEventListener('mousemove', onMouseMoveRotate);
            document.addEventListener('mouseup', onMouseUpRotate);
        }
    });

    // Escuchar actualizaciones de ubicación nativas de React Native (GPS de Expo)
    window.addEventListener('message', function(event) {
        try {
            // Ignorar mensajes que no sean cadenas de texto o no contengan la palabra clave gpsLocation
            if (typeof event.data !== 'string' || !event.data.includes('gpsLocation')) {
                return;
            }
            
            const data = JSON.parse(event.data);
            if (data.type === 'gpsLocation') {
                const latlng = L.latLng(data.coords.latitude, data.coords.longitude);
                const mockLocationEvent = {
                    latlng: latlng,
                    accuracy: data.coords.accuracy,
                    heading: data.coords.heading,
                    speed: data.coords.speed
                };
                
                // Forzar activación visual del botón GPS si el estado no coincide
                const btn = document.getElementById('gpsToggle');
                if (btn && !btn.classList.contains('active')) {
                    btn.classList.add('active');
                }
                state.gpsActive = true;
                
                onLocationFound(mockLocationEvent);
            } else if (data.type === 'gpsLocationError') {
                // Si la app móvil falló al dar permisos nativos, desactivar botón GPS visual en la web
                const btn = document.getElementById('gpsToggle');
                if (btn && btn.classList.contains('active')) {
                    btn.classList.remove('active');
                }
                state.gpsActive = false;
                updateUI();
            }
        } catch(e) {
            // Ignorar silenciosamente errores de parseo de otros mensajes del navegador
        }
    });

    // Escuchar clics en el mapa vacío para cerrar la tarjeta inferior de detalles y el menú lateral en móvil
    map.on('click', (e) => {
        if (!state.isSplitMode) {
            closeRoadDetail();
        }
        
        // Cerrar sidebar en móvil al pulsar en el mapa
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
        }
    });
}

// Inicialización de Event Listeners de la UI
function initEventListeners() {
    try {
        // Navegación de pestañas
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation(); // Evitar que el clic en la pestaña se propague a document y cierre el sidebar en móvil
                tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                const targetId = tab.getAttribute('data-tab');
                document.getElementById(targetId).classList.add('active');
            });
        });

        // Carga de Archivos
        const fileInput = document.getElementById('fileInput');
        const dropArea = document.getElementById('dropArea');

        fileInput.addEventListener('change', handleFileSelect);

        // Arrastrar y soltar
        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropArea.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropArea.classList.remove('dragover');
            }, false);
        });

        dropArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length) {
                fileInput.files = files;
                handleFileSelect({ target: fileInput });
            }
        });

        // Menú Toggle en móvil, tablet y monitor
        const menuToggle = document.getElementById('menuToggle');
        const sidebar = document.getElementById('sidebar');
        const closeSidebar = document.getElementById('closeSidebar');

        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Forzar comprobación de actualización de PWA en red al interactuar con el menú
            if (typeof window.checkForPwaUpdate === 'function') {
                window.checkForPwaUpdate();
            }
            
            // Si tiene la clase 'has-update', significa que hay una nueva versión y debemos cambiar a la pestaña 'Carga'
            const hasUpdate = menuToggle.classList.contains('has-update');
            if (hasUpdate) {
                // Activar pestaña Carga visualmente
                const tabs = document.querySelectorAll('.tab-btn');
                tabs.forEach(t => {
                    if (t.getAttribute('data-tab') === 'tabCarga') {
                        t.classList.add('active');
                    } else {
                        t.classList.remove('active');
                    }
                });
                
                // Mostrar contenedor Carga y ocultar los demás
                document.querySelectorAll('.tab-content').forEach(c => {
                    if (c.id === 'tabCarga') {
                        c.classList.add('active');
                    } else {
                        c.classList.remove('active');
                    }
                });
            }
            
            // Quitar el punto rojo indicador, ya que el usuario está abriendo el menú
            menuToggle.classList.remove('has-update');

            if (window.innerWidth > 768) {
                // En escritorio y tablets horizontales, colapsamos/descolapsamos el sidebar
                const appContainer = document.querySelector('.app-container');
                if (appContainer) {
                    appContainer.classList.toggle('sidebar-collapsed');
                    // Forzar a Leaflet a redimensionar el mapa después de la transición de 300ms
                    setTimeout(() => {
                        if (map) map.invalidateSize();
                    }, 310);
                }
            } else {
                // En pantallas móviles pequeñas, alternamos con la clase active (overlay)
                sidebar.classList.toggle('active');
            }
        });

        closeSidebar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth > 768) {
                // En escritorio, colapsar el menú lateral
                const appContainer = document.querySelector('.app-container');
                if (appContainer) {
                    appContainer.classList.add('sidebar-collapsed');
                    setTimeout(() => {
                        if (map) map.invalidateSize();
                    }, 310);
                }
            } else {
                // En móvil, simplemente ocultar overlay
                sidebar.classList.remove('active');
            }
        });



        // Soporte para cerrar el menú lateral deslizándolo hacia la izquierda (gesto táctil)
        if (sidebar) {
            let touchStartX = 0;
            let touchStartY = 0;
            let touchEndX = 0;
            let touchEndY = 0;

            sidebar.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });

            sidebar.addEventListener('touchmove', (e) => {
                touchEndX = e.touches[0].clientX;
                touchEndY = e.touches[0].clientY;
            }, { passive: true });

            sidebar.addEventListener('touchend', () => {
                const diffX = touchStartX - touchEndX;
                const diffY = Math.abs(touchStartY - touchEndY);
                
                // El gesto debe ser predominantemente horizontal y superar un umbral de 50px
                if (diffX > 50 && diffX > diffY) {
                    if (sidebar.classList.contains('active') && window.innerWidth <= 768) {
                        sidebar.classList.remove('active');
                    }
                }
            }, { passive: true });

            // Evitar que el deslizamiento del panel de estadísticas superior (carrusel) burbujee al sidebar y lo cierre
            const statsPanel = sidebar.querySelector('.stats-panel');
            if (statsPanel) {
                ['touchstart', 'touchmove', 'touchend'].forEach(eventName => {
                    statsPanel.addEventListener(eventName, (e) => {
                        e.stopPropagation();
                    }, { passive: true });
                });
            }
        }

        // Botón GPS
        const gpsToggle = document.getElementById('gpsToggle');
        gpsToggle.addEventListener('click', toggleGPS);



        // Botón Cambiar Capa del Mapa (Satelital / Oscura)
        const mapLayerToggle = document.getElementById('mapLayerToggle');
        if (mapLayerToggle) {
            mapLayerToggle.addEventListener('click', toggleMapLayer);
        }

        // Mostrar/Ocultar Consola de Diagnóstico al hacer clic en el LED indicador
        const warningDot = document.getElementById('debugWarningDot');
        const debugContent = document.getElementById('appDebugContent');

        if (warningDot) {
            // Detener clicks y eventos táctiles para evitar cierres accidentales del sidebar
            ['click', 'touchstart', 'touchmove', 'touchend'].forEach(eventName => {
                warningDot.addEventListener(eventName, (e) => {
                    e.stopPropagation();
                    if (eventName === 'click') {
                        const content = document.getElementById('appDebugContent');
                        if (content) {
                            if (content.style.display === 'none') {
                                content.style.display = 'block';
                            } else {
                                content.style.display = 'none';
                            }
                        }
                    }
                }, { passive: eventName !== 'click' });
            });
        }

        if (debugContent) {
            // Evitar que interactuar con el contenido de diagnóstico cierre el menú
            ['click', 'touchstart', 'touchmove', 'touchend'].forEach(eventName => {
                debugContent.addEventListener(eventName, (e) => {
                    e.stopPropagation();
                }, { passive: true });
            });
        }





        // Exportación
        document.getElementById('exportKmlBtn').addEventListener('click', exportKML);
        document.getElementById('exportPdfBtn').addEventListener('click', exportPDF);

        // Borrar datos
        document.getElementById('resetAppBtn').addEventListener('click', clearAllData);

        // Buscador y filtros de tramos
        document.getElementById('searchTramo').addEventListener('input', updateTramosList);
        
        const filterButtons = document.querySelectorAll('.btn-filter');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Evitar que el clic se propague al mapa y cierre el sidebar
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                updateTramosList();
            });
        });

        // ==========================================
        // EVENTOS DEL NUEVO MENU CLONADO (TEST)
        // ==========================================
        const sidebarClone = document.getElementById('sidebarClone');
        const overlayClone = document.getElementById('sidebarCloneOverlay');
        const btnOpenClone = document.getElementById('btnOpenCloneMenu');
        const btnCloseClone = document.getElementById('closeSidebarClone');

        // Abrir Menú Clonado
        if (btnOpenClone) {
            btnOpenClone.addEventListener('click', (e) => {
                e.stopPropagation();
                // Cerrar el menú original primero
                const oldSidebar = document.getElementById('sidebar');
                if (oldSidebar) oldSidebar.classList.remove('active');
                
                // Mostrar el nuevo con su overlay
                if (sidebarClone) sidebarClone.classList.add('active');
                if (overlayClone) overlayClone.classList.add('active');
                
                // Rellenar de inmediato los tramos en el nuevo menú para prueba
                syncCloneUI();
            });
        }

        // Cerrar Menú Clonado
        const closeActions = [btnCloseClone, overlayClone];
        closeActions.forEach(el => {
            if (el) {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (sidebarClone) sidebarClone.classList.remove('active');
                    if (overlayClone) overlayClone.classList.remove('active');
                });
            }
        });

        // Navegación de pestañas del menú clonado
        const cloneTabs = document.querySelectorAll('[data-tab-clone]');
        cloneTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                cloneTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Mostrar contenedor
                const targetId = tab.getAttribute('data-tab-clone');
                document.querySelectorAll('#sidebarClone .tab-content').forEach(c => {
                    c.style.display = 'none';
                    c.classList.remove('active');
                });
                const targetPanel = document.getElementById(targetId);
                if (targetPanel) {
                    targetPanel.style.display = 'flex';
                    targetPanel.classList.add('active');
                }
            });
        });

        // Filtros del menú clonado
        const filterClones = document.querySelectorAll('.btn-filter-clone');
        filterClones.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterClones.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                syncCloneTramosList();
            });
        });

        // Buscador del menú clonado
        const searchClone = document.getElementById('searchTramoClone');
        if (searchClone) {
            searchClone.addEventListener('input', (e) => {
                e.stopPropagation();
                syncCloneTramosList();
            });
        }

        // Sincronización del botón borrar datos
        const resetBtnClone = document.getElementById('resetAppBtnClone');
        if (resetBtnClone) {
            resetBtnClone.addEventListener('click', (e) => {
                e.stopPropagation();
                clearAllData();
            });
        }

    } catch (e) {
        console.error("Error en initEventListeners:", e);
        appAlert("Fallo al inicializar la app (eventos): " + e.message, 'error');
    }
}

// FUNCIONES AUXILIARES DE RENDERIZACIÓN EXCLUSIVAS DEL MENÚ CLONADO (NO AFECTAN AL ORIGINAL)
function syncCloneUI() {
    try {
        syncCloneTramosList();
        syncCloneRouteList();
        syncCloneFilesList();
        syncCloneLegend();
        
        // Sincronizar estado de habilitado en botones de exportación
        const disableBtns = !state.fileLoaded;
        const exportKml = document.getElementById('exportKmlBtnClone');
        const exportPdf = document.getElementById('exportPdfBtnClone');
        if (exportKml) exportKml.disabled = disableBtns;
        if (exportPdf) exportPdf.disabled = disableBtns;
        
        if (typeof refreshLucideIcons === 'function') {
            refreshLucideIcons();
        }
    } catch (err) {
        console.error("Error al sincronizar menú clonado:", err);
    }
}

function syncCloneTramosList() {
    const container = document.getElementById('tramosListClone');
    const searchVal = (document.getElementById('searchTramoClone')?.value || '').toLowerCase().trim();
    
    // Obtener filtro activo del clon
    let filterVal = 'all';
    const activeFilter = document.querySelector('.btn-filter-clone.active');
    if (activeFilter) {
        filterVal = activeFilter.getAttribute('data-filter-clone');
    }

    if (!container) return;
    container.innerHTML = '';

    if (!state.tramos || state.tramos.length === 0) {
        container.innerHTML = '<li class="tramos-list-empty">No hay carreteras cargadas.</li>';
        return;
    }

    const filtered = state.tramos.filter(t => {
        const matchesQuery = t.name.toLowerCase().includes(searchVal);
        if (filterVal === 'pending') {
            return matchesQuery && t.status === 'pending';
        } else if (filterVal === 'done') {
            return matchesQuery && t.status === 'completed';
        }
        return matchesQuery;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<li class="tramos-list-empty">Ningún tramo coincide con los filtros.</li>';
        return;
    }

    filtered.forEach(tramo => {
        const fileObj = state.loadedFiles.find(f => f.id === tramo.fileId);
        const fileName = fileObj ? fileObj.name : 'Archivo';
        const item = document.createElement('li');
        item.className = `tramo-item ${tramo.status === 'completed' ? 'completed' : 'pending'}`;
        item.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.05);";
        item.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; font-size: 0.85rem; color: #fff;">${tramo.name}</span>
                <span style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">${(tramo.length / 1000).toFixed(2)} km | ${fileName}</span>
            </div>
            <div style="width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid ${tramo.status === 'completed' ? 'var(--accent)' : 'var(--text-secondary)'}; background: ${tramo.status === 'completed' ? 'var(--accent)' : 'transparent'};"></div>
        `;

        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que el clic interfiera con el mapa
            openRoadDetail(tramo.id);
            // Cerrar menú clonado al ver detalle
            const sidebarClone = document.getElementById('sidebarClone');
            const overlayClone = document.getElementById('sidebarCloneOverlay');
            if (sidebarClone) sidebarClone.classList.remove('active');
            if (overlayClone) overlayClone.classList.remove('active');
        });

        container.appendChild(item);
    });
}

function syncCloneRouteList() {
    const container = document.getElementById('routeListClone');
    if (!container) return;
    container.innerHTML = '';

    const pendingTramos = state.tramos.filter(t => t.status !== 'completed');
    
    // Estadísticas
    const routeStats = document.getElementById('routeStatsClone');
    if (routeStats) routeStats.innerText = `${pendingTramos.length} tramos`;
    
    const routeTotalTravel = document.getElementById('routeTotalTravelClone');
    if (routeTotalTravel) {
        const totalPendingMeters = pendingTramos.reduce((acc, curr) => acc + curr.length, 0);
        routeTotalTravel.innerText = `Quedan ${pendingTramos.length} tramos (${(totalPendingMeters / 1000).toFixed(2)} km pendientes)`;
    }

    if (pendingTramos.length === 0) {
        container.innerHTML = '<li class="route-list-empty" style="color: var(--text-secondary); font-size: 0.8rem; padding: 10px; text-align: center;">¡Felicidades! No quedan tramos pendientes.</li>';
        return;
    }

    // Ordenar de forma temporal
    const sorted = getSortedPendingTramos();

    sorted.forEach(({ tramo }) => {
        const item = document.createElement('li');
        item.style.cssText = "padding: 10px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;";
        item.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; font-size: 0.85rem; color: #fff;">${tramo.name}</span>
                <span style="font-size: 0.72rem; color: var(--text-secondary);">${(tramo.length / 1000).toFixed(2)} km</span>
            </div>
            <button style="padding: 4px 8px; font-size: 0.72rem; background: var(--accent); border: none; border-radius: 4px; color: #fff; cursor: pointer; font-weight: bold;">Ver</button>
        `;

        item.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            openRoadDetail(tramo.id);
            const sidebarClone = document.getElementById('sidebarClone');
            const overlayClone = document.getElementById('sidebarCloneOverlay');
            if (sidebarClone) sidebarClone.classList.remove('active');
            if (overlayClone) overlayClone.classList.remove('active');
        });

        container.appendChild(item);
    });
}

function syncCloneFilesList() {
    const container = document.getElementById('loadedFilesListClone');
    if (!container) return;
    container.innerHTML = '';

    if (!state.loadedFiles || state.loadedFiles.length === 0) {
        container.innerHTML = '<li class="loaded-file-empty" style="color: var(--text-secondary); font-size: 0.8rem;">Ningún archivo cargado</li>';
        return;
    }

    state.loadedFiles.forEach(file => {
        const item = document.createElement('li');
        item.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255,255,255,0.02); border-radius: 6px; font-size: 0.8rem; border: 1px solid rgba(255,255,255,0.04);";
        item.innerHTML = `
            <span style="color: #fff; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 200px;">${file.name}</span>
            <button style="background: transparent; border: none; color: var(--danger); cursor: pointer; padding: 2px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
        `;

        item.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            removeLoadedFile(file.id);
        });

        container.appendChild(item);
    });
}

function syncCloneLegend() {
    const container = document.getElementById('legendListClone');
    if (!container) return;
    
    // Simplemente copiar la leyenda activa del menú original
    const origLegend = document.getElementById('legendList');
    if (origLegend) {
        container.innerHTML = origLegend.innerHTML;
    }
}

// --- GESTIÓN DE ARCHIVOS KML / KMZ ---
function handleFileSelect(e) {
    try {
        const file = e.target.files[0];
        if (!file) return;

        logDebug(`Carga de archivo iniciada: "${file.name}" (Tamaño: ${(file.size / 1024).toFixed(1)} KB)`);

        const reader = new FileReader();
        const extension = file.name.split('.').pop().toLowerCase();
        logDebug(`Extensión de archivo detectada: "${extension}"`);

        if (extension === 'kmz') {
            logDebug("Leyendo archivo KMZ como ArrayBuffer...");
            reader.onload = function(event) {
                try {
                    const arrayBuffer = event.target.result;
                    logDebug("ArrayBuffer cargado. Inicializando JSZip...");
                    JSZip.loadAsync(arrayBuffer).then(zip => {
                        logDebug("Archivo zip descomprimido con éxito. Buscando archivo .kml...");
                        const kmlFileKey = Object.keys(zip.files).find(key => key.toLowerCase().endsWith('.kml'));
                        if (!kmlFileKey) {
                            const errMsg = 'No se ha encontrado ningún archivo KML dentro del archivo KMZ.';
                            logDebug(errMsg, 'error');
                            appAlert(errMsg, 'error');
                            return;
                        }
                        logDebug(`KML encontrado: "${kmlFileKey}". Extrayendo texto...`);
                        return zip.files[kmlFileKey].async('string');
                    }).then(kmlText => {
                        if (kmlText) {
                            logDebug(`KML extraído correctamente (${kmlText.length} caracteres). Enviando al parser...`);
                            parseKML(kmlText, file.name);
                        } else {
                            const errMsg = "El texto KML extraído del KMZ está vacío.";
                            logDebug(errMsg, 'error');
                            appAlert(errMsg, 'error');
                        }
                    }).catch(err => {
                        console.error(err);
                        logDebug('Error en descompresión JSZip: ' + err.message, 'error');
                        appAlert('Error al descomprimir el archivo KMZ: ' + err.message, 'error');
                    });
                } catch (errInner) {
                    logDebug('Error procesando datos del KMZ: ' + errInner.message, 'error');
                    appAlert('Error procesando datos del KMZ: ' + errInner.message, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        } else if (extension === 'kml') {
            logDebug("Leyendo archivo KML como Texto...");
            reader.onload = function(event) {
                try {
                    logDebug("Texto cargado. Enviando al parser...");
                    parseKML(event.target.result, file.name);
                } catch (errInner) {
                    logDebug('Error leyendo datos del KML: ' + errInner.message, 'error');
                    appAlert('Error leyendo datos del KML: ' + errInner.message, 'error');
                }
            };
            reader.readAsText(file);
        } else {
            const errMsg = 'Formato de archivo no soportado. Selecciona un archivo .kml o .kmz.';
            logDebug(errMsg, 'warn');
            appAlert(errMsg, 'warning');
        }
    } catch (eOuter) {
        console.error("Error en handleFileSelect:", eOuter);
        logDebug("Error crítico en selección de archivo: " + eOuter.message, 'error');
        appAlert("Error crítico en selección de archivo: " + eOuter.message, 'error');
    }
}

// Parseador KML a GeoJSON interno de la App con extracción de FID/ZONA y carga acumulativa
function parseKML(kmlText, fileName) {
    try {
        logDebug(`parseKML: Parseando KML de "${fileName}"...`);

        // Pre-procesar texto KML para corregir errores XML de exportadores comunes (como Google Earth o QGIS)
        // 1. Declarar el prefijo 'xsi' si se usa en xsi:schemaLocation pero no está declarado en xmlns:xsi
        if (kmlText.includes('xsi:') && !kmlText.includes('xmlns:xsi')) {
            if (kmlText.includes('<kml')) {
                kmlText = kmlText.replace('<kml', '<kml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
            } else if (kmlText.includes('<Document')) {
                kmlText = kmlText.replace('<Document', '<Document xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
            }
        }

        // 2. Corregir ampersands raw que no están dentro de CDATA
        kmlText = kmlText.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

        // 3. Reemplazar entidades HTML no válidas en XML como &nbsp;
        kmlText = kmlText.replace(/&nbsp;/g, '&#160;');

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
        
        // Comprobar errores de parsing
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            const errText = parseError[0].textContent || "Error de sintaxis XML";
            logDebug(`parseError XML en "${fileName}": ${errText}`, 'error');
            throw new Error(`El XML del KML está mal formado / tiene errores. Detalles: ${errText}`);
        }

        const placemarks = xmlDoc.getElementsByTagName('Placemark');
        logDebug(`parseKML: Se encontraron ${placemarks.length} Placemarks totales en el documento.`);
        if (placemarks.length === 0) {
            const errMsg = 'No se encontraron tramos o líneas (Placemarks) en el archivo KML.';
            logDebug(errMsg, 'warn');
            appAlert(errMsg, 'warning');
            return;
        }

        // Verificar si el archivo ya fue cargado previamente
        if (state.loadedFiles.some(f => f.name === fileName)) {
            appAlert(`El archivo "${fileName}" ya está cargado en el gestor.`, 'warning');
            return;
        }

        // 1. Mapear estilos y colores del KML para detectar tramos previamente pintados (completados)
        const styles = {}; // styleId -> color en Hex (#rrggbb)
        const styleMaps = {}; // styleMapId -> normalStyleId

        // Buscar todos los Style
        const styleNodes = xmlDoc.getElementsByTagName('Style');
        for (let s = 0; s < styleNodes.length; s++) {
            const styleNode = styleNodes[s];
            const styleId = styleNode.getAttribute('id') || styleNode.getAttribute('kml:id');
            if (styleId) {
                const lineStyle = styleNode.getElementsByTagName('LineStyle')[0];
                if (lineStyle) {
                    const colorNode = lineStyle.getElementsByTagName('color')[0];
                    if (colorNode) {
                        const kmlColor = colorNode.textContent.trim(); // aabbggrr
                        if (kmlColor.length === 8) {
                            const r = kmlColor.substring(6, 8);
                            const g = kmlColor.substring(4, 6);
                            const b = kmlColor.substring(2, 4);
                            styles['#' + styleId] = '#' + r + g + b;
                        }
                    }
                }
            }
        }

        // Buscar todos los StyleMap
        const styleMapNodes = xmlDoc.getElementsByTagName('StyleMap');
        for (let sm = 0; sm < styleMapNodes.length; sm++) {
            const styleMapNode = styleMapNodes[sm];
            const styleMapId = styleMapNode.getAttribute('id') || styleMapNode.getAttribute('kml:id');
            if (styleMapId) {
                const pairs = styleMapNode.getElementsByTagName('Pair');
                for (let p = 0; p < pairs.length; p++) {
                    const keyNode = pairs[p].getElementsByTagName('key')[0];
                    const urlNode = pairs[p].getElementsByTagName('styleUrl')[0];
                    if (keyNode && urlNode && keyNode.textContent.trim() === 'normal') {
                        styleMaps['#' + styleMapId] = urlNode.textContent.trim();
                    }
                }
            }
        }

        // Buscar gx:CascadingStyle (que a veces tiene el Style adentro, típico de Google Earth moderno)
        const cascadingStyles = xmlDoc.getElementsByTagName('gx:CascadingStyle');
        for (let cs = 0; cs < cascadingStyles.length; cs++) {
            const csNode = cascadingStyles[cs];
            const csId = csNode.getAttribute('kml:id') || csNode.getAttribute('id');
            if (csId) {
                const styleNode = csNode.getElementsByTagName('Style')[0];
                if (styleNode) {
                    const lineStyle = styleNode.getElementsByTagName('LineStyle')[0];
                    if (lineStyle) {
                        const colorNode = lineStyle.getElementsByTagName('color')[0];
                        if (colorNode) {
                            const kmlColor = colorNode.textContent.trim();
                            if (kmlColor.length === 8) {
                                const r = kmlColor.substring(6, 8);
                                const g = kmlColor.substring(4, 6);
                                const b = kmlColor.substring(2, 4);
                                styles['#' + csId] = '#' + r + g + b;
                            }
                        }
                    }
                }
            }
        }

        const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        let parsedTramos = [];

        for (let i = 0; i < placemarks.length; i++) {
            const placemark = placemarks[i];
            
            // Buscar LineStrings (carreteras/tramos)
            const lineString = placemark.getElementsByTagName('LineString');
            if (lineString.length === 0) continue; // Ignoramos puntos o polígonos

            // Extraer nombre
            let nameNode = placemark.getElementsByTagName('name')[0];
            let name = nameNode ? nameNode.textContent.trim() : '';

            // Extraer descripción
            let descNode = placemark.getElementsByTagName('description')[0];
            let description = descNode ? descNode.textContent.trim() : '';

            // Intentar extraer FID y ZONA de la tabla de descripción
            let fid = '';
            let zona = '';
            
            if (description) {
                try {
                    const descDoc = parser.parseFromString(description, 'text/html');
                    const rows = descDoc.getElementsByTagName('tr');
                    for (let r = 0; r < rows.length; r++) {
                        const cells = rows[r].getElementsByTagName('td');
                        if (cells.length === 2) {
                            const key = cells[0].textContent.trim();
                            const val = cells[1].textContent.trim();
                            if (key === 'FID') fid = val;
                            else if (key === 'ZONA') zona = val;
                        }
                    }
                } catch (e) {
                    console.warn("No se pudo extraer metadatos de la descripción:", e);
                }
            }

            // Formatear nombre legible
            let displayName = `Tramo ${fid || (i + 1)}`;
            if (zona) {
                displayName = `Tramo ${fid || (i + 1)} - ${zona}`;
            } else if (name.length > 0) {
                displayName = name;
            }

            // Extraer coordenadas
            const coordNode = lineString[0].getElementsByTagName('coordinates')[0];
            if (!coordNode) continue;

            const coordText = coordNode.textContent.trim();
            const coordinates = parseKMLCoordinates(coordText);

            if (coordinates.length < 2) continue; // Debe tener al menos 2 puntos

            // Calcular longitud del tramo en metros
            const length = calculateLineLength(coordinates);

            // Obtener color del estilo si existe
            let tramoKmlColor = null;
            let styleUrlNode = placemark.getElementsByTagName('styleUrl')[0];
            if (styleUrlNode) {
                let url = styleUrlNode.textContent.trim();
                if (styleMaps[url]) {
                    url = styleMaps[url];
                }
                if (styles[url]) {
                    tramoKmlColor = styles[url];
                }
            }

            parsedTramos.push({
                id: `tramo_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
                fileId: fileId,
                fid: fid,
                zona: zona,
                name: displayName,
                description: description,
                coordinates: coordinates, // Array de [lat, lon]
                originalCoordinates: coordinates.map(c => [...c]), // Copia profunda para optimización idempotente
                length: length,           // En metros
                status: 'pending',        // 'pending', 'partial' o 'completed'
                rightMarginStatus: 'pending',
                leftMarginStatus: 'pending',
                rightMarginDate: null,
                leftMarginDate: null,
                dateCompleted: null,
                weekCompleted: null,
                color: null,
                kmlColor: tramoKmlColor
            });
        }

        if (parsedTramos.length === 0) {
            appAlert('El KML cargado no contiene tramos lineales válidos (LineStrings).', 'warning');
            return;
        }

        // Determinar qué tramos ya están desbrozados basándose en los colores del KML.
        // Heurística mejorada:
        // 1. Buscamos primero si hay algún amarillo o cian municipal por defecto.
        // 2. Si no, usamos el color más común excluyendo los tonos rojos (que siempre representan desbroce).
        const colorCounts = {};
        parsedTramos.forEach(t => {
            if (t.kmlColor) {
                colorCounts[t.kmlColor] = (colorCounts[t.kmlColor] || 0) + 1;
            }
        });

        let defaultKmlColor = null;

        // Buscar si hay amarillo o cian en la lista de colores
        for (const col in colorCounts) {
            if (isDefaultMunicipalColor(col)) {
                defaultKmlColor = col;
                break;
            }
        }

        // Si no se encontró el amarillo/cian predeterminado, buscamos el color más frecuente que no sea rojo
        if (!defaultKmlColor) {
            let maxCount = -1;
            for (const col in colorCounts) {
                if (isColorRed(col)) continue; // El rojo siempre se trata como completado
                if (colorCounts[col] > maxCount) {
                    maxCount = colorCounts[col];
                    defaultKmlColor = col;
                }
            }
        }

        // Si hay variedad de colores, marcamos como completados los que difieren del predeterminado o que son rojos
        const hasColorVariety = Object.keys(colorCounts).length > 1;
        let preCompletedCount = 0;
        parsedTramos.forEach(t => {
            const isRed = isColorRed(t.kmlColor);
            const isCompletedColor = hasColorVariety && (isRed || (t.kmlColor && t.kmlColor !== defaultKmlColor));

            if (isCompletedColor) {
                t.status = 'completed';
                t.dateCompleted = new Date().toISOString().split('T')[0];
                t.isImportedWeek = true;
                
                // Le asignamos un identificador temporal basado en su color original
                t.weekCompleted = 'KML_' + t.kmlColor.replace('#', '');

                // Si el color del KML es rojo, le asignamos el color de la semana actual
                // para evitar confusión con el estilo rojo discontinuo de los tramos pendientes.
                if (isRed) {
                    const { week, year } = getISOWeekAndYear(new Date());
                    const currentWeekKey = `W${week}-${year}`;
                    t.color = getWeekColor(currentWeekKey);
                } else {
                    t.color = t.kmlColor; // Conservar su color original del KML
                }
                preCompletedCount++;
            }
        });
        
        if (preCompletedCount > 0) {
            logDebug(`parseKML: Se detectaron y marcaron automáticamente como completados ${preCompletedCount} tramos basados en el color cambiado del KML.`);
        }

        // Acumular tramos en el estado
        state.tramos = [...state.tramos, ...parsedTramos];
        state.loadedFiles.push({
            id: fileId,
            name: fileName,
            tramosCount: parsedTramos.length
        });
        state.fileLoaded = true;
        
        // Añadir nuevos tramos al final de la ruta secuencial
        state.routeOrder = [...state.routeOrder, ...parsedTramos.map(t => t.id)];

        // Guardar en Storage local
        saveToLocalStorage();
        
        // Renderizar en mapa y actualizar UI
        renderTramosOnMap();
        adjustDefaultFilter();
        updateUI();
        
        // Centrar mapa a todos los tramos acumulados
        fitMapToBounds();

        // Cambiar a la pestaña de tramos
        document.querySelector('.tab-btn[data-tab="tabTramos"]').click();

        // Limpiar input file para permitir volver a cargar el mismo archivo si se quita
        document.getElementById('fileInput').value = '';

    } catch (error) {
        console.error(error);
        appAlert('Error al procesar el archivo KML: ' + error.message, 'error');
    }
}

// Auxiliar para parsear coordenadas de KML: "lon,lat,alt lon,lat,alt..." a [[lat, lon], ...]
function parseKMLCoordinates(coordText) {
    const coords = [];
    const points = coordText.split(/\s+/);
    
    for (let point of points) {
        if (!point) continue;
        const parts = point.split(',');
        if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lon) && !isNaN(lat)) {
                coords.push([lat, lon]);
            }
        }
    }
    return coords;
}

// Calcular longitud acumulada de una línea (Haversine)
function calculateLineLength(coordinates) {
    let totalLength = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
        const p1 = coordinates[i];
        const p2 = coordinates[i + 1];
        totalLength += getHaversineDistance(p1[0], p1[1], p2[0], p2[1]);
    }
    return totalLength;
}

// Detectar si un color hexadecimal es de tono rojo (para evitar confusión con tramos pendientes)
function isColorRed(hex) {
    if (!hex) return false;
    const cleanHex = hex.replace('#', '').toLowerCase();
    if (cleanHex.length !== 6) return false;
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    // Rojo dominante (el canal rojo es superior a 150 y mayor que la suma de verde y azul)
    return (r > 150 && g < 120 && b < 120 && r > (g + b));
}

// Detectar si un color es el amarillo o cian municipal estándar por defecto
function isDefaultMunicipalColor(hex) {
    if (!hex) return false;
    const cleanHex = hex.replace('#', '').toLowerCase();
    if (cleanHex.length !== 6) return false;
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    // Amarillo: R alto, G alto, B bajo
    const isYellow = (r > 200 && g > 200 && b < 100);
    // Celeste/Cian: R bajo, G alto, B alto
    const isCyan = (r < 100 && g > 200 && b > 200);
    return isYellow || isCyan;
}

// Traducir un color hexadecimal a un nombre descriptivo en español para el operario
function getColorNameSpanish(hex) {
    if (!hex) return "Desconocido";
    const cleanHex = hex.replace('#', '').toLowerCase();
    
    // Mapeo simple de colores comunes en el KML y la paleta de la aplicación
    const colorMap = {
        '10b981': 'Verde Esmeralda',
        '3b82f6': 'Azul',
        '8b5cf6': 'Violeta',
        'f59e0b': 'Naranja',
        'ec4899': 'Rosa',
        '06b6d4': 'Cian',
        'eab308': 'Amarillo',
        'f43f5e': 'Rosa Intenso',
        'a855f7': 'Morado',
        '6366f1': 'Índigo',
        '14b8a6': 'Turquesa',
        'f97316': 'Naranja Oscuro',
        'ff0000': 'Rojo',
        'd32f2f': 'Rojo',
        '1976d2': 'Azul',
        'ffff00': 'Amarillo',
        'f57c00': 'Naranja',
        '00ffff': 'Celeste'
    };
    
    if (colorMap[cleanHex]) {
        return colorMap[cleanHex];
    }
    
    // Fallback: Analizar canales RGB dominantes
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    
    if (isNaN(r) || isNaN(g) || isNaN(b)) return "Personalizado";
    
    if (r > 200 && g > 200 && b < 100) return 'Amarillo';
    if (r > 200 && g < 100 && b < 100) return 'Rojo';
    if (r < 100 && g < 100 && b > 200) return 'Azul';
    if (r < 100 && g > 200 && b < 100) return 'Verde';
    if (r > 150 && g < 100 && b > 150) return 'Morado';
    if (r > 200 && g > 100 && b < 50) return 'Naranja';
    if (r < 100 && g > 180 && b > 180) return 'Celeste';
    
    return 'Color #' + cleanHex;
}

// Distancia Haversine en metros entre dos coordenadas
function getHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la Tierra en metros
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // metros
}

// Obtener el estado general del tramo basado en el estado de sus márgenes
function getTramoOverallStatus(tramo) {
    const rComp = tramo.rightMarginStatus === 'completed';
    const lComp = tramo.leftMarginStatus === 'completed';
    if (rComp && lComp) return 'completed';
    if (rComp || lComp) return 'partial';
    return 'pending';
}

// --- DIBUJADO EN EL MAPA ---
// Comprobar dinámicamente si un tramo tiene bloqueos/alertas en ambos extremos (inaccesible)
function isTramoFullyBlocked(tramo) {
    if (!tramo.coordinates || tramo.coordinates.length < 2) return false;

    const coords = tramo.coordinates;
    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];

    let hasStartBlock = false;
    let hasEndBlock = false;

    // Buscar en TODOS los tramos del mapa, no solo en las obs propias del tramo.
    // Así detectamos el tramo del medio entre dos bloqueos de tramos hermanos.
    const allTramos = (state && state.tramos) ? state.tramos : [];
    allTramos.forEach(t => {
        if (!t.observaciones) return;
        t.observaciones.forEach(obs => {
            // Detectar obs de bloqueo: flag nuevo (v0.1.11+) O etiqueta legacy (datos anteriores)
            const isBlockObs = obs.isBlockSplit === true || (obs.label && obs.label.includes('Corte por bloqueo'));
            if (!isBlockObs) return;
            const distToStart = getHaversineDistance(obs.lat, obs.lng, startCoord[0], startCoord[1]);
            const distToEnd   = getHaversineDistance(obs.lat, obs.lng, endCoord[0], endCoord[1]);
            // 80m de margen: obs nuevas están a 0m del nodo exacto; datos legacy podían estar
            // hasta ~50-60m lejos del nodo (posición del toque del usuario en el mapa)
            if (distToStart < 80) hasStartBlock = true;
            if (distToEnd   < 80) hasEndBlock   = true;
        });
    });

    return hasStartBlock && hasEndBlock;
}


function renderTramosOnMap() {
    // Si la capa de grupo no existe todavía, salimos
    if (!tramosLayerGroup) return;

    // Crear un mapa temporal de marcadores de observación existentes que queremos conservar para no destruirlos
    const oldMarkersMap = new Map();
    tramosLayerGroup.getLayers().forEach(layer => {
        if (layer instanceof L.Marker && !(layer === gpsMarker)) {
            // Guardar marcador con clave única de observación para evitar fugas de memoria recreándolo
            const latlng = layer.getLatLng();
            const key = `${latlng.lat}_${latlng.lng}`;
            oldMarkersMap.set(key, layer);
        }
    });

    // Limpiar capa completa
    tramosLayerGroup.clearLayers();

    // Si el marcador GPS existe, volver a agregarlo
    if (gpsMarker) tramosLayerGroup.addLayer(gpsMarker);
    if (gpsCircle) tramosLayerGroup.addLayer(gpsCircle);

    state.tramos.forEach(tramo => {
        const isCompleted = tramo.status === 'completed';
        const isPartial = tramo.status === 'partial';
        const isBlocked = isTramoFullyBlocked(tramo);
        
        let color = getPendingColor();
        let dashArray = '10, 10';
        
        if (isBlocked) {
            color = getBlockedColor(); // Dinámico en base a la leyenda
            dashArray = '4, 4'; // Trazo discontinuo tupido de advertencia
        } else if (isCompleted) {
            color = tramo.color || COLOR_COMPLETED_DEFAULT;
            dashArray = null;
        } else if (isPartial) {
            color = getPartialColor();
            dashArray = '15, 8';
        }
        
        // Si ya tenemos una polilínea creada para este tramo, podemos reutilizarla actualizando sus coordenadas y estilos
        let polyline = tramo.mapLayer;
        if (polyline && tramosLayerGroup.hasLayer(polyline)) {
            polyline.setLatLngs(tramo.coordinates);
            polyline.setStyle({
                color: color,
                weight: isBlocked ? 5.5 : (isCompleted ? 6 : (isPartial ? 5.5 : 5)),
                opacity: isBlocked ? 0.95 : (isCompleted ? 0.9 : 0.85),
                dashArray: dashArray
            });
        } else {
            polyline = L.polyline(tramo.coordinates, {
                color: color,
                weight: isBlocked ? 5.5 : (isCompleted ? 6 : (isPartial ? 5.5 : 5)),
                opacity: isBlocked ? 0.95 : (isCompleted ? 0.9 : 0.85),
                dashArray: dashArray,
                lineJoin: 'round',
                lineCap: 'round',
                interactive: false
            });
            tramo.mapLayer = polyline;
        }

        // Reutilizar o crear zona de clic táctil
        let clickTarget = tramo.clickTarget;
        if (clickTarget && tramosLayerGroup.hasLayer(clickTarget)) {
            clickTarget.setLatLngs(tramo.coordinates);
        } else {
            clickTarget = L.polyline(tramo.coordinates, {
                color: '#000000',
                weight: 24, // Área de toque expandida para pantallas táctiles de tractoristas
                opacity: 0.001,
                lineJoin: 'round',
                lineCap: 'round',
                interactive: true
            });
            clickTarget.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                handleTramoClick(tramo, e.latlng);
            });
            tramo.clickTarget = clickTarget;
        }

        tramosLayerGroup.addLayer(polyline);
        tramosLayerGroup.addLayer(clickTarget);

        // Pintar las observaciones reutilizando marcadores anteriores para evitar recreación masiva de DOM
        if (tramo.observaciones && Array.isArray(tramo.observaciones)) {
            tramo.observaciones.forEach(obs => {
                const key = `${obs.lat}_${obs.lng}`;
                let marker = oldMarkersMap.get(key);

                if (marker) {
                    // Si el marcador existía, lo volvemos a añadir al grupo directamente
                    tramosLayerGroup.addLayer(marker);
                } else {
                    let iconHtml = '<div class="dot-orange">⚠️</div>';
                    if (obs.type === 'vehicles') iconHtml = '<div class="dot-orange">🚗</div>';
                    else if (obs.type === 'branches') iconHtml = '<div class="dot-orange">🌳</div>';
                    else if (obs.type === 'cables') iconHtml = '<div class="dot-orange">⚡</div>';
                    
                    const obsIcon = L.divIcon({
                        className: 'obs-map-marker',
                        html: iconHtml,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                    });
                    
                    marker = L.marker([obs.lat, obs.lng], { icon: obsIcon });
                    
                    const dateStr = new Date(obs.date).toLocaleString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    marker.bindPopup(`
                        <div style="font-family: 'Outfit', sans-serif; color: #f4f4f5; min-width: 180px; padding: 4px;">
                            <h4 style="margin: 0 0 4px 0; color: #f59e0b; font-size: 0.85rem; display: flex; align-items: center; gap: 4px;">
                                ${obs.label}
                            </h4>
                            <div style="font-size: 0.72rem; color: #a1a1aa; margin-bottom: 6px;">${dateStr}</div>
                            ${obs.comment ? `<p style="margin: 0 0 8px 0; font-size: 0.78rem; line-height: 1.3; color: #e4e4e7; background: rgba(255,255,255,0.05); padding: 6px; border-radius: 6px; white-space: pre-wrap;">${obs.comment}</p>` : ''}
                            <button onclick="removeObservation('${tramo.id}', '${obs.id}')"
                                    style="width: 100%; font-size: 0.7rem; padding: 6px; border-radius: 4px; border: none; background: #ef4444; color: white; font-weight: bold; cursor: pointer; margin-top: 4px;">
                                Eliminar Alerta
                            </button>
                        </div>
                    `, {
                        closeButton: false,
                        className: 'obs-popup-custom'
                    });
                    tramosLayerGroup.addLayer(marker);
                }
            });
        }
    });
}

// Variable global para almacenar la función de limpieza del modo de división activo
let activeSplitCleanup = null;

// Manejador centralizado de clics sobre las carreteras para discernir entre la selección normal y la división
function handleTramoClick(tramo, latlng) {
    if (state.isSplitMode) {
        if (state.splitTramoId === tramo.id) {
            splitTramoAtPoint(tramo, latlng);
            if (typeof activeSplitCleanup === 'function') {
                activeSplitCleanup();
            }
        } else {
            appAlert("Por favor, haz clic sobre el tramo seleccionado (naranja y discontinuo) para dividirlo, o pulsa Cancelar.", "warning");
        }
    } else if (state.isObsMode) {
        if (state.obsTramoId === tramo.id) {
            handleObsManualClick(tramo, latlng);
        } else {
            appAlert("Por favor, haz clic sobre el tramo seleccionado (naranja y discontinuo) para situar la alerta, o pulsa Cancelar.", "warning");
        }
    } else {
        openRoadDetail(tramo.id);
    }
}

function fitMapToBounds() {
    if (tramosLayerGroup.getLayers().length > 0) {
        map.fitBounds(tramosLayerGroup.getBounds(), { padding: [40, 40] });
    }
}

// --- LÓGICA DE NEGOCIO Y ACTUALIZACIÓN UI ---

// Ajustar el filtro por defecto en la pestaña Tramos
function adjustDefaultFilter() {
    try {
        const hasPending = state.tramos.some(t => t.status !== 'completed');
        const filterButtons = document.querySelectorAll('.btn-filter');
        if (filterButtons.length > 0) {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            if (hasPending) {
                const pendingBtn = document.querySelector('.btn-filter[data-filter="pending"]');
                if (pendingBtn) pendingBtn.classList.add('active');
            } else {
                const allBtn = document.querySelector('.btn-filter[data-filter="all"]');
                if (allBtn) allBtn.classList.add('active');
            }
        }
    } catch (e) {
        console.error("Error al ajustar filtro por defecto:", e);
    }
}

function updateUI() {
    try {
        updateStats();
        updateTramosList();
        updateRouteList();
        updateLegend();
        updateLoadedFilesList();
        refreshLucideIcons();
        
        // Activar/desactivar botones según si hay datos cargados
        const disableBtns = !state.fileLoaded;
        document.getElementById('exportKmlBtn').disabled = disableBtns;
        document.getElementById('exportPdfBtn').disabled = disableBtns;
    } catch (e) {
        console.error("Error en updateUI:", e);
        appAlert("Error crítico al actualizar interfaz (updateUI): " + e.message, 'error');
    }
}

// Actualizar estadísticas globales
function updateStats() {
    let totalMeters = 0;
    let completedMeters = 0;
    let todayCompletedMeters = 0;

    const todayStr = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD

    state.tramos.forEach(t => {
        totalMeters += t.length;
        if (t.status === 'completed') {
            completedMeters += t.length;
        } else if (t.status === 'partial') {
            completedMeters += t.length * 0.5;
        }

        // Calcular kilómetros completados hoy (por cada margen)
        if (t.rightMarginStatus === 'completed' && t.rightMarginDate === todayStr) {
            todayCompletedMeters += t.length * 0.5;
        }
        if (t.leftMarginStatus === 'completed' && t.leftMarginDate === todayStr) {
            todayCompletedMeters += t.length * 0.5;
        }
    });

    const totalKm = (totalMeters / 1000).toFixed(1);
    const doneKm = (completedMeters / 1000).toFixed(1);
    const todayKm = (todayCompletedMeters / 1000).toFixed(1);
    const percent = totalMeters > 0 ? Math.round((completedMeters / totalMeters) * 100) : 0;

    document.getElementById('statsPercent').innerText = `${percent}%`;
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('statsTotalKm').innerText = `${totalKm} km`;
    document.getElementById('statsDoneKm').innerText = `${doneKm} km`;

    const statsTodayEl = document.getElementById('statsTodayKm');
    if (statsTodayEl) {
        statsTodayEl.innerText = `${todayKm} km`;
    }
}

// Leyenda dinámica
function updateLegend() {
    const legendList = document.getElementById('legendList');
    
    // Limpiar e incluir los colores del sistema, incluyendo tramos bloqueados
    let blockedLength = 0;
    state.tramos.forEach(t => {
        if (isTramoFullyBlocked(t)) {
            blockedLength += t.length;
        }
    });
    const blockedKmStr = (blockedLength / 1000).toFixed(2);

    legendList.innerHTML = `
        <div class="legend-item">
            <input type="color" class="color-picker-legend" value="${getPendingColor()}" onchange="changeSystemColor('pending', this.value)" title="Cambiar color de pendiente">
            <span>Pendiente (Línea discontinua corta)</span>
        </div>
        <div class="legend-item">
            <input type="color" class="color-picker-legend" value="${getPartialColor()}" onchange="changeSystemColor('partial', this.value)" title="Cambiar color de parcial">
            <span>Parcial (Línea discontinua larga)</span>
        </div>
        <div class="legend-item">
            <input type="color" class="color-picker-legend" value="${getBlockedColor()}" onchange="changeSystemColor('blocked', this.value)" title="Cambiar color de bloqueados">
            <span style="font-weight: bold;">Bloqueado / Inaccesible (${blockedKmStr} km)</span>
        </div>
    `;

    // Extraer semanas completadas únicas y sus colores, además de si son editables y su longitud total
    const semanasMap = {}; // weekKey -> { color, isImportedWeek, totalLength }
    state.tramos.forEach(t => {
        if (t.status === 'completed' && t.weekCompleted) {
            if (!semanasMap[t.weekCompleted]) {
                semanasMap[t.weekCompleted] = {
                    color: t.color,
                    isImportedWeek: !!t.isImportedWeek,
                    totalLength: 0
                };
            }
            semanasMap[t.weekCompleted].totalLength += t.length;
        }
    });

    // Ordenar semanas y pintarlas
    const semanas = Object.keys(semanasMap).sort();
    semanas.forEach(sem => {
        const info = semanasMap[sem];
        const item = document.createElement('div');
        item.className = 'legend-item';
        
        let label = `Semana ${sem}`;
        if (sem.startsWith('KML_')) {
            label = `Semana Importada (Color original)`;
        }

        const kmStr = (info.totalLength / 1000).toFixed(2);

        const editButton = info.isImportedWeek ? `
            <button onclick="editImportedWeek('${sem}')" 
                    title="Editar semana a la que corresponde este color"
                    style="background: none; border: none; cursor: pointer; padding: 0 4px; display: inline-flex; align-items: center; color: #a1a1aa; transition: color 0.2s;"
                    onmouseover="this.style.color='#f59e0b'"
                    onmouseout="this.style.color='#a1a1aa'">
                <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i>
            </button>
        ` : '';

        const dateRange = getWeekDateRangeString(sem);
        const dateRangeText = dateRange ? `<span style="font-size: 0.7rem; color: #a1a1aa; display: block; margin-top: 1px; font-weight: normal;">${dateRange}</span>` : '';

        item.innerHTML = `
            <input type="color" class="color-picker-legend" value="${info.color}" onchange="changeWeekColor('${sem}', this.value)" title="Cambiar color de esta semana">
            <span style="display: inline-flex; flex-direction: column; gap: 1px; line-height: 1.2;">
                <span style="display: inline-flex; align-items: center; gap: 4px; font-weight: bold;">${label} (${kmStr} km) ${editButton}</span>
                ${dateRangeText}
            </span>
        `;
        legendList.appendChild(item);
    });
}

// Cambiar el color de una semana y propagarlo a los tramos correspondientes y al mapa
function changeWeekColor(weekKey, newColor) {
    try {
        state.customColors[weekKey] = newColor;

        // Propagar el color a todos los tramos completados/parciales de esa semana
        state.tramos.forEach(t => {
            if ((t.status === 'completed' || t.status === 'partial') && t.weekCompleted === weekKey) {
                t.color = newColor;
                if (t.mapLayer) {
                    t.mapLayer.setStyle({ color: newColor });
                }
            }
        });

        saveToLocalStorage();
        updateUI();
        
        logDebug(`Color de la semana '${weekKey}' cambiado a ${newColor}.`);
    } catch (e) {
        console.error("Error al cambiar color de semana:", e);
        appAlert("No se pudo cambiar el color: " + e.message, "error");
    }
}

// Cambiar el color del sistema (pendiente o parcial) y propagarlo
function changeSystemColor(type, newColor) {
    try {
        state.customColors[type] = newColor;

        // Propagar el color a todos los tramos de este tipo respetando los bloqueados
        state.tramos.forEach(t => {
            if (type === 'pending' && t.status === 'pending' && !isTramoFullyBlocked(t)) {
                if (t.mapLayer) {
                    t.mapLayer.setStyle({ color: newColor });
                }
            } else if (type === 'partial' && t.status === 'partial' && !isTramoFullyBlocked(t)) {
                if (t.mapLayer) {
                    t.mapLayer.setStyle({ color: newColor });
                }
            } else if (type === 'blocked' && isTramoFullyBlocked(t)) {
                if (t.mapLayer) {
                    t.mapLayer.setStyle({ color: newColor });
                }
            }
        });

        saveToLocalStorage();
        updateUI();
        
        logDebug(`Color del sistema '${type}' cambiado a ${newColor}.`);
    } catch (e) {
        console.error("Error al cambiar color de sistema:", e);
        appAlert("No se pudo cambiar el color: " + e.message, "error");
    }
}

// Renderizar Tab 3: Lista de Tramos con filtros y búsqueda
function updateTramosList() {
    const container = document.getElementById('tramosList');
    container.innerHTML = '';

    if (state.tramos.length === 0) {
        container.innerHTML = '<li class="tramos-list-empty">No hay carreteras cargadas.</li>';
        return;
    }

    const searchQuery = document.getElementById('searchTramo').value.toLowerCase();
    const filterVal = document.querySelector('.btn-filter.active').getAttribute('data-filter');

    let filtered = state.tramos.filter(t => {
        // Búsqueda
        const matchesQuery = t.name.toLowerCase().includes(searchQuery) || (t.description && t.description.toLowerCase().includes(searchQuery));
        
        // Filtro
        if (filterVal === 'pending') {
            return matchesQuery && t.status === 'pending';
        } else if (filterVal === 'done') {
            return matchesQuery && t.status === 'completed';
        }
        return matchesQuery;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<li class="tramos-list-empty">Ningún tramo coincide con los filtros.</li>';
        return;
    }

    filtered.forEach(tramo => {
        const fileObj = state.loadedFiles.find(f => f.id === tramo.fileId);
        const fileName = fileObj ? fileObj.name : 'Archivo';
        const item = document.createElement('li');
        item.className = `tramo-item ${tramo.status === 'completed' ? 'completed' : 'pending'}`;
        item.innerHTML = `
            <div class="tramo-item-left">
                <span class="tramo-name">${tramo.name}</span>
                <span class="tramo-length">${(tramo.length / 1000).toFixed(2)} km <span style="color: var(--text-secondary); font-size: 0.72rem; margin-left: 0.5rem; display: inline-flex; align-items: center; gap: 0.2rem;"><i data-lucide="folder" style="width: 11px; height: 11px;"></i> ${fileName}</span></span>
            </div>
            <div class="tramo-checkbox"></div>
        `;

        item.addEventListener('click', () => {
            // Destacar temporalmente la línea
            const currentWeight = tramo.mapLayer.options.weight;
            tramo.mapLayer.setStyle({ weight: currentWeight + 4 });
            setTimeout(() => {
                tramo.mapLayer.setStyle({ weight: currentWeight });
            }, 1000);

            // Abrir detalle (centrará automáticamente por defecto)
            openRoadDetail(tramo.id);
        });

        container.appendChild(item);
    });
    refreshLucideIcons();
}

// Obtener los tramos pendientes ordenados (por proximidad si hay GPS activo, o por routeOrder si no)
function getSortedPendingTramos() {
    const pendingTramos = state.tramos.filter(t => t.status !== 'completed');
    
    if (state.gpsActive && state.userLocation) {
        const userLatLng = state.userLocation;
        return pendingTramos.map(t => {
            const startPt = t.coordinates[0];
            const distanceToUser = getHaversineDistance(userLatLng.lat, userLatLng.lng, startPt[0], startPt[1]);
            return { tramo: t, distanceToUser };
        }).sort((a, b) => a.distanceToUser - b.distanceToUser);
    }
    
    // Si no hay GPS activo, mantener el orden de routeOrder
    const sorted = [];
    state.routeOrder.forEach(id => {
        const tramo = pendingTramos.find(t => t.id === id);
        if (tramo) {
            sorted.push({ tramo, distanceToUser: null });
        }
    });
    return sorted;
}

// Reordenar secuencia de trabajo usando el algoritmo del vecino más cercano (Nearest Neighbor) desde el GPS
function reorderRouteFromLocation(userLatLng) {
    try {
        if (!state.tramos || state.tramos.length === 0) return;

        // Separar IDs de tramos completados y pendientes
        const completedIds = state.routeOrder.filter(id => {
            const tramo = state.tramos.find(t => t.id === id);
            return tramo && tramo.status === 'completed';
        });
        
        const pendingTramos = state.tramos.filter(t => t.status !== 'completed');
        if (pendingTramos.length === 0) return;

        // Vecino más cercano partiendo de la posición GPS actual
        const newPendingIds = [];
        let currentPt = [userLatLng.lat, userLatLng.lng];
        const remaining = [...pendingTramos];

        while (remaining.length > 0) {
            let closestIdx = -1;
            let minD = Infinity;

            for (let i = 0; i < remaining.length; i++) {
                const tramo = remaining[i];
                const startPt = tramo.coordinates[0];
                const endPt = tramo.coordinates[tramo.coordinates.length - 1];
                
                const dStart = getHaversineDistance(currentPt[0], currentPt[1], startPt[0], startPt[1]);
                const dEnd = getHaversineDistance(currentPt[0], currentPt[1], endPt[0], endPt[1]);
                const d = Math.min(dStart, dEnd);

                if (d < minD) {
                    minD = d;
                    closestIdx = i;
                }
            }

            if (closestIdx !== -1) {
                const closestTramo = remaining.splice(closestIdx, 1)[0];
                newPendingIds.push(closestTramo.id);
                // Actualizar currentPt al extremo opuesto por el que se sale del tramo
                const startPt = closestTramo.coordinates[0];
                const endPt = closestTramo.coordinates[closestTramo.coordinates.length - 1];
                const dStart = getHaversineDistance(currentPt[0], currentPt[1], startPt[0], startPt[1]);
                const dEnd = getHaversineDistance(currentPt[0], currentPt[1], endPt[0], endPt[1]);
                currentPt = dStart < dEnd ? endPt : startPt;
            } else {
                break;
            }
        }

        // Combinar pendientes ordenados con completados al final
        state.routeOrder = [...newPendingIds, ...completedIds];
        
        updateRouteList();
        saveStateToLocalStorage();
        logDebug("Secuencia de trabajo ordenada por proximidad al GPS con éxito.");
    } catch (e) {
        console.error("Error al reordenar ruta por GPS:", e);
    }
}

// Renderizar Tab 2: Lista de planificación secuencial (solo muestra tramos pendientes)
function updateRouteList() {
    const container = document.getElementById('routeList');
    container.innerHTML = '';

    if (state.tramos.length === 0) {
        container.innerHTML = '<li class="route-list-empty">Carga un archivo KML/KMZ para ver las tareas.</li>';
        document.getElementById('routeStats').innerText = `0 tramos`;
        document.getElementById('routeTotalTravel').innerText = `Quedan 0 tramos (0.00 km pendientes)`;
        return;
    }

    // Asegurar orden estable: pendientes primero, hechos al final
    stabilizeRouteOrder();

    // Obtener los tramos que están pendientes con su ordenación correspondiente
    const pendingItems = getSortedPendingTramos();

    document.getElementById('routeStats').innerText = `${pendingItems.length} tramos`;

    // Calcular e imprimir estadísticas simplificadas
    updateRouteStatsUI();

    if (pendingItems.length === 0) {
        container.innerHTML = '<li class="route-list-empty">¡Buen trabajo! No quedan tramos pendientes por desbrozar.</li>';
        return;
    }

    // Determinar si permitimos reordenación manual (solo si GPS está apagado)
    const showMoveActions = !(state.gpsActive && state.userLocation);

    // Renderizar la lista (solo los pendientes)
    pendingItems.forEach((itemData, index) => {
        const tramo = itemData.tramo;
        const item = document.createElement('li');
        
        const isPartial = tramo.status === 'partial';
        item.className = `route-item ${isPartial ? 'partial' : 'pending'}`;
        item.style.borderLeftColor = isPartial ? getPartialColor() : getPendingColor();
        
        const realIndex = state.routeOrder.indexOf(tramo.id);
        
        if (showMoveActions) {
            item.setAttribute('draggable', 'true');
        }

        const fileObj = state.loadedFiles.find(f => f.id === tramo.fileId);
        const fileName = fileObj ? fileObj.name : 'Archivo';

        const distanceText = itemData.distanceToUser !== null 
            ? `<span class="route-item-proximity">a ${itemData.distanceToUser < 1000 ? `${Math.round(itemData.distanceToUser)} m` : `${(itemData.distanceToUser / 1000).toFixed(1)} km`}</span>`
            : '';

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div class="route-item-details" style="flex: 1; display: flex; flex-direction: column; gap: 4px; cursor: pointer;" onclick="focusTramoOnMap('${tramo.id}', event)">
                    <div class="route-item-name" style="font-weight: bold; font-size: 0.88rem; color: #fff;">${index + 1}. ${tramo.name}</div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
                        <span class="route-item-meta" style="font-size: 0.72rem; color: #a1a1aa; display: inline-flex; align-items: center; gap: 4px;">
                            ${(tramo.length / 1000).toFixed(2)} km
                        </span>
                        <span style="color: var(--text-secondary); font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;">
                            <i data-lucide="folder" style="width: 11px; height: 11px;"></i> ${fileName}
                        </span>
                        ${distanceText}
                    </div>
                </div>
                ${showMoveActions ? `
                    <div class="move-actions-vertical" style="display: flex; flex-direction: column; gap: 1px; align-items: center; justify-content: center; border-left: 1px solid rgba(255, 255, 255, 0.08); padding-left: 6px;">
                        <button class="btn-move btn-up" title="Subir" onclick="moveRouteItem(${realIndex}, -1, event)" style="display: inline-flex; align-items: center; justify-content: center; padding: 2px; height: 14px; width: 20px;">
                            <i data-lucide="chevron-up" style="width: 14px; height: 14px;"></i>
                        </button>
                        <button class="btn-move btn-down" title="Bajar" onclick="moveRouteItem(${realIndex}, 1, event)" style="display: inline-flex; align-items: center; justify-content: center; padding: 2px; height: 14px; width: 20px;">
                            <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
            
            <div class="route-item-actions" style="display: flex; gap: 6px; align-items: center; margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 8px; justify-content: flex-end;">
                <button class="btn-xs btn-xs-grey" title="Ver en mapa" onclick="focusTramoOnMap('${tramo.id}', event)" style="padding: 4px 10px; height: 26px;">
                    <i data-lucide="eye" style="width: 13px; height: 13px; margin-right: 3px;"></i>Ver
                </button>
                <button class="btn-xs btn-xs-blue" title="Navegar con Google Maps" onclick="navigateTramo('${tramo.id}', event)" style="padding: 4px 10px; height: 26px;">
                    <i data-lucide="navigation" style="width: 13px; height: 13px; margin-right: 3px;"></i>Ir
                </button>
                <button class="btn-xs btn-xs-green" title="Marcar como Completada" onclick="completeTramoQuick('${tramo.id}', event)" style="padding: 4px 10px; height: 26px;">
                    <i data-lucide="check" style="width: 13px; height: 13px; margin-right: 3px;"></i>Completar
                </button>
            </div>
        `;

        if (showMoveActions) {
            // Eventos Drag and Drop para reordenación táctil/ratón
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', realIndex);
                item.style.opacity = '0.5';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                const fromRealIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toRealIndex = realIndex;
                if (fromRealIndex !== toRealIndex) {
                    const element = state.routeOrder.splice(fromRealIndex, 1)[0];
                    state.routeOrder.splice(toRealIndex, 0, element);
                    saveToLocalStorage();
                    updateUI();
                }
            });
        }

        container.appendChild(item);
    });
    refreshLucideIcons();
}

// Mover elemento de planificación con botones (restringido a tramos pendientes)
function moveRouteItem(realIndex, direction, event) {
    if (event) event.stopPropagation();
    const newRealIndex = realIndex + direction;
    
    // Contar cuántos están pendientes
    const pendingCount = state.routeOrder.filter(id => {
        const t = state.tramos.find(tramo => tramo.id === id);
        return t && t.status !== 'completed';
    }).length;

    if (newRealIndex < 0 || newRealIndex >= pendingCount) return;

    const element = state.routeOrder.splice(realIndex, 1)[0];
    state.routeOrder.splice(newRealIndex, 0, element);
    
    saveToLocalStorage();
    updateUI();
}

// Actualizar las estadísticas de distancia en la pestaña de Tareas Pendientes
function updateRouteStatsUI() {
    const pendingTramos = state.tramos.filter(t => t.status !== 'completed');
    let totalRoadMeters = 0;
    pendingTramos.forEach(t => {
        totalRoadMeters += t.length;
    });

    const totalRoadKm = (totalRoadMeters / 1000).toFixed(2);
    
    const el = document.getElementById('routeTotalTravel');
    if (el) {
        el.innerHTML = `Quedan <strong>${pendingTramos.length} tramos</strong> pendientes (<strong>${totalRoadKm} km</strong> por desbrozar)`;
    }
}

// Enfocar y centrar tramo en el mapa
function focusTramoOnMap(tramoId, event) {
    if (event) event.stopPropagation();
    const tramo = state.tramos.find(t => t.id === tramoId);
    if (tramo && tramo.mapLayer) {
        // Destacar temporalmente la línea
        const currentWeight = tramo.mapLayer.options.weight;
        tramo.mapLayer.setStyle({ weight: currentWeight + 4 });
        setTimeout(() => {
            tramo.mapLayer.setStyle({ weight: currentWeight });
        }, 1000);

        // Abrir detalle (centrará automáticamente por defecto)
        openRoadDetail(tramo.id);
    }
}

// Abrir Google Maps para navegar al inicio del tramo
function navigateTramo(tramoId, event) {
    if (event) event.stopPropagation();
    const tramo = state.tramos.find(t => t.id === tramoId);
    if (tramo && tramo.coordinates && tramo.coordinates.length > 0) {
        const startPoint = tramo.coordinates[0];
        const url = `https://www.google.com/maps/dir/?api=1&destination=${startPoint[0]},${startPoint[1]}`;
        window.open(url, '_blank');
    }
}

// Marcar tramo como completado directamente desde la lista de tareas
function completeTramoQuick(tramoId, event) {
    if (event) event.stopPropagation();
    const tramo = state.tramos.find(t => t.id === tramoId);
    if (!tramo) return;

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    tramo.status = 'completed';
    tramo.dateCompleted = dateStr;
    const { week, year } = getISOWeekAndYear(today);
    tramo.weekCompleted = `W${week}-${year}`;
    
    // Asignar el color de la misma semana
    tramo.color = getWeekColor(tramo.weekCompleted);

    // Actualizar estilo en el mapa inmediatamente
    if (tramo.mapLayer) {
        tramo.mapLayer.setStyle({
            color: tramo.color,
            weight: 6,
            opacity: 0.9,
            dashArray: null
        });
    }

    saveToLocalStorage();
    updateUI();
    
    // Si estaba abierto en detalle, volver a abrirlo para reflejar estado
    if (state.selectedTramoId === tramoId) {
        openRoadDetail(tramoId);
    }

    logDebug(`Tramo '${tramo.name}' marcado como DESBROZADA de forma rápida.`);
}

// Exponer globalmente las funciones rápidas
window.focusTramoOnMap = focusTramoOnMap;
window.navigateTramo = navigateTramo;
window.completeTramoQuick = completeTramoQuick;

// --- DETALLE DE TRAMOS Y COMPLETAR ---

// --- DETALLE DE TRAMOS Y COMPLETAR ---

// Destacar el tramo seleccionado en el mapa
function selectAndHighlightTramo(tramo) {
    if (highlightedLayer) {
        try {
            highlightedLayer.setStyle(originalStyle);
        } catch(e) {
            console.warn("No se pudo restaurar estilo del tramo anterior:", e);
        }
    }

    const polyline = tramo.mapLayer;
    if (!polyline) return;

    highlightedLayer = polyline;
    
    // Guardar el estilo original antes de modificarlo
    originalStyle = {
        color: polyline.options.color,
        weight: polyline.options.weight,
        opacity: polyline.options.opacity
    };

    // Cambiar color a amarillo dorado de selección con mayor grosor
    polyline.setStyle({
        color: '#ffd700',
        weight: 9,
        opacity: 1.0
    });
}

function openRoadDetail(tramoId, focusMap = true) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        state.selectedTramoId = tramoId;

        // Centrar mapa de forma que deje libre el espacio de la tarjeta inferior (Bottom Sheet)
        if (focusMap && tramo.mapLayer) {
            map.fitBounds(tramo.mapLayer.getBounds(), {
                paddingTopLeft: [25, 25],
                paddingBottomRight: [25, 200], // 200px de margen inferior libre para el panel flotante
                maxZoom: 18
            });
        }

        if (tramo.mapLayer) {
            selectAndHighlightTramo(tramo);
        }

        // Configuración de textos y colores según el estado
        let statusText = 'Pendiente';
        let statusColor = '#ef4444';
        if (tramo.status === 'completed') {
            statusText = 'Completado';
            statusColor = '#10b981';
        } else if (tramo.status === 'partial') {
            statusText = 'Parcial';
            statusColor = '#fbbf24';
        }

        const fileOrigin = state.loadedFiles.find(f => f.id === tramo.fileId)?.name || 'KML';

        // Enlace de Google Maps para guiado GPS (punto inicial del tramo)
        const startPoint = tramo.coordinates[0];
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${startPoint[0]},${startPoint[1]}`;

        const rightMarginColor = tramo.rightMarginStatus === 'completed' ? '#10b981' : '#ef4444';
        const leftMarginColor = tramo.leftMarginStatus === 'completed' ? '#10b981' : '#ef4444';
        const rightMarginLabel = tramo.rightMarginStatus === 'completed' ? 'Finalizado' : 'Pendiente';
        const leftMarginLabel = tramo.leftMarginStatus === 'completed' ? 'Finalizado' : 'Pendiente';

        const overlay = document.getElementById('roadDetailOverlay');
        if (!overlay) return;

        overlay.innerHTML = `
            <div class="road-detail-card">
                <button class="close-overlay-btn" id="closeOverlay" onclick="closeRoadDetail()" aria-label="Cerrar detalles" style="position: absolute; top: 0.75rem; right: 1rem; background: none; border: none; color: var(--text-secondary); font-size: 1.75rem; cursor: pointer; line-height: 1;">×</button>
                <div class="road-detail-content" style="font-family: 'Outfit', sans-serif; color: #f3f4f6; line-height: 1.4;">
                    <h3 style="margin: 0 0 6px 0; font-size: 1.05rem; font-weight: 600; color: #fff; padding-right: 1.5rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${tramo.name}">${tramo.name}</h3>
                    
                    <div style="margin-bottom: 8px; font-size: 0.8rem; color: #9ca3af; display: flex; gap: 10px; flex-wrap: wrap;">
                        <span><strong>Origen:</strong> ${fileOrigin}</span>
                        <span><strong>Longitud:</strong> ${(tramo.length / 1000).toFixed(2)} km</span>
                        <span><strong>Estado:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span></span>
                    </div>
                    
                    <!-- Control de Márgenes -->
                    <div style="margin: 10px 0 8px 0; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
                        <strong style="display: block; margin-bottom: 6px; font-size: 0.75rem; color: #fff;">Márgenes de Carretera:</strong>
                        <div style="display: flex; gap: 6px; justify-content: space-between;">
                            <button onclick="toggleMarginStatusPopup('${tramo.id}', 'right')" 
                                    style="flex: 1; font-size: 0.85rem; padding: 12px 8px; border: 1px solid ${rightMarginColor}; background: ${tramo.rightMarginStatus === 'completed' ? 'rgba(16,185,129,0.1)' : 'transparent'}; color: ${rightMarginColor}; border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.2s;">
                                Der: ${rightMarginLabel}
                            </button>
                            <button onclick="toggleMarginStatusPopup('${tramo.id}', 'left')" 
                                    style="flex: 1; font-size: 0.85rem; padding: 12px 8px; border: 1px solid ${leftMarginColor}; background: ${tramo.leftMarginStatus === 'completed' ? 'rgba(16,185,129,0.1)' : 'transparent'}; color: ${leftMarginColor}; border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.2s;">
                                Izq: ${leftMarginLabel}
                            </button>
                        </div>
                    </div>

                    ${(tramo.status === 'completed' || tramo.status === 'partial') ? `
                        <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; margin-bottom: 8px;">
                            <strong style="font-size: 0.72rem; color: #fff;">Semana de Desbroce:</strong>
                            <select onchange="updateTramoWeek('${tramo.id}', this.value)"
                                    style="background: #27272a; color: #fff; border: 1px solid #52525b; border-radius: 6px; padding: 6px 8px; font-size: 0.8rem; font-family: sans-serif; cursor: pointer; outline: none; width: 100%;">
                                ${(() => {
                                    const weekOptions = new Set();
                                    
                                    // Agregar las semanas que ya existan en los tramos completados (la leyenda)
                                    state.tramos.forEach(t => {
                                        if ((t.status === 'completed' || t.status === 'partial') && t.weekCompleted && typeof t.weekCompleted === 'string') {
                                            weekOptions.add(t.weekCompleted);
                                        }
                                    });
                                    
                                    // Asegurarse de incluir la propia semana del tramo si está completado
                                    if (tramo.weekCompleted) {
                                        weekOptions.add(tramo.weekCompleted);
                                    }
                                    
                                    const uniqueWeeks = Array.from(weekOptions).sort().reverse();
                                    return uniqueWeeks.map(w => {
                                        const isSelected = w === tramo.weekCompleted ? 'selected' : '';
                                        return `<option value="${w}" ${isSelected}>Semana ${w}</option>`;
                                    }).join('') + `<option value="custom_date">+ Crear nueva semana (Calendario)...</option>`;
                                })()}
                            </select>
                        </div>
                    ` : ''}

                    <!-- Fila Principal: Comenzar Desbroce (Grande y aislada) -->
                    <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
                        <button onclick="startActiveWorkMode('${tramo.id}')"
                                style="width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; background-color: #10b981; color: #fff; border: none; border-radius: 8px; font-weight: bold; font-size: 0.9rem; cursor: pointer; box-shadow: 0 3px 6px rgba(0,0,0,0.3); transition: background-color 0.2s;"
                                onmouseover="this.style.backgroundColor='#059669'"
                                onmouseout="this.style.backgroundColor='#10b981'">
                            <i data-lucide="play" style="width: 16px; height: 16px;"></i> Comenzar Desbroce
                        </button>
                    </div>
                    
                    <!-- Fila Secundaria: Utilidades de Mapa y Edición -->
                    <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
                        <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" 
                           style="flex: 1; min-width: 70px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 6px; background-color: #3b82f6; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 0.78rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: background-color 0.2s;"
                           onmouseover="this.style.backgroundColor='#2563eb'"
                           onmouseout="this.style.backgroundColor='#3b82f6'">
                            <i data-lucide="navigation" style="width: 13px; height: 13px;"></i> Guiar
                        </a>

                        <button onclick="addManualObservation('${tramo.id}')"
                                 style="flex: 1; min-width: 70px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 6px; background-color: #d97706; color: #fff; border: none; border-radius: 8px; font-weight: bold; font-size: 0.78rem; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: background-color 0.2s;"
                                 onmouseover="this.style.backgroundColor='#b45309'"
                                 onmouseout="this.style.backgroundColor='#d97706'">
                            <i data-lucide="alert-triangle" style="width: 13px; height: 13px;"></i> Alerta
                        </button>

                        <button onclick="startSplitTramoMode('${tramo.id}')"
                                 style="flex: 1; min-width: 70px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 6px; background-color: #f59e0b; color: #fff; border: none; border-radius: 8px; font-weight: bold; font-size: 0.78rem; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: background-color 0.2s;"
                                 onmouseover="this.style.backgroundColor='#d97706'"
                                 onmouseout="this.style.backgroundColor='#f59e0b'">
                            <i data-lucide="scissors" style="width: 13px; height: 13px;"></i> Dividir
                        </button>

                        ${(tramo.parentInfo || tramo.id.includes('_p1_') || tramo.id.includes('_p2_')) ? `
                        <button onclick="undoSplitTramo('${tramo.id}')"
                                 style="flex: 1; min-width: 70px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 6px; background-color: #4b5563; color: #fff; border: none; border-radius: 8px; font-weight: bold; font-size: 0.78rem; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: background-color 0.2s;"
                                 onmouseover="this.style.backgroundColor='#374151'"
                                 onmouseout="this.style.backgroundColor='#4b5563'">
                            <i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i> Unir
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        overlay.classList.add('active');
        refreshLucideIcons();
    } catch (e) {
        console.error("Error en openRoadDetail:", e);
        logDebug("Fallo al abrir detalle de carretera: " + e.message, 'error');
    }
}


function closeRoadDetail() {
    try {
        if (highlightedLayer) {
            highlightedLayer.setStyle(originalStyle);
            highlightedLayer = null;
        }
        state.selectedTramoId = null;

        // Desactivar foco activo para prevenir tirones y auto-scroll de accesibilidad en navegadores móviles
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        // Ocultar tarjeta inferior con animación de salida
        const overlay = document.getElementById('roadDetailOverlay');
        if (overlay && overlay.classList.contains('active')) {
            overlay.classList.add('closing');
            setTimeout(() => {
                overlay.classList.remove('active');
                overlay.classList.remove('closing');
            }, 250); // Mismo tiempo que la animación slideDown
        }

        map.closePopup();
    } catch (e) {
        console.error("Error en closeRoadDetail:", e);
    }
}

// Alternar el estado de un tramo directamente desde el popup
function toggleTramoStatusPopup(tramoId) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        if (tramo.status === 'completed') {
            tramo.status = 'pending';
            tramo.rightMarginStatus = 'pending';
            tramo.leftMarginStatus = 'pending';
            tramo.rightMarginDate = null;
            tramo.leftMarginDate = null;
            tramo.dateCompleted = null;
            tramo.weekCompleted = null;
            tramo.color = null;
            logDebug(`Carretera '${tramo.name}' marcada como PENDIENTE (márgenes restablecidos).`);
        } else {
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];
            
            tramo.status = 'completed';
            tramo.rightMarginStatus = 'completed';
            tramo.leftMarginStatus = 'completed';
            tramo.rightMarginDate = dateStr;
            tramo.leftMarginDate = dateStr;
            tramo.dateCompleted = dateStr;
            const { week, year } = getISOWeekAndYear(today);
            tramo.weekCompleted = `W${week}-${year}`;
            tramo.color = getWeekColor(tramo.weekCompleted);
            logDebug(`Carretera '${tramo.name}' marcada como COMPLETADA (ambos márgenes - Semana ${tramo.weekCompleted}).`);
        }

        saveToLocalStorage();
        
        // Re-renderizar mapa y listas
        renderTramosOnMap();
        updateUI();
        
        // Volver a abrir el popup para actualizar visualmente la información
        const updatedTramo = state.tramos.find(t => t.id === tramoId);
        if (updatedTramo) {
            openRoadDetail(updatedTramo.id);
        }
    } catch (e) {
        console.error("Error en toggleTramoStatusPopup:", e);
        logDebug("Fallo al alternar estado desde popup: " + e.message, 'error');
    }
}

// Alternar el estado de un margen específico desde el popup
function toggleMarginStatusPopup(tramoId, marginSide) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        const currentStatus = marginSide === 'right' ? tramo.rightMarginStatus : tramo.leftMarginStatus;
        const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];

        if (marginSide === 'right') {
            tramo.rightMarginStatus = newStatus;
            tramo.rightMarginDate = newStatus === 'completed' ? dateStr : null;
        } else {
            tramo.leftMarginStatus = newStatus;
            tramo.leftMarginDate = newStatus === 'completed' ? dateStr : null;
        }

        // Recalcular estado general del tramo
        if (tramo.rightMarginStatus === 'completed' && tramo.leftMarginStatus === 'completed') {
            tramo.status = 'completed';
            tramo.dateCompleted = dateStr;
            const { week, year } = getISOWeekAndYear(today);
            tramo.weekCompleted = `W${week}-${year}`;
            tramo.color = getWeekColor(tramo.weekCompleted);
            logDebug(`Carretera '${tramo.name}': ambos márgenes completados. Asignado a la semana ${tramo.weekCompleted}.`);
        } else if (tramo.rightMarginStatus === 'pending' && tramo.leftMarginStatus === 'pending') {
            tramo.status = 'pending';
            tramo.dateCompleted = null;
            tramo.weekCompleted = null;
            tramo.color = null;
            logDebug(`Carretera '${tramo.name}': ambos márgenes pendientes.`);
        } else {
            tramo.status = 'partial';
            tramo.dateCompleted = dateStr;
            const { week, year } = getISOWeekAndYear(today);
            tramo.weekCompleted = `W${week}-${year}`;
            tramo.color = getWeekColor(tramo.weekCompleted);
            logDebug(`Carretera '${tramo.name}': un margen completado (Estado Parcial).`);
        }

        saveToLocalStorage();
        
        // Re-renderizar mapa y listas
        renderTramosOnMap();
        updateUI();
        
        // Re-abrir popup para refrescar la interfaz
        openRoadDetail(tramoId);
    } catch (e) {
        console.error("Error en toggleMarginStatusPopup:", e);
        logDebug("Fallo al alternar estado de margen: " + e.message, 'error');
    }
}

// Actualizar la fecha y semana de finalización de un tramo, regenerando su color dinámico
function updateTramoDate(tramoId, dateVal) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        if (!dateVal) {
            dateVal = new Date().toISOString().split('T')[0];
        }

        tramo.dateCompleted = dateVal;
        const dateObj = new Date(dateVal);
        const { week, year } = getISOWeekAndYear(dateObj);
        tramo.weekCompleted = `W${week}-${year}`;
        
        // Asignar el nuevo color dinámico según la semana
        tramo.color = getWeekColor(tramo.weekCompleted);

        // Actualizar el estilo del mapa inmediatamente
        if (tramo.mapLayer) {
            tramo.mapLayer.setStyle({
                color: tramo.color,
                weight: 6,
                opacity: 0.9,
                dashArray: null
            });
        }

        saveToLocalStorage();
        updateUI();

        // Volver a abrir el detalle del tramo para refrescar el popup del mapa
        openRoadDetail(tramoId);
        
        logDebug(`Tramo '${tramo.name}' asignado a la semana ${tramo.weekCompleted} (Fecha: ${dateVal}).`);
    } catch (e) {
        console.error("Error en updateTramoDate:", e);
        logDebug("Fallo al actualizar fecha del tramo: " + e.message, 'error');
    }
}

// Exponer la función globalmente para que pueda llamarse desde el onchange inline del Leaflet popup
window.updateTramoDate = updateTramoDate;

// Obtener la fecha de inicio (Lunes) de una semana ISO dada
function getDateOfISOWeek(w, y) {
    const simple = new Date(y, 0, 1 + (w - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) {
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    return ISOweekStart.toISOString().split('T')[0];
}

// Actualizar la semana de un tramo, regenerando su color dinámico y estimando su fecha
function updateTramoWeek(tramoId, selectedWeek) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        if (selectedWeek === 'custom_date') {
            appPrompt("Introduce la fecha de desbroce (AAAA-MM-DD):", tramo.dateCompleted || new Date().toISOString().split('T')[0], "Fecha Personalizada")
                .then(dateVal => {
                    if (dateVal) {
                        updateTramoDate(tramoId, dateVal);
                    } else {
                        openRoadDetail(tramoId);
                    }
                });
            return;
        }

        tramo.weekCompleted = selectedWeek;
        tramo.color = getWeekColor(selectedWeek);

        // Estimar una fecha coherente (el lunes de esa semana)
        const match = selectedWeek.match(/W(\d+)-(\d+)/);
        if (match) {
            const w = parseInt(match[1]);
            const y = parseInt(match[2]);
            tramo.dateCompleted = getDateOfISOWeek(w, y);
        }

        // Actualizar el estilo del mapa inmediatamente
        if (tramo.mapLayer) {
            tramo.mapLayer.setStyle({
                color: tramo.color,
                weight: 6,
                opacity: 0.9,
                dashArray: null
            });
        }

        saveToLocalStorage();
        updateUI();
        openRoadDetail(tramoId);
        logDebug(`Tramo '${tramo.name}' asignado a la semana ${selectedWeek}.`);
    } catch (e) {
        console.error("Error en updateTramoWeek:", e);
        logDebug("Fallo al actualizar semana del tramo: " + e.message, 'error');
    }
}

// Exponer la función globalmente para que pueda llamarse desde el select inline del Leaflet popup
window.updateTramoWeek = updateTramoWeek;

// Mostrar modal para que el operario asigne la semana a partir de una fecha en el calendario
function showEditWeekModal(groupKey) {
    try {
        const tramosInGroup = state.tramos.filter(t => t.status === 'completed' && t.weekCompleted === groupKey);
        if (tramosInGroup.length === 0) return;

        // Intentar obtener una fecha predeterminada
        const firstTramo = tramosInGroup[0];
        const defaultDate = firstTramo.dateCompleted || new Date().toISOString().split('T')[0];

        let modal = document.getElementById('editWeekModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'editWeekModal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(10, 10, 12, 0.85);
                backdrop-filter: blur(8px);
                z-index: 20000;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.3s ease;
                font-family: var(--font-family);
            `;
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; width: 340px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 15px; transform: scale(0.9); transition: transform 0.3s ease;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <h3 style="margin: 0; color: #fff; font-size: 1.1rem; font-weight: 600;">Asignar Semana a Color</h3>
                    <button id="closeWeekModalBtn" style="background: none; border: none; color: #a1a1aa; font-size: 1.2rem; cursor: pointer;">&times;</button>
                </div>
                <p style="margin: 0; color: #a1a1aa; font-size: 0.8rem; line-height: 1.4;">
                    Selecciona cualquier día de la semana en la que se realizó este desbroce. La aplicación calculará la semana e identificará su color de forma automática.
                </p>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label for="modalWeekDatePicker" style="color: #fff; font-size: 0.8rem; font-weight: 500;">Fecha de Desbroce:</label>
                    <input type="date" id="modalWeekDatePicker" value="${defaultDate}" 
                           style="background: #27272a; color: #fff; border: 1px solid #3f3f46; border-radius: 6px; padding: 8px; font-size: 0.9rem; cursor: pointer; outline: none;">
                </div>
                <div style="display: flex; gap: 8px; margin-top: 5px;">
                    <button id="cancelWeekModalBtn" style="flex: 1; padding: 10px; background: #27272a; color: #fff; border: 1px solid #3f3f46; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.8rem; transition: background 0.2s;">Cancelar</button>
                    <button id="saveWeekModalBtn" style="flex: 1; padding: 10px; background: #f59e0b; color: #000; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.8rem; transition: background 0.2s;">Guardar</button>
                </div>
            </div>
        `;

        setTimeout(() => {
            modal.style.opacity = '1';
            modal.querySelector('div').style.transform = 'scale(1)';
        }, 10);

        const closeModal = () => {
            modal.style.opacity = '0';
            modal.querySelector('div').style.transform = 'scale(0.9)';
            setTimeout(() => {
                modal.remove();
            }, 300);
        };

        document.getElementById('closeWeekModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelWeekModalBtn').addEventListener('click', closeModal);
        
        document.getElementById('saveWeekModalBtn').addEventListener('click', () => {
            const dateVal = document.getElementById('modalWeekDatePicker').value;
            if (!dateVal) {
                appAlert("Debes seleccionar una fecha.", "warning");
                return;
            }

            const dateObj = new Date(dateVal);
            const { week, year } = getISOWeekAndYear(dateObj);
            const cleanWeek = `W${week}-${year}`;
            const newColor = getWeekColor(cleanWeek);

            // Actualizar todos los tramos de este grupo
            state.tramos.forEach(t => {
                if (t.status === 'completed' && t.weekCompleted === groupKey) {
                    t.weekCompleted = cleanWeek;
                    t.color = newColor;
                    t.dateCompleted = dateVal;

                    if (t.mapLayer) {
                        t.mapLayer.setStyle({
                            color: t.color,
                            weight: 6,
                            opacity: 0.9,
                            dashArray: null
                        });
                    }
                }
            });

            logDebug(`Semana importada renombrada a ${cleanWeek} (Fecha: ${dateVal}). Se actualizaron ${tramosInGroup.length} tramos.`);
            saveToLocalStorage();
            updateUI();
            closeModal();
        });

    } catch (e) {
        console.error("Error al abrir modal de edición de semana:", e);
        appAlert("Fallo al abrir el editor de semana: " + e.message, "error");
    }
}

// Renombrar una semana importada del KML para todos los tramos de ese grupo
function editImportedWeek(groupKey) {
    showEditWeekModal(groupKey);
}

// Exponer la función globalmente para que pueda llamarse desde la leyenda
window.editImportedWeek = editImportedWeek;

// Actualizar lista visual de archivos cargados
function updateLoadedFilesList() {
    try {
        const container = document.getElementById('loadedFilesList');
        if (!container) return;

        container.innerHTML = '';

        if (!state.loadedFiles || state.loadedFiles.length === 0) {
            container.innerHTML = '<li class="loaded-file-empty">Ningún archivo cargado</li>';
            return;
        }

        state.loadedFiles.forEach(file => {
            const item = document.createElement('li');
            item.className = 'loaded-file-item';
            item.innerHTML = `
                <div class="loaded-file-info">
                    <span class="loaded-file-name" title="${file.name}">${file.name}</span>
                    <span class="loaded-file-meta">${file.tramosCount} tramos</span>
                </div>
                <button class="btn-remove-file" onclick="removeFile('${file.id}')" title="Quitar archivo"><i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--danger); vertical-align: middle;"></i></button>
            `;
            container.appendChild(item);
        });
    } catch (e) {
        console.error("Error en updateLoadedFilesList:", e);
    }
}

// Eliminar un archivo KML/KMZ cargado y limpiar todos sus tramos
async function removeFile(fileId) {
    try {
        const fileIndex = state.loadedFiles.findIndex(f => f.id === fileId);
        if (fileIndex === -1) return;

        const fileToRemove = state.loadedFiles[fileIndex];
        const confirmado = await appConfirm(`¿Estás seguro de que deseas eliminar el archivo "${fileToRemove.name}" y todos sus tramos asociados?`, "Eliminar Archivo", true);
        if (confirmado) {
            // Eliminar las capas del mapa de los tramos que se van a quitar
            state.tramos.forEach(t => {
                if (t.fileId === fileId && t.mapLayer) {
                    tramosLayerGroup.removeLayer(t.mapLayer);
                }
            });

            // Filtrar tramos
            state.tramos = state.tramos.filter(t => t.fileId !== fileId);

            // Filtrar el orden de ruta
            state.routeOrder = state.routeOrder.filter(id => state.tramos.some(t => t.id === id));

            // Eliminar de la lista de archivos cargados
            state.loadedFiles.splice(fileIndex, 1);

            // Actualizar estado de carga
            state.fileLoaded = state.loadedFiles.length > 0;

            saveToLocalStorage();

            // Re-dibujar capas y actualizar interfaz
            renderTramosOnMap();
            updateUI();
            fitMapToBounds();

            appAlert(`Archivo "${fileToRemove.name}" eliminado correctamente.`, 'success');
        }
    } catch (e) {
        console.error("Error en removeFile:", e);
        appAlert("Fallo al eliminar archivo: " + e.message, 'error');
    }
}

// Cambiar estado de completado
function toggleTramoCompletion() {
    try {
        const tramo = state.tramos.find(t => t.id === state.selectedTramoId);
        if (!tramo) {
            appAlert("No se encontró el tramo con ID: " + state.selectedTramoId, 'error');
            return;
        }

        if (tramo.status === 'pending') {
            // Completar
            tramo.status = 'completed';
            const dateVal = document.getElementById('detailDate').value || new Date().toISOString().split('T')[0];
            tramo.dateCompleted = dateVal;
            
            // Calcular semana
            const dateObj = new Date(dateVal);
            const { week, year } = getISOWeekAndYear(dateObj);
            tramo.weekCompleted = `W${week}-${year}`;
            
            // Asignar color dinámico de la paleta (reutilizando color de la semana si existe)
            tramo.color = getWeekColor(tramo.weekCompleted);
        } else {
            // Poner pendiente
            tramo.status = 'pending';
            tramo.dateCompleted = null;
            tramo.weekCompleted = null;
            tramo.color = null;
        }

        // Actualizar estilo en el mapa inmediatamente
        const isComp = tramo.status === 'completed';
        if (tramo.mapLayer) {
            tramo.mapLayer.setStyle({
                color: isComp ? tramo.color : getPendingColor(),
                weight: isComp ? 6 : 5,
                opacity: isComp ? 0.9 : 0.85,
                dashArray: isComp ? null : '10, 10'
            });
        }

        saveToLocalStorage();
        updateUI();
        closeRoadDetail();
    } catch (e) {
        console.error("Error en toggleTramoCompletion:", e);
        appAlert("Fallo al cambiar estado de desbroce: " + e.message, 'error');
    }
}

// Activar el Modo de División (Split Mode) para un tramo de carretera
function startSplitTramoMode(tramoId) {
    const id = tramoId || state.selectedTramoId;
    if (!id) return;

    try {
        const tramo = state.tramos.find(t => t.id === id);
        if (!tramo) return;

        // Cerrar popups abiertos para no molestar en la interacción
        map.closePopup();

        // 1. Mostrar banner de instrucciones en la parte superior del mapa
        let splitBanner = document.getElementById('splitBanner');
        if (!splitBanner) {
            splitBanner = document.createElement('div');
            splitBanner.id = 'splitBanner';
            splitBanner.style.cssText = `
                position: absolute;
                top: 15px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 10000;
                background: rgba(20, 20, 22, 0.98);
                border: 1px solid var(--warning);
                border-radius: 12px;
                color: #e4e4e7;
                padding: 12px 16px;
                font-family: 'Outfit', sans-serif;
                font-size: 0.82rem;
                font-weight: 600;
                box-shadow: 0 8px 30px rgba(0,0,0,0.6);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                width: 92%;
                max-width: 480px;
                box-sizing: border-box;
                pointer-events: auto;
                transition: all 0.3s ease;
            `;
            document.body.appendChild(splitBanner);
        }
        splitBanner.innerHTML = `
            <span style="flex: 1; line-height: 1.35; text-align: left;">✂️ Modo de división activo. Haz clic sobre la carretera en el mapa para dividirla.</span>
            <button id="cancelSplitBtn" style="background: #ef4444; color: white; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; font-weight: bold; flex-shrink: 0; transition: background-color 0.2s;">Cancelar</button>
        `;

        const polyline = tramo.mapLayer;
        if (!polyline) {
            appAlert("No se puede visualizar el tramo en el mapa para dividirlo.", 'error');
            if (splitBanner) splitBanner.remove();
            return;
        }

        // Activar el estado global de división
        state.isSplitMode = true;
        state.splitTramoId = id;

        // Guardar el estilo original antes de modificarlo para poder restaurarlo si cancela
        originalStyle = {
            color: polyline.options.color,
            weight: polyline.options.weight,
            opacity: polyline.options.opacity
        };
        highlightedLayer = polyline;

        // Poner la carretera en un color de advertencia discontinuo llamativo
        polyline.setStyle({
            color: '#f59e0b',
            weight: 8,
            opacity: 1.0,
            dashArray: '5, 10'
        });

        // Cambiar cursor a cruz (crosshair) al pasar sobre la línea y sobre su zona táctil invisible
        if (polyline.getElement()) {
            polyline.getElement().style.cursor = 'crosshair';
        }
        const clickTarget = tramo.clickTarget;
        if (clickTarget && clickTarget.getElement()) {
            clickTarget.getElement().style.cursor = 'crosshair';
        }

        // Cancelar el modo
        const cleanupSplitMode = () => {
            state.isSplitMode = false;
            state.splitTramoId = null;
            activeSplitCleanup = null;

            if (splitBanner) {
                splitBanner.remove();
            }
            if (polyline) {
                polyline.setStyle(originalStyle);
                if (polyline.getElement()) {
                    polyline.getElement().style.cursor = '';
                }
            }
            if (clickTarget && clickTarget.getElement()) {
                clickTarget.getElement().style.cursor = '';
            }
            highlightedLayer = null;
            document.removeEventListener('keydown', onEscKey);
        };

        activeSplitCleanup = cleanupSplitMode;

        const onEscKey = (e) => {
            if (e.key === 'Escape') {
                cleanupSplitMode();
                openRoadDetail(id);
            }
        };
        document.addEventListener('keydown', onEscKey);

        document.getElementById('cancelSplitBtn').addEventListener('click', () => {
            cleanupSplitMode();
            openRoadDetail(id);
        });

    } catch (err) {
        console.error("Error al iniciar modo de división:", err);
        appAlert("Fallo al iniciar el modo de división: " + err.message, 'error');
    }
}

// Dividir físicamente el tramo de carretera en la coordenada más cercana al clic
function splitTramoAtPoint(tramo, latlng) {
    try {
        const coords = tramo.coordinates;
        if (coords.length < 3) {
            appAlert("Este tramo es demasiado corto y no se puede dividir (requiere al menos 3 coordenadas).", "warning");
            return;
        }

        // Buscar el nodo de coordenadas más cercano
        let closestIdx = -1;
        let minDistance = Infinity;
        for (let i = 0; i < coords.length; i++) {
            const dist = getHaversineDistance(latlng.lat, latlng.lng, coords[i][0], coords[i][1]);
            if (dist < minDistance) {
                minDistance = dist;
                closestIdx = i;
            }
        }

        // Validar que no se haga split en los extremos absolutos
        if (closestIdx <= 0 || closestIdx >= coords.length - 1) {
            appAlert("No puedes dividir el tramo en sus extremos. Haz clic en algún punto intermedio de la carretera.", "warning");
            return;
        }

        // Dividir coordenadas
        const coordsPart1 = coords.slice(0, closestIdx + 1);
        const coordsPart2 = coords.slice(closestIdx);

        const length1 = calculateLineLength(coordsPart1);
        const length2 = calculateLineLength(coordsPart2);

        // Crear los dos nuevos tramos con información de retorno (parentInfo)
        const timePart = Date.now();
        const parentInfo = {
            id: tramo.id,
            name: tramo.parentInfo ? tramo.parentInfo.name : tramo.name,
            status: tramo.parentInfo ? tramo.parentInfo.status : tramo.status,
            rightMarginStatus: tramo.parentInfo ? tramo.parentInfo.rightMarginStatus : tramo.rightMarginStatus,
            leftMarginStatus: tramo.parentInfo ? tramo.parentInfo.leftMarginStatus : tramo.leftMarginStatus,
            dateCompleted: tramo.parentInfo ? tramo.parentInfo.dateCompleted : tramo.dateCompleted,
            color: tramo.parentInfo ? tramo.parentInfo.color : tramo.color,
            weekNumber: tramo.parentInfo ? tramo.parentInfo.weekNumber : tramo.weekNumber,
            weekCompleted: tramo.parentInfo ? tramo.parentInfo.weekCompleted : tramo.weekCompleted
        };

        // Determinar nombres jerárquicos decimales para evitar acumulaciones liosas de "(Parte X)"
        const nameMatch = tramo.name.match(/(.+)\s+\(Parte\s+([\d\.]+)\)$/);
        let namePart1, namePart2;
        if (nameMatch) {
            const cleanBase = nameMatch[1];
            const currentSeq = nameMatch[2];
            namePart1 = `${cleanBase} (Parte ${currentSeq}.1)`;
            namePart2 = `${cleanBase} (Parte ${currentSeq}.2)`;
        } else {
            namePart1 = `${tramo.name} (Parte 1)`;
            namePart2 = `${tramo.name} (Parte 2)`;
        }

        const part1 = {
            ...tramo,
            id: `${tramo.id}_p1_${timePart}`,
            name: namePart1,
            coordinates: coordsPart1,
            originalCoordinates: coordsPart1.map(c => [...c]),
            length: length1,
            mapLayer: null,
            parentInfo: parentInfo,
            latLngsCache: undefined,
            totalLength: undefined,
            accumLengths: undefined
        };

        const part2 = {
            ...tramo,
            id: `${tramo.id}_p2_${timePart}`,
            name: namePart2,
            coordinates: coordsPart2,
            originalCoordinates: coordsPart2.map(c => [...c]),
            length: length2,
            mapLayer: null,
            parentInfo: parentInfo,
            latLngsCache: undefined,
            totalLength: undefined,
            accumLengths: undefined
        };

        // Reemplazar tramo en la lista principal
        const tramoIndex = state.tramos.findIndex(t => t.id === tramo.id);
        if (tramoIndex !== -1) {
            state.tramos.splice(tramoIndex, 1, part1, part2);
        }

        // Reemplazar en la secuencia de ruta ordenada
        const routeIdx = state.routeOrder.indexOf(tramo.id);
        if (routeIdx !== -1) {
            state.routeOrder.splice(routeIdx, 1, part1.id, part2.id);
        }

        // Remover la capa original del mapa
        if (tramo.mapLayer && map) {
            tramosLayerGroup.removeLayer(tramo.mapLayer);
        }

        logDebug(`Tramo '${tramo.name}' dividido en dos partes: '${part1.name}' y '${part2.name}'.`);

        saveToLocalStorage();
        renderTramosOnMap();
        updateUI();

        // Alerta personalizada de éxito
        appAlert(`El tramo '${tramo.name}' ha sido dividido con éxito en dos partes.`, 'success');

        // Abrir automáticamente el detalle de la primera parte para conveniencia del operario
        setTimeout(() => {
            openRoadDetail(part1.id);
        }, 300);

    } catch (e) {
        console.error("Error al dividir tramo:", e);
        appAlert("Fallo al dividir el tramo: " + e.message, "error");
    }
}

// Deshacer la división y volver a unir los tramos hijos en el original
async function undoSplitTramo(tramoId) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        let parentId = null;
        let partPrefix = null;
        let timestamp = null;

        if (tramo.parentInfo && tramo.parentInfo.id) {
            parentId = tramo.parentInfo.id;
            const match = tramo.id.match(/(.+)(_p[12]_)(\d+)$/);
            if (match) {
                partPrefix = match[2];
                timestamp = match[3];
            }
        } else {
            const match = tramo.id.match(/(.+)(_p[12]_)(\d+)$/);
            if (match) {
                parentId = match[1];
                partPrefix = match[2];
                timestamp = match[3];
            }
        }

        if (!parentId || !partPrefix || !timestamp) {
            appAlert("Este tramo no proviene de una división o no se puede identificar su origen.", "warning");
            return;
        }

        const partnerId = partPrefix === '_p1_' ? `${parentId}_p2_${timestamp}` : `${parentId}_p1_${timestamp}`;
        const partner = state.tramos.find(t => t.id === partnerId);

        if (!partner) {
            appAlert("No se puede deshacer la división. La otra mitad de esta carretera no se encuentra en la lista actual (puede haber sido eliminada o subdividida nuevamente).", "warning");
            return;
        }

        const confirmUndo = await appConfirm(
            `¿Estás seguro de que deseas deshacer el corte y volver a unir '${tramo.name}' y '${partner.name}' en la carretera original?`,
            "Deshacer División"
        );
        if (!confirmUndo) return;

        const part1 = partPrefix === '_p1_' ? tramo : partner;
        const part2 = partPrefix === '_p1_' ? partner : tramo;

        // Unir coordenadas. El último punto de part1 es idéntico al primer punto de part2.
        const mergedCoords = [...part1.coordinates.slice(0, -1), ...part2.coordinates];

        // Reconstruir el tramo original (padre)
        const parentTramo = {
            id: parentId,
            name: tramo.parentInfo ? tramo.parentInfo.name : tramo.name.replace(/\s*\(Parte\s+[12]\)$/, ''),
            fileId: tramo.fileId,
            coordinates: mergedCoords,
            originalCoordinates: mergedCoords.map(c => [...c]),
            length: calculateLineLength(mergedCoords),
            status: tramo.parentInfo ? tramo.parentInfo.status : 'pending',
            rightMarginStatus: tramo.parentInfo ? tramo.parentInfo.rightMarginStatus : 'pending',
            leftMarginStatus: tramo.parentInfo ? tramo.parentInfo.leftMarginStatus : 'pending',
            dateCompleted: tramo.parentInfo ? tramo.parentInfo.dateCompleted : null,
            color: tramo.parentInfo ? tramo.parentInfo.color : null,
            weekNumber: tramo.parentInfo ? tramo.parentInfo.weekNumber : null,
            weekCompleted: tramo.parentInfo ? tramo.parentInfo.weekCompleted : null,
            mapLayer: null
        };

        // Si el padre original tenía parentInfo de un nivel superior (ej. abuelo), lo mantenemos
        if (tramo.parentInfo && tramo.parentInfo.parentInfo) {
            parentTramo.parentInfo = tramo.parentInfo.parentInfo;
        }

        // Reemplazar los dos tramos hijos por el padre en state.tramos
        const idx1 = state.tramos.findIndex(t => t.id === part1.id);
        const idx2 = state.tramos.findIndex(t => t.id === part2.id);

        if (idx1 !== -1 && idx2 !== -1) {
            const minIdx = Math.min(idx1, idx2);
            const maxIdx = Math.max(idx1, idx2);
            state.tramos.splice(maxIdx, 1);
            state.tramos.splice(minIdx, 1, parentTramo);
        }

        // Reemplazar en state.routeOrder
        const rIdx1 = state.routeOrder.indexOf(part1.id);
        const rIdx2 = state.routeOrder.indexOf(part2.id);
        if (rIdx1 !== -1 && rIdx2 !== -1) {
            const rMinIdx = Math.min(rIdx1, rIdx2);
            const rMaxIdx = Math.max(rIdx1, rIdx2);
            state.routeOrder.splice(rMaxIdx, 1);
            state.routeOrder.splice(rMinIdx, 1, parentTramo.id);
        }

        // Remover las capas del mapa de ambos tramos hijos
        if (part1.mapLayer && map) tramosLayerGroup.removeLayer(part1.mapLayer);
        if (part2.mapLayer && map) tramosLayerGroup.removeLayer(part2.mapLayer);

        saveToLocalStorage();
        renderTramosOnMap();
        updateUI();

        map.closePopup();

        appAlert(`Los tramos se han vuelto a unir correctamente en '${parentTramo.name}'.`, 'success');

        // Abrir detalles del tramo unido
        setTimeout(() => {
            openRoadDetail(parentTramo.id);
        }, 300);

    } catch (err) {
        console.error("Error al deshacer división:", err);
        appAlert("Fallo al unir los tramos: " + err.message, "error");
    }
}

// Algoritmo de color estable basado en la semana
function getDeterministicColor(weekKey) {
    // Generar un hash numérico sencillo del string de la semana "WXX-YYYY"
    let hash = 0;
    for (let i = 0; i < weekKey.length; i++) {
        hash = weekKey.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % COLOR_PALETTE.length;
    return COLOR_PALETTE[index];
}

// Obtener el color asignado a una semana. Si ya existen tramos de esa semana,
// devuelve su mismo color. Si no, genera el color determinista correspondiente.
function getWeekColor(weekKey) {
    if (!weekKey) return '#3b82f6';
    if (state.customColors && state.customColors[weekKey]) {
        return state.customColors[weekKey];
    }
    const existing = state.tramos.find(t => t.status === 'completed' && t.weekCompleted === weekKey);
    if (existing && existing.color) {
        return existing.color;
    }
    return getDeterministicColor(weekKey);
}

// Calcular número de semana ISO y año
function getISOWeekAndYear(date) {
    const tempDate = new Date(date.valueOf());
    
    // El estándar ISO especifica que la semana empieza en Lunes
    // Buscamos el jueves de la misma semana
    const dayNum = (date.getDay() + 6) % 7; // Lunes=0, Domingo=6
    tempDate.setDate(tempDate.getDate() - dayNum + 3);
    
    const firstThursday = tempDate.valueOf();
    tempDate.setMonth(0, 1);
    if (tempDate.getDay() !== 4) {
        tempDate.setMonth(0, 1 + ((4 - tempDate.getDay() + 7) % 7));
    }
    
    const weekNum = 1 + Math.ceil((firstThursday - tempDate) / 604800000);
    return {
        week: weekNum.toString().padStart(2, '0'),
        year: new Date(firstThursday).getFullYear()
    };
}

// Obtener el rango de fechas en formato DD/MM para una semana ISO
function getWeekDateRangeString(weekKey) {
    try {
        const match = weekKey.match(/W(\d+)-(\d+)/);
        if (!match) return '';
        
        const week = parseInt(match[1]);
        const year = parseInt(match[2]);

        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const dayOfWeek = simple.getDay();
        const monday = new Date(simple);
        
        if (dayOfWeek <= 4) {
            monday.setDate(simple.getDate() - simple.getDay() + 1);
        } else {
            monday.setDate(simple.getDate() + 8 - simple.getDay());
        }

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const format = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

        return `Del ${format(monday)} al ${format(sunday)}`;
    } catch (e) {
        console.error("Error al calcular rango de fechas de la semana:", e);
        return '';
    }
}

// --- GESTIÓN DE PANTALLA SIEMPRE ENCENDIDA (WAKE LOCK API) ---
let wakeLock = null;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            logDebug('Pantalla siempre encendida (Wake Lock) activa.');
        }
    } catch (err) {
        console.warn('Wake Lock no soportado o denegado por el navegador:', err);
    }
}

function releaseWakeLock() {
    try {
        if (wakeLock) {
            wakeLock.release();
            wakeLock = null;
            logDebug('Pantalla siempre encendida (Wake Lock) liberada.');
        }
    } catch (err) {
        console.error('Error al liberar Wake Lock:', err);
    }
}

// Iniciar geolocalización web mediante watchPosition
function startWebGpsWatch() {
    if (!navigator.geolocation) {
        appAlert("Tu navegador no soporta geolocalización.", "error");
        if (state.gpsActive) toggleGPS();
        return;
    }
    
    if (webGpsWatchId !== null) {
        navigator.geolocation.clearWatch(webGpsWatchId);
    }
    
    webGpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
            onLocationFound({
                latlng: latlng,
                accuracy: position.coords.accuracy,
                heading: position.coords.heading,
                speed: position.coords.speed
            });
        },
        (error) => {
            onLocationError({ message: error.message });
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0 // Forzar lectura directa sin caché
        }
    );
}

// Reactivar/pausar Wake Lock y GPS si el usuario cambia de app y regresa para ahorrar batería y no calentarse
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        if (state.gpsActive) {
            await requestWakeLock();
            if (!window.ReactNativeWebView && webGpsWatchId === null) {
                logDebug('Aplicación en primer plano: reactivando señal GPS automáticamente.');
                const btn = document.getElementById('gpsToggle');
                if (btn) btn.classList.add('searching');
                startWebGpsWatch();
            }
        }
    } else {
        // En segundo plano
        if (state.gpsActive) {
            releaseWakeLock();
            if (!window.ReactNativeWebView && webGpsWatchId !== null) {
                navigator.geolocation.clearWatch(webGpsWatchId);
                webGpsWatchId = null;
                logDebug('Aplicación en segundo plano: GPS suspendido temporalmente para ahorrar batería.');
            }
        }
    }
});

// --- GEOLOCALIZACIÓN GPS ---
let webGpsWatchId = null;

function toggleGPS() {
    const btn = document.getElementById('gpsToggle');
    
    if (state.gpsActive) {
        // Desactivar GPS
        if (!window.ReactNativeWebView && webGpsWatchId !== null) {
            navigator.geolocation.clearWatch(webGpsWatchId);
            webGpsWatchId = null;
        }
        if (gpsMarker) map.removeLayer(gpsMarker);
        if (gpsCircle) map.removeLayer(gpsCircle);
        gpsMarker = null;
        gpsCircle = null;
        state.gpsActive = false;
        state.userLocation = null;
        hasInitialGpsReorder = false;
        btn.classList.remove('active');
        btn.classList.remove('searching'); // Quitar spinner de carga al apagar
        releaseWakeLock(); // Permitir que la pantalla se apague al apagar el GPS
        showPreciseLocationHelper(false); // Limpiar ayuda si estuviera abierta
    } else {
        // Activar GPS
        state.gpsActive = true;
        btn.classList.add('active');
        btn.classList.add('searching'); // Iniciar spinner de búsqueda
        hasInitialGpsReorder = false;
        requestWakeLock(); // Evitar que la pantalla se apague al encender el GPS

        // Solo activar geolocalización del navegador si NO estamos dentro de la app nativa WebView
        if (!window.ReactNativeWebView) {
            startWebGpsWatch();
        }
    }
    if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'gpsToggle',
            active: state.gpsActive
        }));
    }

    updateUI();
}

function onLocationFound(e) {
    const radius = e.accuracy;
    state.userLocation = e.latlng;

    // Resolver cualquier promesa en espera del primer fix de GPS
    if (typeof state.onFirstLocationFix === 'function') {
        state.onFirstLocationFix(e.latlng);
        state.onFirstLocationFix = null;
    }

    // Detener el spinner de carga (searching) ya que el marcador está posicionado en el mapa
    const gpsBtn = document.getElementById('gpsToggle');
    if (gpsBtn && gpsBtn.classList.contains('searching')) {
        gpsBtn.classList.remove('searching');
    }

    // Registro interno en consola (sin saturar el panel de diagnóstico visual en la UI de la app)
    console.log(`Lectura GPS: lat=${e.latlng.lat.toFixed(6)}, lng=${e.latlng.lng.toFixed(6)}, precisión=${Math.round(radius)}m`);

    // Si la precisión es baja (mayor a 300m), evaluamos si mostrar ayuda
    if (radius > 300) {
        if (!state.badGpsCount) state.badGpsCount = 0;
        state.badGpsCount++;
        // Si es aproximada pura (>= 1000m) se muestra al instante. Si es intermedia, espera 3 lecturas para evitar falsos positivos
        if (radius >= 1000 || state.badGpsCount >= 3) {
            showPreciseLocationHelper(true);
        }
    } else {
        state.badGpsCount = 0;
        showPreciseLocationHelper(false); // Ocultar si la señal vuelve a ser precisa
    }

    // Filtro de estabilidad (deadband) para evitar que el punto vibre o salte al estar parados
    let shouldUpdateVisualPosition = true;
    if (gpsMarker) {
        const lastLatLng = gpsMarker.getLatLng();
        const distMoved = lastLatLng.distanceTo(e.latlng);
        // Si nos hemos movido menos de 3.5 metros y la velocidad es menor a 3.0 km/h (0.83 m/s),
        // congelamos la posición visual para mantener el marcador totalmente estático.
        if (distMoved < 3.5 && (e.speed === undefined || e.speed === null || e.speed < 0.83)) {
            shouldUpdateVisualPosition = false;
        }
    }

    if (shouldUpdateVisualPosition) {
        state.userLocation = e.latlng;
        
        if (gpsMarker) {
            gpsMarker.setLatLng(e.latlng);
            gpsCircle.setLatLng(e.latlng);
            gpsCircle.setRadius(radius);
        } else {
            // Icono de posición con diseño de pulso azul y flecha de dirección integrada
            const gpsIcon = L.divIcon({
                className: 'gps-pulse-marker',
                html: `<div class="pulse"></div><div class="dot"><div class="arrow" id="gpsArrow" style="display: none;"></div></div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            gpsMarker = L.marker(e.latlng, { icon: gpsIcon }).addTo(map);
            gpsCircle = L.circle(e.latlng, radius, {
                color: COLOR_GPS,
                fillColor: COLOR_GPS,
                fillOpacity: 0.15,
                weight: 1
            }).addTo(map);

            // La primera vez que encuentra ubicación, centramos el mapa con zoom adecuado
            map.setView(e.latlng, 16);
        }
    }

    // Rotar y mostrar la flecha de dirección solo si estamos avanzando a más de 3.0 km/h (0.83 m/s)
    const arrow = document.getElementById('gpsArrow');
    if (arrow) {
        if (e.heading !== undefined && e.heading !== null && e.speed > 0.83) {
            arrow.style.transform = `rotate(${e.heading}deg)`;
            arrow.style.display = 'block';
        } else {
            arrow.style.display = 'none';
        }
    }

    // Si el GPS está activo y aún no hemos hecho el reordenamiento inicial, lo hacemos
    if (state.gpsActive && !hasInitialGpsReorder) {
        logDebug("GPS conectado. Reordenando secuencia de trabajo desde la posición actual...");
        reorderRouteFromLocation(e.latlng);
        hasInitialGpsReorder = true;
    }

    // Lógica del co-piloto de guiado en tiempo real
    if (state.activeWork && state.activeWork.tramoId) {
        updateActiveWorkProgress(e.latlng, e.speed);
        // Centrar automáticamente la cámara en el GPS durante el trabajo activo para mantener el vehículo visible
        map.panTo(e.latlng);
    } else {
        suggestNearbyTramo(e.latlng);
    }
}

function onLocationError(e) {
    console.error('Error de GPS:', e.message);
    logDebug('Error de GPS: ' + e.message, 'warning');
    
    // Si la app está en segundo plano, no molestamos al usuario ni desactivamos el GPS
    if (document.visibilityState === 'hidden') {
        return;
    }
    
    // En lugar de apagar el GPS al primer error (ej. pérdida de cobertura momentánea),
    // simplemente mostramos el indicador de búsqueda en el botón flotante para reconectar.
    const btn = document.getElementById('gpsToggle');
    if (btn) {
        btn.classList.add('searching');
    }
}

// Mostrar u ocultar la tarjeta tutorial para activar Ubicación Precisa en Chrome
function showPreciseLocationHelper(show) {
    let helper = document.getElementById('gps-precise-helper');
    if (show) {
        if (!helper) {
            helper = document.createElement('div');
            helper.id = 'gps-precise-helper';
            helper.style.cssText = `
                position: absolute;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(0);
                width: 90%;
                max-width: 400px;
                background: rgba(9, 9, 11, 0.95);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: #f4f4f5;
                padding: 20px;
                border-radius: 20px;
                font-family: 'Outfit', sans-serif;
                z-index: 10000;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(239, 68, 68, 0.3);
                transition: opacity 0.3s ease, transform 0.3s ease;
            `;
            helper.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                    <div class="gps-pulse-dot-red"></div>
                    <strong style="font-size: 1rem; color: #fecaca; font-family: 'Outfit', sans-serif;">Ubicación Precisa Requerida</strong>
                </div>
                <p style="font-size: 0.85rem; line-height: 1.5; color: #cbd5e1; margin: 0 0 15px 0;">
                    Se ha detectado ubicación aproximada. Para guiarte correctamente en el tractor, activa la precisión alta en tu móvil:
                </p>
                <ol style="font-size: 0.8rem; line-height: 1.6; color: #cbd5e1; padding-left: 20px; margin: 0 0 15px 0;">
                    <li>Abre los <strong>Ajustes</strong> de tu móvil.</li>
                    <li>Ve a <strong>Aplicaciones</strong> y selecciona <strong>Chrome</strong>.</li>
                    <li>Entra en <strong>Permisos</strong> &gt; <strong>Ubicación</strong>.</li>
                    <li>Activa la opción <strong>"Usar ubicación precisa"</strong>.</li>
                </ol>
                <button onclick="showPreciseLocationHelper(false)" style="
                    width: 100%;
                    background: #10b981;
                    color: white;
                    border: none;
                    padding: 10px;
                    border-radius: 10px;
                    font-weight: 600;
                    font-size: 0.85rem;
                    cursor: pointer;
                    font-family: 'Outfit', sans-serif;
                ">Entendido</button>
            `;
            document.body.appendChild(helper);
        }
        helper.style.opacity = '1';
        helper.style.transform = 'translateX(-50%) translateY(0)';
    } else {
        if (helper) {
            helper.style.opacity = '0';
            helper.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => {
                if (helper && helper.style.opacity === '0') {
                    helper.remove();
                }
            }, 300);
        }
    }
}

// Esperar asíncronamente el primer fix de coordenadas del GPS
function waitForGpsFix(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        // Si ya tenemos coordenadas válidas, resolvemos de inmediato
        if (state.userLocation) {
            resolve(state.userLocation);
            return;
        }

        // Crear una indicación visual en la parte superior para que el usuario sepa que está conectando
        const banner = document.createElement('div');
        banner.id = 'gps-waiting-fix-overlay';
        banner.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(9, 9, 11, 0.95);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: #f4f4f5;
            padding: 14px 28px;
            border-radius: 20px;
            font-family: 'Outfit', sans-serif;
            font-size: 0.85rem;
            font-weight: 600;
            z-index: 10001;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
            border: 1px solid rgba(245, 158, 11, 0.3);
            display: flex;
            align-items: center;
            gap: 12px;
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;
        banner.innerHTML = `
            <div class="gps-pulse-dot-orange" style="margin-right: 4px;"></div>
            <span>Estableciendo conexión con satélites GPS...</span>
        `;
        document.body.appendChild(banner);

        // Guardar el callback temporal
        state.onFirstLocationFix = (latlng) => {
            clearTimeout(timer);
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 300);
            resolve(latlng);
        };

        const timer = setTimeout(() => {
            state.onFirstLocationFix = null;
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 300);
            reject(new Error("Timeout esperando señal GPS"));
        }, timeoutMs);
    });
}

// Alternar capa de mapa entre oscuro y satélite
function toggleMapLayer() {
    try {
        const btn = document.getElementById('mapLayerToggle');
        if (!btn) return;

        if (currentBaseLayer === 'dark') {
            if (darkTileLayer) map.removeLayer(darkTileLayer);
            if (satelliteTileLayer) satelliteTileLayer.addTo(map);
            currentBaseLayer = 'satellite';
            btn.classList.add('active');
            logDebug("Capa de mapa cambiada a Satélite.");
        } else {
            if (satelliteTileLayer) map.removeLayer(satelliteTileLayer);
            if (darkTileLayer) darkTileLayer.addTo(map);
            currentBaseLayer = 'dark';
            btn.classList.remove('active');
            logDebug("Capa de mapa cambiada a Oscuro.");
        }
        saveToLocalStorage();
    } catch (e) {
        console.error("Error al cambiar capa de mapa:", e);
    }
}

// --- EXPORTACIÓN A KML ---
// Convierte el estado actual a un archivo KML manteniendo estilos y colores semanales
function exportKML() {
    if (state.tramos.length === 0) return;

    const firstFileName = (state.loadedFiles && state.loadedFiles.length > 0) ? state.loadedFiles[0].name : "desbroce";
    const baseName = firstFileName.replace(/\.[^/.]+$/, "");

    // Extraer todas las semanas únicas y generar sus estadísticas
    const semanasStats = {}; // weekKey -> { color, length }
    let totalBlockedKm = 0;
    let totalPartialKm = 0;
    let totalCompletedKm = 0;

    state.tramos.forEach(t => {
        const isBlocked = isTramoFullyBlocked(t);
        const isCompleted = t.status === 'completed';
        const isPartial = t.status === 'partial';

        if (isBlocked) {
            totalBlockedKm += (t.length || 0);
        } else if (isCompleted) {
            totalCompletedKm += (t.length || 0);
            if (t.weekCompleted) {
                const semLabel = t.weekCompleted.startsWith('KML_') ? `Importada (Color ${getColorNameSpanish(t.color)})` : t.weekCompleted;
                if (!semanasStats[semLabel]) {
                    semanasStats[semLabel] = {
                        color: t.color || '#3b82f6',
                        length: 0
                    };
                }
                semanasStats[semLabel].length += t.length;
            }
        } else if (isPartial) {
            totalPartialKm += (t.length || 0);
        }
    });

    // Recopilar todas las observaciones (alertas) de todos los tramos
    const allAlerts = [];
    state.tramos.forEach(t => {
        if (t.observaciones && Array.isArray(t.observaciones)) {
            t.observaciones.forEach(obs => {
                allAlerts.push({
                    ...obs,
                    tramoName: t.name,
                    tramoId: t.id
                });
            });
        }
    });

    // Construir texto plano (sin etiquetas HTML) para la descripción de Google Earth
    let descriptionText = `Resumen de Avance de Desbroce\n`;
    descriptionText += `============================\n`;
    descriptionText += `Kilómetros desbrozados por semana:\n`;

    const sortedWeeks = Object.keys(semanasStats).sort();
    sortedWeeks.forEach(sem => {
        const stat = semanasStats[sem];
        const km = (stat.length / 1000).toFixed(2);
        descriptionText += `- Semana ${sem}: ${km} km (Color: ${getColorNameSpanish(stat.color)})\n`;
    });

    descriptionText += `\nResumen global:\n`;
    descriptionText += `- Total Desbrozado: ${(totalCompletedKm / 1000).toFixed(2)} km\n`;
    descriptionText += `- Total Parcial: ${(totalPartialKm / 1000).toFixed(2)} km\n`;
    descriptionText += `- Total Bloqueado / Inaccesible: ${(totalBlockedKm / 1000).toFixed(2)} km\n`;
    descriptionText += `- Total Alertas registradas: ${allAlerts.length}\n`;

    descriptionText += `\nGenerado automáticamente por DesbroceApp el ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES')}.`;

    // Escapar caracteres XML básicos para evitar malformación del documento
    const escapedDesc = descriptionText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Colores KML (aabbggrr)
    const pendingKmlColor = convertHexToKmlColor(getPendingColor(), 'ff');
    const blockedKmlColor = convertHexToKmlColor(getBlockedColor(), 'ff');
    const partialKmlColor = convertHexToKmlColor(getPartialColor(), 'ff');

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${baseName} - Desbrozado</name>
    <description>${escapedDesc}</description>

    <!-- ESTILO PARA PENDIENTES -->
    <Style id="style_pending">
      <LineStyle>
        <color>${pendingKmlColor}</color>
        <width>3</width>
      </LineStyle>
    </Style>

    <!-- ESTILO PARA PARCIALES -->
    <Style id="style_partial">
      <LineStyle>
        <color>${partialKmlColor}</color>
        <width>5</width>
      </LineStyle>
    </Style>

    <!-- ESTILO PARA BLOQUEADOS -->
    <Style id="style_blocked">
      <LineStyle>
        <color>${blockedKmlColor}</color>
        <width>6</width>
      </LineStyle>
    </Style>

    <!-- ESTILOS DE PUNTOS PARA ALERTAS -->
    <Style id="style_alert_generic">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/warning.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="style_alert_vehicles">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/cabs.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="style_alert_branches">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/tree.png</href>
        </Icon>
      </IconStyle>
    </Style>
`;

    // Extraer todas las semanas únicas y generar sus estilos
    const semanasMap = {};
    state.tramos.forEach(t => {
        if (t.status === 'completed' && t.weekCompleted) {
            semanasMap[t.weekCompleted] = t.color;
        }
    });

    // Escribir los estilos de las semanas en el KML
    Object.keys(semanasMap).forEach(sem => {
        const hexColor = semanasMap[sem];
        const kmlColor = convertHexToKmlColor(hexColor, 'ff'); // opaco completo
        kml += `
    <Style id="style_${sem}">
      <LineStyle>
        <color>${kmlColor}</color>
        <width>5</width>
      </LineStyle>
    </Style>`;
    });

    // Escribir la carpeta de Carreteras/Tramos
    kml += `
    <Folder>
      <name>Carreteras y Tramos</name>`;

    // Escribir los Placemarks (carreteras) en el orden planificado
    state.routeOrder.forEach((tramoId, index) => {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        const isCompleted = tramo.status === 'completed';
        const isPartial = tramo.status === 'partial';
        const isBlocked = isTramoFullyBlocked(tramo);

        let styleUrl = '#style_pending';
        let estadoStr = 'PENDIENTE';

        if (isBlocked) {
            styleUrl = '#style_blocked';
            estadoStr = 'BLOQUEADO / INACCESIBLE';
        } else if (isCompleted) {
            styleUrl = `#style_${tramo.weekCompleted}`;
            estadoStr = 'DESBROZADO';
        } else if (isPartial) {
            styleUrl = '#style_partial';
            estadoStr = 'PARCIAL';
        }
        
        let desc = `Estado: ${estadoStr}\n`;
        desc += `Longitud: ${(tramo.length / 1000).toFixed(2)} km\n`;
        desc += `Margen Izquierdo: ${tramo.leftMarginStatus || 'pending'}\n`;
        desc += `Margen Derecho: ${tramo.rightMarginStatus || 'pending'}\n`;
        if (isCompleted) {
            desc += `Fecha finalización: ${tramo.dateCompleted || ''}\n`;
            desc += `Semana finalización: ${tramo.weekCompleted || ''}\n`;
        }
        desc += `Orden de planificación: ${index + 1}\n`;
        if (tramo.description) {
            desc += `\nDescripción original:\n${tramo.description}`;
        }

        // Formatear coordenadas de vuelta a formato KML: "lon,lat,alt lon,lat,alt ..."
        const coordString = tramo.coordinates.map(pt => `${pt[1]},${pt[0]},0`).join(' ');

        kml += `
      <Placemark>
        <name>${tramo.name}</name>
        <description><![CDATA[${desc}]]></description>
        <styleUrl>${styleUrl}</styleUrl>
        <ExtendedData>
          <Data name="status">
            <value>${isBlocked ? 'blocked' : tramo.status}</value>
          </Data>
          <Data name="leftMarginStatus">
            <value>${tramo.leftMarginStatus || 'pending'}</value>
          </Data>
          <Data name="rightMarginStatus">
            <value>${tramo.rightMarginStatus || 'pending'}</value>
          </Data>
          <Data name="dateCompleted">
            <value>${tramo.dateCompleted || ''}</value>
          </Data>
          <Data name="weekCompleted">
            <value>${tramo.weekCompleted || ''}</value>
          </Data>
          <Data name="routeOrder">
            <value>${index + 1}</value>
          </Data>
        </ExtendedData>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>
            ${coordString}
          </coordinates>
        </LineString>
      </Placemark>`;
    });

    kml += `
    </Folder>`;

    // Escribir la carpeta de Alertas / Observaciones si existen
    if (allAlerts.length > 0) {
        kml += `
    <Folder>
      <name>Alertas u Obstáculos (${allAlerts.length})</name>`;

        allAlerts.forEach(obs => {
            let iconStyle = '#style_alert_generic';
            if (obs.type === 'vehicles') iconStyle = '#style_alert_vehicles';
            else if (obs.type === 'branches') iconStyle = '#style_alert_branches';

            const obsDate = obs.date ? new Date(obs.date).toLocaleString('es-ES') : '';
            let obsDesc = `Tipo de Alerta: ${obs.label || 'Obstáculo'}\n`;
            obsDesc += `Carretera/Tramo: ${obs.tramoName}\n`;
            obsDesc += `Fecha registro: ${obsDate}\n`;
            if (obs.comment) {
                obsDesc += `Comentario: ${obs.comment}\n`;
            }

            kml += `
      <Placemark>
        <name>${obs.label || 'Alerta'}</name>
        <description><![CDATA[${obsDesc}]]></description>
        <styleUrl>${iconStyle}</styleUrl>
        <ExtendedData>
          <Data name="alertType">
            <value>${obs.type || 'generic'}</value>
          </Data>
          <Data name="tramoId">
            <value>${obs.tramoId}</value>
          </Data>
          <Data name="tramoName">
            <value>${obs.tramoName}</value>
          </Data>
          <Data name="isBlockSplit">
            <value>${obs.isBlockSplit ? 'true' : 'false'}</value>
          </Data>
        </ExtendedData>
        <Point>
          <coordinates>${obs.lng},${obs.lat},0</coordinates>
        </Point>
      </Placemark>`;
        });

        kml += `
    </Folder>`;
    }

    kml += `
  </Document>
</kml>`;

    // Descargar el archivo
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Nombre del archivo de salida: original + "desbrozado_semana"
    a.href = url;
    a.download = `${baseName}_avance_semanal.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Convertir Hexadecimal de CSS "#rrggbb" a color de KML "aabbggrr"
function convertHexToKmlColor(hex, alphaHex = 'ff') {
    // Quitar almohadilla si existe
    const cleanHex = hex.replace('#', '');
    
    // Extraer componentes
    const r = cleanHex.substring(0, 2);
    const g = cleanHex.substring(2, 4);
    const b = cleanHex.substring(4, 6);
    
    // En KML es Alpha + Blue + Green + Red (aabbggrr)
    return `${alphaHex}${b}${g}${r}`.toLowerCase();
}

// Exportar Informe de Avance de Desbroce en formato PDF usando jsPDF
async function exportPDF() {
    if (state.tramos.length === 0) return;

    try {
        const { jsPDF } = window.jspdf;
        if (!jsPDF) {
            appAlert("Librería jsPDF no cargada aún. Inténtalo de nuevo.", "error");
            return;
        }

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const firstFileName = (state.loadedFiles && state.loadedFiles.length > 0) ? state.loadedFiles[0].name : "desbroce";
        const baseName = firstFileName.replace(/\.[^/.]+$/, "");

        // 1. Cálculos de estadísticas
        let totalMeters = 0;
        let completedMeters = 0;
        let partialMeters = 0;
        let blockedMeters = 0;

        const semanasStats = {};
        const allAlerts = [];

        state.tramos.forEach(t => {
            totalMeters += (t.length || 0);
            const isBlocked = isTramoFullyBlocked(t);
            const isCompleted = t.status === 'completed';
            const isPartial = t.status === 'partial';

            if (isBlocked) {
                blockedMeters += (t.length || 0);
            } else if (isCompleted) {
                completedMeters += (t.length || 0);
                if (t.weekCompleted) {
                    const semLabel = t.weekCompleted.startsWith('KML_') ? `Importada (Color ${getColorNameSpanish(t.color)})` : t.weekCompleted;
                    if (!semanasStats[semLabel]) {
                        semanasStats[semLabel] = {
                            color: t.color || '#3b82f6',
                            length: 0
                        };
                    }
                    semanasStats[semLabel].length += t.length;
                }
            } else if (isPartial) {
                partialMeters += (t.length || 0);
            }

            if (t.observaciones && Array.isArray(t.observaciones)) {
                t.observaciones.forEach(obs => {
                    allAlerts.push({
                        ...obs,
                        tramoName: t.name
                    });
                });
            }
        });

        const totalKm = (totalMeters / 1000).toFixed(2);
        const completedKm = (completedMeters / 1000).toFixed(2);
        const partialKm = (partialMeters / 1000).toFixed(2);
        const blockedKm = (blockedMeters / 1000).toFixed(2);
        const pendingKm = ((totalMeters - completedMeters - partialMeters - blockedMeters) / 1000).toFixed(2);
        const percent = totalMeters > 0 ? Math.round((completedMeters / totalMeters) * 100) : 0;

        // --- DISEÑO DE PÁGINA ---
        let currentY = 15;

        // Cabecera Principal
        doc.setFillColor(15, 23, 42); // Slate 900
        doc.rect(0, 0, 210, 38, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(18);
        doc.text("INFORME DE AVANCE DE DESBROCE", 14, 16);

        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(203, 213, 225);
        doc.text(`Proyecto: ${baseName}`, 14, 23);
        doc.text(`Generado: ${new Date().toLocaleDateString('es-ES')} - ${new Date().toLocaleTimeString('es-ES')}`, 14, 28);
        doc.text(`DesbroceApp v${APP_VERSION}`, 14, 33);

        // Logo tractor emoji simulado en la esquina superior derecha
        doc.setFontSize(22);
        doc.text("🚜", 175, 24);

        currentY = 46;

        // Sección 1: Resumen General (Tarjetas de KPI)
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text("1. RESUMEN EJECUTIVO", 14, currentY);
        currentY += 6;

        // Dibujar cajas de KPIs
        const drawKPI = (x, y, w, h, title, val, color) => {
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226, 232, 240);
            doc.roundedRect(x, y, w, h, 2, 2, 'FD');
            
            doc.setFillColor(color[0], color[1], color[2]);
            doc.rect(x + 1, y + 1, 2, h - 2, 'F');

            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(100, 116, 139);
            doc.text(title, x + 6, y + 6);

            doc.setFont('Helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(15, 23, 42);
            doc.text(val, x + 6, y + 13);
        };

        drawKPI(14, currentY, 34, 18, "TOTAL OBRA", `${totalKm} km`, [100, 116, 139]);
        drawKPI(52, currentY, 34, 18, "DESBROZADO", `${completedKm} km`, [16, 185, 129]);
        drawKPI(90, currentY, 34, 18, "PARCIAL", `${partialKm} km`, [245, 158, 11]);
        drawKPI(128, currentY, 34, 18, "BLOQUEADO", `${blockedKm} km`, [239, 68, 68]);
        drawKPI(166, currentY, 30, 18, "PROGRESO", `${percent}%`, [59, 130, 246]);

        currentY += 25;

        // Sección 2: Desglose por Semana
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text("2. RENDIMIENTO POR SEMANAS DE TRABAJO", 14, currentY);
        currentY += 4;

        const weeksRows = [];
        const sortedWeeks = Object.keys(semanasStats).sort();
        sortedWeeks.forEach(sem => {
            const stat = semanasStats[sem];
            const km = (stat.length / 1000).toFixed(2);
            const percentSem = totalMeters > 0 ? ((stat.length / totalMeters) * 100).toFixed(1) : "0.0";
            weeksRows.push([
                sem,
                `${km} km`,
                `${percentSem}%`,
                getColorNameSpanish(stat.color)
            ]);
        });

        if (weeksRows.length === 0) {
            weeksRows.push(["Sin avances registrados", "-", "-", "-"]);
        }

        doc.autoTable({
            startY: currentY,
            head: [['Semana / Grupo', 'Kilómetros Realizados', '% sobre el total', 'Color asignado']],
            body: weeksRows,
            theme: 'striped',
            headStyles: { fillColor: [59, 130, 246] }, // Azul principal
            margin: { left: 14, right: 14 },
            styles: { fontSize: 8.5 }
        });

        currentY = doc.lastAutoTable.finalY + 10;

        // Sección 3: Detalle por carreteras
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text("3. ESTADO DETALLADO DE CARRETERAS", 14, currentY);
        currentY += 4;

        const tramosRows = [];
        state.routeOrder.forEach((tramoId, index) => {
            const tramo = state.tramos.find(t => t.id === tramoId);
            if (!tramo) return;

            const isBlocked = isTramoFullyBlocked(tramo);
            let estado = "Pendiente";
            if (isBlocked) estado = "Bloqueado";
            else if (tramo.status === 'completed') estado = "Desbrozado";
            else if (tramo.status === 'partial') estado = "Parcial";

            tramosRows.push([
                index + 1,
                tramo.name || "Sin nombre",
                `${(tramo.length / 1000).toFixed(2)} km`,
                estado,
                tramo.leftMarginStatus === 'completed' ? 'Completado' : 'Pendiente',
                tramo.rightMarginStatus === 'completed' ? 'Completado' : 'Pendiente',
                tramo.weekCompleted || '-'
            ]);
        });

        doc.autoTable({
            startY: currentY,
            head: [['Orden', 'Nombre de Tramo/Carretera', 'Longitud', 'Estado', 'Margen Izq.', 'Margen Der.', 'Semana']],
            body: tramosRows,
            theme: 'striped',
            headStyles: { fillColor: [15, 23, 42] },
            margin: { left: 14, right: 14 },
            styles: { fontSize: 8 }
        });

        currentY = doc.lastAutoTable.finalY + 10;

        // Sección 4: Alertas e Incidencias en Campo (Si existen)
        if (allAlerts.length > 0) {
            // Comprobar si cabe en la página o añadimos nueva
            if (currentY > 230) {
                doc.addPage();
                currentY = 20;
            }

            doc.setFont('Helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(15, 23, 42);
            doc.text(`4. INCIDENCIAS Y ALERTAS REGISTRADAS (${allAlerts.length})`, 14, currentY);
            currentY += 4;

            const alertRows = [];
            allAlerts.forEach(obs => {
                alertRows.push([
                    obs.label || "Alerta",
                    obs.tramoName || "Desconocido",
                    obs.comment || "Sin comentarios",
                    new Date(obs.date).toLocaleDateString('es-ES') + " " + new Date(obs.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
                    obs.isBlockSplit ? "Sí (Corta paso)" : "No"
                ]);
            });

            doc.autoTable({
                startY: currentY,
                head: [['Incidencia', 'Carretera / Ubicación', 'Observación / Comentario', 'Fecha Registro', 'Corte de Vía']],
                body: alertRows,
                theme: 'striped',
                headStyles: { fillColor: [220, 38, 38] }, // Rojo Alerta
                margin: { left: 14, right: 14 },
                styles: { fontSize: 8 }
            });
        }

        // Descargar PDF
        doc.save(`${baseName}_informe_avance.pdf`);
        appAlert("Informe PDF generado y descargado con éxito.", "success");

    } catch (err) {
        console.error("Error al exportar PDF:", err);
        appAlert("Error al generar PDF: " + err.message, "error");
    }
}

// Asegurar que routeOrder tenga los tramos pendientes al principio y los desbrozados al final
function stabilizeRouteOrder() {
    try {
        let existingOrder = state.routeOrder.filter(id => state.tramos.some(t => t.id === id));
        
        const pendingIds = [];
        const completedIds = [];
        
        existingOrder.forEach(id => {
            const tramo = state.tramos.find(t => t.id === id);
            if (tramo) {
                if (tramo.status === 'completed') {
                    completedIds.push(id);
                } else {
                    pendingIds.push(id);
                }
            }
        });
        
        // Incluir cualquier tramo que no esté en routeOrder (por carga reciente)
        state.tramos.forEach(t => {
            if (!existingOrder.includes(t.id)) {
                if (t.status === 'completed') {
                    completedIds.push(t.id);
                } else {
                    pendingIds.push(t.id);
                }
            }
        });

        state.routeOrder = [...pendingIds, ...completedIds];
    } catch (e) {
        console.error("Error en stabilizeRouteOrder:", e);
    }
}

let saveToLocalStorageTimeout = null;

function saveToLocalStorage() {
    if (saveToLocalStorageTimeout) {
        clearTimeout(saveToLocalStorageTimeout);
    }
    
    saveToLocalStorageTimeout = setTimeout(() => {
        try {
            stabilizeRouteOrder();
            const localData = {
                loadedFiles: state.loadedFiles,
                fileLoaded: state.fileLoaded,
                // Guardamos todo salvo las capas del mapa (que tienen referencias circulares)
                tramos: state.tramos.map(t => {
                    const { mapLayer, clickTarget, latLngsCache, totalLength, accumLengths, ...rest } = t;
                    return rest;
                }),
                routeOrder: state.routeOrder,
                currentBaseLayer: currentBaseLayer,
                customColors: state.customColors
            };
            localStorage.setItem('desbroce_app_state', JSON.stringify(localData));
            console.log('Avance y progreso persistidos con éxito de forma optimizada.');
        } catch (e) {
            console.error('Error guardando en LocalStorage:', e);
        }
        saveToLocalStorageTimeout = null;
    }, 300); // Retardo de 300 ms para agrupar múltiples llamadas seguidas
}

function loadFromLocalStorage() {
    try {
        const rawData = localStorage.getItem('desbroce_app_state');
        if (!rawData) return;

        const data = JSON.parse(rawData);
        state.loadedFiles = data.loadedFiles || [];
        state.fileLoaded = data.fileLoaded || false;
        state.tramos = data.tramos || [];
        state.routeOrder = data.routeOrder || [];
        state.customColors = data.customColors || {};

        // Reconstruir originalCoordinates y campos de márgenes para compatibilidad
        state.tramos.forEach(t => {
            // Eliminar claves de caché serializadas de forma incorrecta como JSON plano
            delete t.latLngsCache;
            delete t.totalLength;
            delete t.accumLengths;

            t.observaciones = t.observaciones || [];

            if (!t.originalCoordinates) {
                t.originalCoordinates = t.coordinates.map(c => [...c]);
            }
            if (t.rightMarginStatus === undefined) {
                t.rightMarginStatus = t.status === 'completed' ? 'completed' : 'pending';
                t.rightMarginDate = t.status === 'completed' ? t.dateCompleted : null;
            }
            if (t.leftMarginStatus === undefined) {
                t.leftMarginStatus = t.status === 'completed' ? 'completed' : 'pending';
                t.leftMarginDate = t.status === 'completed' ? t.dateCompleted : null;
            }
        });

        // Cargar capa del mapa guardada
        if (data.currentBaseLayer && data.currentBaseLayer !== currentBaseLayer) {
            currentBaseLayer = data.currentBaseLayer;
            const btn = document.getElementById('mapLayerToggle');
            if (currentBaseLayer === 'satellite') {
                if (darkTileLayer) map.removeLayer(darkTileLayer);
                if (satelliteTileLayer) satelliteTileLayer.addTo(map);
                if (btn) btn.classList.add('active');
            }
        }

        // Migración de datos heredados (versión anterior mono-archivo)
        if (data.fileName && (!data.loadedFiles || data.loadedFiles.length === 0) && state.tramos.length > 0) {
            const legacyFileId = 'file_legacy_' + Date.now();
            state.loadedFiles = [{
                id: legacyFileId,
                name: data.fileName,
                tramosCount: state.tramos.length
            }];
            state.tramos.forEach(t => {
                if (!t.fileId) {
                    t.fileId = legacyFileId;
                }
            });
        }

        if (state.fileLoaded && state.tramos.length > 0) {
            stabilizeRouteOrder();
            renderTramosOnMap();
            adjustDefaultFilter();
            updateUI();
            fitMapToBounds();
        }
    } catch (e) {
        console.error('Error cargando de LocalStorage:', e);
        appAlert('Error restaurando estado guardado: ' + e.message, 'error');
    }
}

async function clearAllData() {
    const confirmado = await appConfirm('¿Estás seguro de que quieres borrar todos los datos? Esto eliminará las carreteras cargadas y el progreso guardado.', 'Borrar Todos los Datos', true);
    if (confirmado) {
        localStorage.removeItem('desbroce_app_state');
        state.fileLoaded = false;
        state.loadedFiles = [];
        state.tramos = [];
        state.routeOrder = [];
        state.selectedTramoId = null;
        
        tramosLayerGroup.clearLayers();

        // Restablecer mapa a vista general
        map.setView([40.416775, -3.703790], 6);

        document.getElementById('fileInput').value = '';
        
        updateUI();
        appAlert('Datos borrados correctamente.', 'success');
    }
}

// --- GEOMETRÍA Y MODO TRABAJO ACTIVO ---

// Proyectar un punto GPS sobre una polilínea
function projectLatLngToPolyline(lat, lng, coordinates, tramo = null) {
    let minD = Infinity;
    let closestPoint = null;
    let bestTraversed = 0;
    let totalLength = 0;
    let accumLengths = null;

    if (tramo) {
        if (tramo.totalLength !== undefined && tramo.accumLengths) {
            totalLength = tramo.totalLength;
            accumLengths = tramo.accumLengths;
        }
    }

    if (!accumLengths) {
        accumLengths = [0];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const p1 = L.latLng(coordinates[i][0], coordinates[i][1]);
            const p2 = L.latLng(coordinates[i+1][0], coordinates[i+1][1]);
            const d = p1.distanceTo(p2);
            totalLength += d;
            accumLengths.push(totalLength);
        }
        if (tramo) {
            tramo.totalLength = totalLength;
            tramo.accumLengths = accumLengths;
        }
    }

    // Cachear objetos L.latLng de la polilínea del tramo para evitar recrearlos en bucle
    let latLngs = null;
    if (tramo) {
        if (!tramo.latLngsCache) {
            tramo.latLngsCache = coordinates.map(c => L.latLng(c[0], c[1]));
        }
        latLngs = tramo.latLngsCache;
    } else {
        latLngs = coordinates.map(c => L.latLng(c[0], c[1]));
    }
    
    const perfStart = performance.now();
    const p = L.latLng(lat, lng);
    let bestIdx = -1;
    let bestProjPoint = null;
    let minApproxDistSq = Infinity;
    
    // Bucle ultrarrápido con matemáticas 2D Euclidianas cartesianas aproximadas en grados (sin trigonométricas)
    for (let i = 0; i < latLngs.length - 1; i++) {
        const a = latLngs[i];
        const b = latLngs[i+1];
        
        const proj = getClosestPointOnSegmentCartesian(p, a, b);
        
        const dLat = p.lat - proj.point.lat;
        const dLng = p.lng - proj.point.lng;
        const approxDistSq = dLat * dLat + dLng * dLng;
        
        if (approxDistSq < minApproxDistSq) {
            minApproxDistSq = approxDistSq;
            bestIdx = i;
            bestProjPoint = proj.point;
        }
    }
    
    // Solo para el segmento ganador calculamos la distancia real esférica (Haversine) en metros
    if (bestIdx !== -1) {
        minD = p.distanceTo(bestProjPoint);
        const a = latLngs[bestIdx];
        const realOffset = a.distanceTo(bestProjPoint);
        bestTraversed = accumLengths[bestIdx] + realOffset;
        closestPoint = bestProjPoint;
    }
    
    const perfElapsed = performance.now() - perfStart;
    const perfCpuEl = document.getElementById('perfCpuTime');
    if (perfCpuEl) {
        perfCpuEl.innerText = `${perfElapsed.toFixed(3)} ms`;
    }
    
    return {
        point: closestPoint,
        distance: minD, // Distancia del GPS a la carretera
        distanceTraversed: bestTraversed,
        totalLength: totalLength,
        fraction: totalLength > 0 ? bestTraversed / totalLength : 0
    };
}

// Auxiliar optimizado: Proyectar cartesianamente en un plano 2D aproximado (grados lat/lng)
function getClosestPointOnSegmentCartesian(p, a, b) {
    const ab = [b.lat - a.lat, b.lng - a.lng];
    const ap = [p.lat - a.lat, p.lng - a.lng];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1];
    
    if (abLenSq === 0) return { point: a, t: 0 };
    
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / abLenSq;
    t = Math.max(0, Math.min(1, t)); // Limitar al segmento
    
    const projPoint = L.latLng(
        a.lat + t * ab[0],
        a.lng + t * ab[1]
    );
    
    return { point: projPoint, t: t };
}

// Iniciar el modo de trabajo activo para un tramo
async function startActiveWorkMode(tramoId, skipDistanceCheck = false) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        // Forzar activación del GPS si estuviera apagado
        if (!state.gpsActive) {
            toggleGPS();
        }

        // Si no omitimos el control de distancia
        if (!skipDistanceCheck) {
            let loc = state.userLocation;
            
            // Si no tenemos ubicación de GPS todavía (porque se acaba de encender), esperamos el primer fix
            if (!loc) {
                try {
                    loc = await waitForGpsFix(5000); // Esperar hasta 5 segundos la primera señal
                } catch (err) {
                    // Si da timeout (no hay satélites o estamos en interiores), preguntar si iniciar forzadamente
                    const forceStart = await appConfirm(
                        "No se recibe señal GPS. ¿Deseas comenzar el desbroce de todos modos sin guiado en tiempo real?",
                        "Esperando GPS..."
                    );
                    if (!forceStart) return; // Cancelar inicio si dice que no
                }
            }

            // Si finalmente tenemos ubicación, verificar la distancia
            if (loc) {
                const proj = projectLatLngToPolyline(loc.lat, loc.lng, tramo.coordinates, tramo);
                if (proj.distance > 50) {
                    const startPt = tramo.coordinates[0];
                    const action = await appGpsDistanceDialog(proj.distance, startPt);
                    
                    if (action === 'cancel') {
                        return; // Cancelar inicio
                    } else if (action === 'maps') {
                        // Abrir Google Maps en pestaña nueva para navegar al inicio del tramo
                        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${startPt[0]},${startPt[1]}`;
                        window.open(mapsUrl, '_blank');
                        return;
                    }
                    // Si es 'confirm', continúa normalmente
                }
            }
        }

        // Ocultar popup de Leaflet y cerrar la tarjeta Bottom Sheet de detalles del tramo
        map.closePopup();
        closeRoadDetail();

        // Centrar la cámara en el GPS o en el punto de inicio del tramo de forma inmediata
        if (state.userLocation) {
            map.setView(state.userLocation, 17);
        } else if (tramo.coordinates && tramo.coordinates.length > 0) {
            map.setView(tramo.coordinates[0], 17);
        }

        // Inicializar estado del trabajo activo
        state.activeWork = {
            tramoId: tramoId,
            margin: tramo.rightMarginStatus === 'pending' ? 'right' : 'left', // Pre-seleccionar el pendiente
            direction: null, // Se calculará en el primer fix GPS
            startLatLng: null,
            maxFraction: 0,
            startTime: Date.now()
        };

        // Actualizar banner HTML
        document.getElementById('activeWorkTramoName').innerText = tramo.name;
        document.getElementById('activeWorkSpeed').innerText = '0.0 km/h';
        document.getElementById('activeWorkProgressText').innerText = 'Progreso: 0%';
        document.getElementById('activeWorkProgressDistance').innerText = `Quedan: ${(tramo.length).toFixed(0)} m`;
        document.getElementById('activeWorkProgressBar').style.width = '0%';

        // Activar botones de márgenes
        updateMarginButtonsUI();

        // Mostrar Banner de Trabajo
        document.getElementById('activeWorkBanner').style.display = 'flex';
        document.getElementById('nearbySuggestionBanner').style.display = 'none';

        logDebug(`Modo de Trabajo Activo iniciado para '${tramo.name}'.`);
    } catch (e) {
        console.error("Error en startActiveWorkMode:", e);
        logDebug("Fallo al iniciar Modo Trabajo: " + e.message, 'error');
    }
}

// Actualizar el estado visual de los botones de margen
function updateMarginButtonsUI() {
    const tramo = state.tramos.find(t => t.id === state.activeWork.tramoId);
    if (!tramo) return;

    const btnRight = document.getElementById('btnMarginRight');
    const btnLeft = document.getElementById('btnMarginLeft');

    btnRight.classList.remove('active');
    btnLeft.classList.remove('active');

    // Colorear el botón según el margen activo
    if (state.activeWork.margin === 'right') {
        btnRight.classList.add('active');
    } else {
        btnLeft.classList.add('active');
    }

    // Actualizar leyendas de Finalizado/Pendiente
    btnRight.innerText = `Der: ${tramo.rightMarginStatus === 'completed' ? 'Finalizado' : 'Pendiente'}`;
    btnLeft.innerText = `Izq: ${tramo.leftMarginStatus === 'completed' ? 'Finalizado' : 'Pendiente'}`;
}

// Cambiar de margen durante el trabajo activo
function setActiveWorkMargin(marginSide) {
    if (state.activeWork.tramoId) {
        state.activeWork.margin = marginSide;
        state.activeWork.startLatLng = null; // Reiniciar dirección para recalcular en nueva pasada
        state.activeWork.direction = null;
        state.activeWork.maxFraction = 0;
        updateMarginButtonsUI();
        logDebug(`Cambiado margen de trabajo a: ${marginSide === 'right' ? 'Derecho' : 'Izquierdo'}`);
    }
}

// Cancelar el modo de trabajo activo
function cancelActiveWork() {
    state.activeWork = {
        tramoId: null,
        margin: 'right',
        direction: null,
        startLatLng: null,
        maxFraction: 0,
        startTime: null
    };
    document.getElementById('activeWorkBanner').style.display = 'none';
    logDebug("Modo de Trabajo Activo cancelado.");
}

// Finalizar la pasada actual (completar el margen)
async function completeActiveWorkPass() {
    try {
        const tramoId = state.activeWork.tramoId;
        const margin = state.activeWork.margin;
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];

        // Guardar el estado del margen
        if (margin === 'right') {
            tramo.rightMarginStatus = 'completed';
            tramo.rightMarginDate = dateStr;
        } else {
            tramo.leftMarginStatus = 'completed';
            tramo.leftMarginDate = dateStr;
        }

        // Recalcular estado del tramo
        let tramoFinished = false;
        if (tramo.rightMarginStatus === 'completed' && tramo.leftMarginStatus === 'completed') {
            tramo.status = 'completed';
            tramo.dateCompleted = dateStr;
            const { week, year } = getISOWeekAndYear(today);
            tramo.weekCompleted = `W${week}-${year}`;
            tramo.color = getWeekColor(tramo.weekCompleted);
            tramoFinished = true;
            logDebug(`Carretera '${tramo.name}' completamente desbrozada.`);
        } else {
            tramo.status = 'partial';
            tramo.dateCompleted = dateStr;
            const { week, year } = getISOWeekAndYear(today);
            tramo.weekCompleted = `W${week}-${year}`;
            tramo.color = getWeekColor(tramo.weekCompleted);
            logDebug(`Margen ${margin === 'right' ? 'Derecho' : 'Izquierdo'} completado en '${tramo.name}'.`);
        }

        saveToLocalStorage();
        renderTramosOnMap();
        updateUI();

        // Desactivar el modo trabajo activo
        cancelActiveWork();

        // Ofrecer sugerencia interactiva al finalizar
        if (tramoFinished) {
            await appAlert(`¡Buen trabajo! Has completado el desbroce del tramo "${tramo.name}".`, 'success');
        } else {
            // Preguntar si quiere iniciar el margen contrario de inmediato
            const oppositeMargin = margin === 'right' ? 'Izquierdo' : 'Derecho';
            const goBack = await appConfirm(`Pasada finalizada. ¿Deseas iniciar la pasada de vuelta para desbrozar el Margen ${oppositeMargin}?`, 'Siguiente Pasada');
            if (goBack) {
                startActiveWorkMode(tramoId, true);
                setActiveWorkMargin(margin === 'right' ? 'left' : 'right');
            }
        }
    } catch (e) {
        console.error("Error al finalizar pasada:", e);
    }
}

// Actualizar en tiempo real el progreso de la pasada basado en el GPS
function updateActiveWorkProgress(latlng, gpsSpeed) {
    try {
        const tramo = state.tramos.find(t => t.id === state.activeWork.tramoId);
        if (!tramo) return;

        const proj = projectLatLngToPolyline(latlng.lat, latlng.lng, tramo.coordinates, tramo);

        // Si el tractor está a más de 35 metros de la carretera, ignorar o avisar (podría estar fuera del tramo)
        if (proj.distance > 35) {
            document.getElementById('activeWorkSpeed').innerText = 'Fuera de tramo';
            return;
        }

        // Estimar la velocidad en km/h
        let speedKmH = 0;
        if (gpsSpeed !== undefined && gpsSpeed !== null) {
            speedKmH = Math.max(0, gpsSpeed * 3.6);
        } else {
            // Calcular velocidad aproximada comparando con la última posición
            if (state.activeWork.lastLatLng) {
                const dist = state.activeWork.lastLatLng.distanceTo(latlng);
                const elapsedSeconds = (Date.now() - state.activeWork.lastTime) / 1000;
                if (elapsedSeconds > 0) {
                    speedKmH = Math.max(0, (dist / elapsedSeconds) * 3.6);
                }
            }
        }
        state.activeWork.lastLatLng = latlng;
        state.activeWork.lastTime = Date.now();

        // Determinar sentido del recorrido (forward/backward) en el primer fix
        if (!state.activeWork.direction) {
            state.activeWork.startLatLng = latlng;
            // Si la proyección está cerca del inicio de la polilínea, va en sentido forward (0 a 1)
            // Si está cerca del final, va en sentido backward (1 a 0)
            state.activeWork.direction = proj.fraction < 0.5 ? 'forward' : 'backward';
        }

        // Calcular fracción de avance
        let progressFraction = 0;
        if (state.activeWork.direction === 'forward') {
            progressFraction = proj.fraction;
        } else {
            progressFraction = 1 - proj.fraction;
        }

        // Guardar la máxima fracción alcanzada para que el progreso nunca retroceda visualmente
        if (progressFraction > state.activeWork.maxFraction) {
            state.activeWork.maxFraction = progressFraction;
        }

        const progressPercent = Math.min(100, Math.max(0, Math.round(state.activeWork.maxFraction * 100)));
        const distanceRemaining = Math.max(0, proj.totalLength * (1 - state.activeWork.maxFraction));

        // Actualizar interfaz
        document.getElementById('activeWorkSpeed').innerText = `${speedKmH.toFixed(1)} km/h`;
        document.getElementById('activeWorkProgressText').innerText = `Progreso: ${progressPercent}%`;
        document.getElementById('activeWorkProgressDistance').innerText = `Quedan: ${distanceRemaining.toFixed(0)} m`;
        document.getElementById('activeWorkProgressBar').style.width = `${progressPercent}%`;

        // Si el progreso es superior al 96% y quedan menos de 10 metros, autocompletado inteligente!
        if (progressPercent >= 96 && distanceRemaining < 10) {
            logDebug(`Autocompletado inteligente detectado para el margen ${state.activeWork.margin} de '${tramo.name}'.`);
            completeActiveWorkPass();
        }
    } catch (e) {
        console.error("Error al actualizar progreso activo:", e);
    }
}

// Calcular límites de coordenadas de un tramo para descarte rápido por Bounding Box
function calculateTramoBounds(tramo) {
    if (tramo.bounds) return;
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (let i = 0; i < tramo.coordinates.length; i++) {
        const coord = tramo.coordinates[i];
        const lat = coord[0];
        const lng = coord[1];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    tramo.bounds = { minLat, maxLat, minLng, maxLng };
}

// Variables para control de sugerencias y throttling de CPU
let dismissedSuggestionTramoId = null;
let dismissedSuggestionTime = 0;
let lastSuggestionCheckTime = 0;
let lastSuggestionCheckLatLng = null;

// Buscar tramos pendientes cercanos para sugerir su inicio
function suggestNearbyTramo(latlng) {
    try {
        // No sugerir nada si hay un trabajo activo, si no hay datos o si se descartó hace poco
        if (state.activeWork.tramoId || state.tramos.length === 0) return;
        if (dismissedSuggestionTramoId && (Date.now() - dismissedSuggestionTime) < 60000) return; // 1 minuto de cooldown

        // Throttling: ejecutar máximo cada 3 segundos y si el usuario se ha desplazado más de 5 metros
        const now = Date.now();
        if (lastSuggestionCheckLatLng && (now - lastSuggestionCheckTime) < 3000) {
            const dist = lastSuggestionCheckLatLng.distanceTo(latlng);
            if (dist < 5) return; // Omitir si se movió muy poco en ese lapso
        }
        
        lastSuggestionCheckTime = now;
        lastSuggestionCheckLatLng = latlng;

        let closestTramo = null;
        let minD = Infinity;

        const lat = latlng.lat;
        const lng = latlng.lng;
        // Margen de bounding box: ~0.002 grados (unos 220 metros de margen)
        const margin = 0.002;

        // Buscar el tramo pendiente o parcial más cercano
        state.tramos.forEach(t => {
            if (t.status !== 'completed') {
                if (!t.bounds) {
                    calculateTramoBounds(t);
                }

                // Filtro rápido de Bounding Box (descarte en nanosegundos)
                if (lat >= t.bounds.minLat - margin && lat <= t.bounds.maxLat + margin &&
                    lng >= t.bounds.minLng - margin && lng <= t.bounds.maxLng + margin) {
                    
                    const proj = projectLatLngToPolyline(lat, lng, t.coordinates, t);
                    if (proj.distance < minD) {
                        minD = proj.distance;
                        closestTramo = t;
                    }
                }
            }
        });

        // Si hay un tramo a menos de 20 metros de distancia
        if (closestTramo && minD < 20) {
            document.getElementById('nearbyTramoName').innerText = `${closestTramo.name} (${(closestTramo.length / 1000).toFixed(2)} km)`;
            state.suggestedTramoId = closestTramo.id;
            document.getElementById('nearbySuggestionBanner').style.display = 'flex';
        } else {
            document.getElementById('nearbySuggestionBanner').style.display = 'none';
        }
    } catch (e) {
        console.error("Error en suggestNearbyTramo:", e);
    }
}

// Comenzar desbroce desde el banner de sugerencias
function startSuggestedWork() {
    if (state.suggestedTramoId) {
        startActiveWorkMode(state.suggestedTramoId);
        state.suggestedTramoId = null;
    }
}

// Descartar sugerencia
function dismissNearbySuggestion() {
    if (state.suggestedTramoId) {
        dismissedSuggestionTramoId = state.suggestedTramoId;
        dismissedSuggestionTime = Date.now();
        document.getElementById('nearbySuggestionBanner').style.display = 'none';
        state.suggestedTramoId = null;
    }
}

// --- DIÁLOGOS PERSONALIZADOS REUTILIZABLES (PROMISIONADOS) ---

// Alertas personalizadas (Success, Error, Warning, Info)
function appAlert(message, type = 'info') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'custom-dialog-overlay';
        
        let icon = 'info', color = '#3b82f6', title = 'Información';
        if (type === 'success') { icon = 'check-circle'; color = '#10b981'; title = 'Éxito'; }
        else if (type === 'error') { icon = 'alert-triangle'; color = '#ef4444'; title = 'Error'; }
        else if (type === 'warning') { icon = 'alert-circle'; color = '#f59e0b'; title = 'Atención'; }
        
        modal.innerHTML = `
            <div class="custom-dialog-card animate-scale-up">
                <div class="dialog-icon-container" style="color: ${color};">
                    <i data-lucide="${icon}"></i>
                </div>
                <div class="dialog-content">
                    <h3 class="dialog-title" style="margin: 0 0 6px 0; font-family: 'Outfit', sans-serif;">${title}</h3>
                    <p class="dialog-message" style="margin: 0; font-family: 'Outfit', sans-serif;">${message}</p>
                </div>
                <div class="dialog-actions">
                    <button class="btn btn-primary btn-dialog-ok" style="font-family: 'Outfit', sans-serif;">Entendido</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        if (window.refreshLucideIcons) refreshLucideIcons();
        
        modal.querySelector('.btn-dialog-ok').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve();
            }, 200);
        };
    });
}

// Confirmaciones personalizadas (Sí/No)
function appConfirm(message, title = '¿Estás seguro?', isDanger = false) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'custom-dialog-overlay';
        
        const iconColor = isDanger ? 'var(--danger)' : '#f59e0b';
        const iconName = isDanger ? 'trash-2' : 'help-circle';
        const btnBgColor = isDanger ? 'var(--danger)' : 'var(--warning)';
        
        modal.innerHTML = `
            <div class="custom-dialog-card animate-scale-up">
                <div class="dialog-icon-container" style="color: ${iconColor};">
                    <i data-lucide="${iconName}"></i>
                </div>
                <div class="dialog-content">
                    <h3 class="dialog-title" style="margin: 0 0 6px 0; font-family: 'Outfit', sans-serif;">${title}</h3>
                    <p class="dialog-message" style="margin: 0; font-family: 'Outfit', sans-serif;">${message}</p>
                </div>
                <div class="dialog-actions" style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-dialog-cancel" style="flex: 1; font-family: 'Outfit', sans-serif;">Cancelar</button>
                    <button class="btn btn-primary btn-dialog-confirm" style="flex: 1; background-color: ${btnBgColor}; border-color: ${btnBgColor}; font-family: 'Outfit', sans-serif;">Confirmar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        if (window.refreshLucideIcons) refreshLucideIcons();
        
        modal.querySelector('.btn-dialog-confirm').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve(true);
            }, 200);
        };
        
        modal.querySelector('.btn-dialog-cancel').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve(false);
            }, 200);
        };
    });
}

// Diálogo de advertencia de distancia GPS con opción de Google Maps
function appGpsDistanceDialog(distanceMeters, startLatLng) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'custom-dialog-overlay';
        
        modal.innerHTML = `
            <div class="custom-dialog-card animate-scale-up" style="max-width: 380px;">
                <div class="dialog-icon-container" style="color: var(--warning); margin-bottom: 12px;">
                    <i data-lucide="navigation"></i>
                </div>
                <div class="dialog-content" style="text-align: center; margin-bottom: 16px;">
                    <h3 class="dialog-title" style="margin: 0 0 8px 0; font-family: 'Outfit', sans-serif; font-size: 1.1rem; color: #fecaca;">Estás lejos de la carretera</h3>
                    <p class="dialog-message" style="margin: 0; font-family: 'Outfit', sans-serif; font-size: 0.85rem; line-height: 1.5; color: #cbd5e1;">
                        Tu GPS se encuentra a <strong>${Math.round(distanceMeters)} metros</strong> de la carretera seleccionada. ¿Qué deseas hacer?
                    </p>
                </div>
                <div class="dialog-actions" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
                    <button class="btn btn-primary btn-dialog-maps" style="width: 100%; background-color: #3b82f6; border-color: #3b82f6; font-family: 'Outfit', sans-serif; font-weight: 600; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; color: white;">
                        <i data-lucide="map" style="width: 16px; height: 16px;"></i> Ir con Google Maps
                    </button>
                    <button class="btn btn-secondary btn-dialog-confirm" style="width: 100%; background-color: #f59e0b; border-color: #f59e0b; color: white; font-family: 'Outfit', sans-serif; font-weight: 600; padding: 10px; cursor: pointer;">
                        Comenzar de todos modos
                    </button>
                    <button class="btn btn-secondary btn-dialog-cancel" style="width: 100%; font-family: 'Outfit', sans-serif; padding: 10px; cursor: pointer;">
                        Cancelar
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        if (window.refreshLucideIcons) refreshLucideIcons();
        
        modal.querySelector('.btn-dialog-maps').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve('maps');
            }, 200);
        };
        
        modal.querySelector('.btn-dialog-confirm').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve('confirm');
            }, 200);
        };
        
        modal.querySelector('.btn-dialog-cancel').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve('cancel');
            }, 200);
        };
    });
}

// Prompts personalizados (Entrada de texto)
function appPrompt(message, defaultValue = '', title = 'Introducir Datos') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'custom-dialog-overlay';
        
        modal.innerHTML = `
            <div class="custom-dialog-card animate-scale-up" style="max-width: 320px;">
                <div class="dialog-icon-container" style="color: var(--accent);">
                    <i data-lucide="calendar"></i>
                </div>
                <div class="dialog-content" style="width: 100%;">
                    <h3 class="dialog-title" style="margin: 0 0 6px 0; font-family: 'Outfit', sans-serif;">${title}</h3>
                    <p class="dialog-message" style="margin: 0 0 12px 0; font-family: 'Outfit', sans-serif; font-size: 0.8rem; color: var(--text-secondary);">${message}</p>
                    <input type="text" id="dialogPromptInput" value="${defaultValue}" style="width: 100%; padding: 0.5rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; color: #fff; font-family: 'Outfit', sans-serif; font-size: 0.85rem; box-sizing: border-box; text-align: center;">
                </div>
                <div class="dialog-actions" style="width: 100%; display: flex; gap: 8px; margin-top: 12px;">
                    <button class="btn btn-secondary btn-dialog-cancel" style="flex: 1; font-family: 'Outfit', sans-serif;">Cancelar</button>
                    <button class="btn btn-primary btn-dialog-confirm" style="flex: 1; font-family: 'Outfit', sans-serif;">Aceptar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        if (window.refreshLucideIcons) refreshLucideIcons();
        
        const input = modal.querySelector('#dialogPromptInput');
        if (input) {
            input.focus();
            input.select();
        }
        
        modal.querySelector('.btn-dialog-confirm').onclick = () => {
            const val = input ? input.value : '';
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve(val);
            }, 200);
        };
        
        modal.querySelector('.btn-dialog-cancel').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve(null);
            }, 200);
        };
    });
}

// --- PROMPT DE INSTALACIÓN PWA ---
let deferredPrompt;

// Escuchar el evento de instalación nativo (Chrome/Android/PC)
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Evitar banner del navegador por defecto
    deferredPrompt = e;

    // Si el usuario ya lo descartó en esta sesión, no molestamos de nuevo
    if (sessionStorage.getItem('pwa-prompt-dismissed') === 'true') {
        return;
    }

    // Mostrar el banner con una transición suave
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) {
        banner.style.display = 'flex';
        setTimeout(() => {
            banner.classList.add('show');
        }, 100);
    }
});

// Manejo de eventos de click del Banner de Instalación
document.addEventListener('DOMContentLoaded', () => {
    const btnInstall = document.getElementById('btnPwaInstall');
    const btnClose = document.getElementById('btnPwaClose');
    const banner = document.getElementById('pwaInstallBanner');

    if (btnInstall) {
        btnInstall.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            logDebug(`Instalación PWA resultado: ${outcome}`);
            deferredPrompt = null;
            
            if (banner) {
                banner.classList.remove('show');
                setTimeout(() => {
                    banner.style.display = 'none';
                }, 400);
            }
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            sessionStorage.setItem('pwa-prompt-dismissed', 'true');
            if (banner) {
                banner.classList.remove('show');
                setTimeout(() => {
                    banner.style.display = 'none';
                }, 400);
            }
        });
    }

    // Compatibilidad y asistencia para iOS (Safari)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    if (isIOS && !isStandalone && sessionStorage.getItem('pwa-prompt-dismissed') !== 'true') {
        setTimeout(() => {
            const bannerText = document.querySelector('.pwa-banner-text span');
            const bannerTitle = document.querySelector('.pwa-banner-text strong');
            if (banner && btnInstall && bannerText && bannerTitle) {
                bannerTitle.innerText = "Añadir a Pantalla de Inicio";
                bannerText.innerText = "Pulsa Compartir 📤 y 'Añadir a pantalla de inicio'";
                btnInstall.style.display = 'none'; // No se puede instalar programáticamente en iOS

                banner.style.display = 'flex';
                setTimeout(() => {
                    banner.classList.add('show');
                }, 100);
            }
        }, 1500); // Dar un poco de margen tras cargar la app
    }
});

// Monitor de Rendimiento Temporal para Pruebas
function initPerformanceMonitor() {
    const batteryEl = document.getElementById('perfBattery');
    const ramEl = document.getElementById('perfRam');
    const statusGpsEl = document.getElementById('perfStatusGps');

    if (!batteryEl) return;

    // Actualizar estado del GPS en el monitor
    setInterval(() => {
        if (statusGpsEl) {
            statusGpsEl.innerText = state.gpsActive ? 'GPS: ACTIVO' : 'GPS: Inactivo';
            statusGpsEl.style.color = state.gpsActive ? '#10b981' : '#a1a1aa';
        }
    }, 1000);

    // Batería
    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            function updateBatteryInfo() {
                const level = Math.round(battery.level * 100);
                const charging = battery.charging ? '⚡ Cargando' : '🔋 Descargando';
                batteryEl.innerText = `${level}% (${charging})`;
                batteryEl.style.color = battery.charging ? '#10b981' : (level > 20 ? '#fff' : '#ef4444');
            }
            updateBatteryInfo();
            battery.addEventListener('levelchange', updateBatteryInfo);
            battery.addEventListener('chargingchange', updateBatteryInfo);
        }).catch(err => {
            batteryEl.innerText = 'Error API';
        });
    } else {
        batteryEl.innerText = 'No soportado (iOS)';
    }

    // RAM (Solo Chromium)
    setInterval(() => {
        if (window.performance && window.performance.memory && ramEl) {
            const usedMem = (window.performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
            ramEl.innerText = `${usedMem} MB`;
        } else if (ramEl) {
            ramEl.innerText = 'No soportado';
        }
    }, 2500);
}

// Iniciar el monitor
document.addEventListener('DOMContentLoaded', initPerformanceMonitor);

// --- SISTEMA DE OBSERVACIONES Y PUNTOS DE CONFLICTO (v0.1.5) ---

// Añadir observación en la posición actual del GPS (mientras trabaja)
async function addObservationAtGps() {
    try {
        if (!state.activeWork || !state.activeWork.tramoId) {
            appAlert("No hay ningún tramo activo en desbroce.", "warning");
            return;
        }

        const tramoId = state.activeWork.tramoId;
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        let loc = state.userLocation;
        if (!loc) {
            appAlert("Esperando señal GPS precisa. Inténtalo de nuevo en unos segundos.", "warning");
            return;
        }

        const obsData = await appObservationDialog("Registrar Alerta en GPS");
        if (!obsData) return; // Canceló el diálogo

        if (obsData.action === 'block') {
            // Caso de bloqueo: Dividir tramo y detener
            splitTramoOnObstacle(tramoId, loc, obsData);
        } else {
            // Caso de solo alerta: Añadir y continuar
            const newObs = {
                id: 'obs_' + Date.now(),
                lat: loc.lat,
                lng: loc.lng,
                type: obsData.type,
                label: obsData.label,
                comment: obsData.comment,
                date: Date.now()
            };
            tramo.observaciones = tramo.observaciones || [];
            tramo.observaciones.push(newObs);

            saveToLocalStorage();
            renderTramosOnMap();
            appAlert(`Alerta "${obsData.label}" registrada con éxito en el mapa.`, "success");
        }
    } catch (err) {
        console.error("Error en addObservationAtGps:", err);
    }
}

// Añadir observación tocando un punto en el mapa para un tramo (Modo interactivo con interceptación de clics en carretera)
function addManualObservation(tramoId) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        // Cerrar panel de detalles y popups para interactuar sin molestias
        closeRoadDetail();
        map.closePopup();

        // 1. Mostrar banner de instrucciones arriba (con diseño responsive y botón de Cancelar)
        let obsBanner = document.getElementById('obsManualBanner');
        if (!obsBanner) {
            obsBanner = document.createElement('div');
            obsBanner.id = 'obsManualBanner';
            obsBanner.style.cssText = `
                position: absolute;
                top: 15px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 10000;
                background: rgba(20, 20, 22, 0.98);
                border: 1px solid #f59e0b;
                border-radius: 12px;
                color: #e4e4e7;
                padding: 12px 16px;
                font-family: 'Outfit', sans-serif;
                font-size: 0.82rem;
                font-weight: 600;
                box-shadow: 0 8px 30px rgba(0,0,0,0.6);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                width: 92%;
                max-width: 480px;
                box-sizing: border-box;
                pointer-events: auto;
                transition: all 0.3s ease;
            `;
            document.body.appendChild(obsBanner);
        }
        obsBanner.innerHTML = `
            <span style="flex: 1; line-height: 1.35; text-align: left;">⚠️ Modo de alerta activo. Toca la carretera en el mapa para situar la alerta.</span>
            <button id="cancelObsBtn" style="background: #ef4444; color: white; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; font-weight: bold; flex-shrink: 0; transition: background-color 0.2s;">Cancelar</button>
        `;

        const polyline = tramo.mapLayer;
        if (!polyline) {
            appAlert("No se puede visualizar el tramo en el mapa para situar la alerta.", 'error');
            if (obsBanner) obsBanner.remove();
            openRoadDetail(tramoId);
            return;
        }

        // Activar estado global del modo observación manual
        state.isObsMode = true;
        state.obsTramoId = tramoId;

        // Guardar el estilo original antes de modificarlo para poder restaurarlo si cancela o termina
        const originalStyle = {
            color: polyline.options.color,
            weight: polyline.options.weight,
            opacity: polyline.options.opacity
        };

        // Poner la carretera en un color de advertencia discontinuo llamativo
        polyline.setStyle({
            color: '#f59e0b',
            weight: 8,
            opacity: 1.0,
            dashArray: '5, 10'
        });

        // Cambiar cursor a cruz (crosshair) al pasar sobre la línea y su zona táctil
        if (polyline.getElement()) {
            polyline.getElement().style.cursor = 'crosshair';
        }
        const clickTarget = tramo.clickTarget;
        if (clickTarget && clickTarget.getElement()) {
            clickTarget.getElement().style.cursor = 'crosshair';
        }

        // Limpiador del modo de marcado de alerta
        const cleanupObsManualMode = () => {
            state.isObsMode = false;
            state.obsTramoId = null;
            if (obsBanner) obsBanner.remove();
            if (polyline) {
                polyline.setStyle(originalStyle);
                if (polyline.getElement()) {
                    polyline.getElement().style.cursor = '';
                }
            }
            if (clickTarget && clickTarget.getElement()) {
                clickTarget.getElement().style.cursor = '';
            }
            window.activeObsCleanup = null;
        };

        // Guardar función de limpieza globalmente para acceder desde la resolución de clics
        window.activeObsCleanup = cleanupObsManualMode;

        // Manejador del botón cancelar
        obsBanner.querySelector('#cancelObsBtn').onclick = (e) => {
            e.stopPropagation();
            cleanupObsManualMode();
            openRoadDetail(tramoId);
        };

    } catch (err) {
        console.error("Error en addManualObservation:", err);
    }
}

// Manejar el clic sobre la carretera cuando el modo alerta está activo
async function handleObsManualClick(tramo, latlng) {
    try {
        const tramoId = tramo.id;
        
        // Obtener el punto proyectado exacto sobre la polilínea para situar la alerta con precisión
        const proj = projectLatLngToPolyline(latlng.lat, latlng.lng, tramo.coordinates, tramo);

        // Desactivar el modo de marcado de alerta (banner y estilos) de forma inmediata
        if (typeof window.activeObsCleanup === 'function') {
            window.activeObsCleanup();
        }

        // Abrir formulario rápido de configuración de la alerta
        const obsData = await appObservationDialog("Registrar Alerta en Mapa");
        if (!obsData) {
            openRoadDetail(tramoId);
            return; // Cancelado
        }

        if (obsData.action === 'block') {
            // Caso de bloqueo: Dividir tramo en caliente
            splitTramoOnObstacle(tramoId, proj.point, obsData);
        } else {
            // Caso de solo alerta
            const newObs = {
                id: 'obs_' + Date.now(),
                lat: proj.point.lat,
                lng: proj.point.lng,
                type: obsData.type,
                label: obsData.label,
                comment: obsData.comment,
                date: Date.now()
            };
            tramo.observaciones = tramo.observaciones || [];
            tramo.observaciones.push(newObs);

            saveToLocalStorage();
            renderTramosOnMap();
            appAlert(`Alerta "${obsData.label}" guardada con éxito.`, "success");
            openRoadDetail(tramoId);
        }
    } catch (err) {
        console.error("Error en handleObsManualClick:", err);
    }
}

// Diálogo interactivo táctil para observaciones y conflictos
function appObservationDialog(title = "Registrar Alerta") {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'custom-dialog-overlay';
        
        modal.innerHTML = `
            <div class="custom-dialog-card animate-scale-up" style="max-width: 420px; width: 92%; padding: 1.5rem 1.25rem;">
                <h3 class="dialog-title" style="margin: 0 0 12px 0; font-family: 'Outfit', sans-serif; text-align: center; color: #fff; font-size: 1.1rem;">⚠️ ${title}</h3>
                
                <!-- Tipo de Obstáculo (Opciones rápidas gigantes) -->
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 0.75rem; color: #a1a1aa; margin-bottom: 6px; font-weight: 500;">Tipo de obstáculo / peligro:</label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;" id="obsTypeGrid">
                        <button type="button" class="btn-obs-type active" data-type="vehicles" data-label="Vehículo obstaculizando"
                                style="padding: 10px 4px; font-size: 0.78rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid #f59e0b; background: rgba(245,158,11,0.1); color: #f59e0b; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            🚗 Vehículos
                        </button>
                        <button type="button" class="btn-obs-type" data-type="branches" data-label="Ramas / Cañas bajas"
                                style="padding: 10px 4px; font-size: 0.78rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            🌳 Ramas Bajas
                        </button>
                        <button type="button" class="btn-obs-type" data-type="narrow" data-label="Camino estrecho"
                                style="padding: 10px 4px; font-size: 0.78rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            🚧 Estrecho
                        </button>
                        <button type="button" class="btn-obs-type" data-type="cables" data-label="Cableado bajo"
                                style="padding: 10px 4px; font-size: 0.78rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            ⚡ Cables Bajos
                        </button>
                        <button type="button" class="btn-obs-type" data-type="obstacle" data-label="Obstáculo / Bache"
                                style="padding: 10px 4px; font-size: 0.78rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            🕳️ Bache / Zanja
                        </button>
                        <button type="button" class="btn-obs-type" data-type="other" data-label="Otros peligros"
                                style="padding: 10px 4px; font-size: 0.78rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            ⚠️ Otros
                        </button>
                    </div>
                </div>
                
                <!-- Comentario libre (Opcional) -->
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 0.75rem; color: #a1a1aa; margin-bottom: 6px; font-weight: 500;">Comentario u Observaciones (Opcional):</label>
                    <textarea id="obsComment" rows="2" placeholder="Escribe aquí los detalles del obstáculo..." 
                              style="width: 100%; background: #27272a; border: 1px solid #52525b; border-radius: 8px; color: #fff; padding: 8px; font-size: 0.82rem; font-family: 'Outfit', sans-serif; resize: none; box-sizing: border-box; outline: none;"></textarea>
                </div>
                
                <!-- Opciones de Impacto de Desbroce -->
                <div style="margin-bottom: 18px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
                    <label style="display: block; font-size: 0.75rem; color: #a1a1aa; margin-bottom: 8px; font-weight: 500; text-align: center;">¿Cómo afecta este obstáculo al desbroce?</label>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button type="button" class="btn-obs-action active" data-action="alert"
                                style="padding: 11px; font-size: 0.85rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid #10b981; background: rgba(16,185,129,0.1); color: #10b981; font-weight: bold; cursor: pointer; text-align: center;">
                            Solo Alerta (Puedo pasar de largo)
                        </button>
                        <button type="button" class="btn-obs-action" data-action="block"
                                style="padding: 11px; font-size: 0.85rem; font-family: 'Outfit', sans-serif; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; font-weight: bold; text-align: center;">
                            🛑 Bloqueo / Dar la vuelta (No puedo avanzar)
                        </button>
                    </div>
                </div>
                
                <!-- Acciones Finales -->
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-dialog-cancel" style="flex: 1; padding: 10px; font-family: 'Outfit', sans-serif; font-weight: bold; cursor: pointer;">Cancelar</button>
                    <button class="btn btn-primary btn-dialog-save" style="flex: 1; padding: 10px; font-family: 'Outfit', sans-serif; font-weight: bold; background-color: var(--accent); border-color: var(--accent); cursor: pointer;">Guardar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Manejador del grid de tipos de obstáculo
        const typeButtons = modal.querySelectorAll('.btn-obs-type');
        let selectedType = 'vehicles';
        let selectedLabel = 'Vehículo obstaculizando';
        
        typeButtons.forEach(btn => {
            btn.onclick = () => {
                typeButtons.forEach(b => {
                    b.style.borderColor = 'var(--border-color)';
                    b.style.background = 'rgba(255,255,255,0.03)';
                    b.style.color = 'var(--text-secondary)';
                    b.classList.remove('active');
                });
                btn.style.borderColor = '#f59e0b';
                btn.style.background = 'rgba(245,158,11,0.1)';
                btn.style.color = '#f59e0b';
                btn.classList.add('active');
                selectedType = btn.dataset.type;
                selectedLabel = btn.dataset.label;
            };
        });
        
        // Manejador de las acciones (Solo Alerta / Bloqueo)
        const actionButtons = modal.querySelectorAll('.btn-obs-action');
        let selectedAction = 'alert';
        
        actionButtons.forEach(btn => {
            btn.onclick = () => {
                actionButtons.forEach(b => {
                    b.style.borderColor = 'var(--border-color)';
                    b.style.background = 'rgba(255,255,255,0.03)';
                    b.style.color = 'var(--text-secondary)';
                    b.classList.remove('active');
                });
                if (btn.dataset.action === 'alert') {
                    btn.style.borderColor = '#10b981';
                    btn.style.background = 'rgba(16,185,129,0.1)';
                    btn.style.color = '#10b981';
                } else {
                    btn.style.borderColor = '#ef4444';
                    btn.style.background = 'rgba(239,68,68,0.1)';
                    btn.style.color = '#ef4444';
                }
                btn.classList.add('active');
                selectedAction = btn.dataset.action;
            };
        });
        
        modal.querySelector('.btn-dialog-cancel').onclick = () => {
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve(null);
            }, 200);
        };
        
        modal.querySelector('.btn-dialog-save').onclick = () => {
            const comment = modal.querySelector('#obsComment').value.trim();
            modal.classList.add('fade-out');
            setTimeout(() => {
                modal.remove();
                resolve({
                    type: selectedType,
                    label: selectedLabel,
                    comment: comment,
                    action: selectedAction
                });
            }, 200);
        };
    });
}

// Dividir el tramo en caliente al llegar a un obstáculo insalvable
function splitTramoOnObstacle(tramoId, latlng, obsData) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        const coords = tramo.coordinates;
        if (coords.length < 3) {
            appAlert("Este tramo es demasiado corto para dividirlo (menos de 3 coordenadas).", "warning");
            return;
        }

        // Buscar el nodo de coordenadas más cercano al obstáculo
        let closestIdx = -1;
        let minDistance = Infinity;
        for (let i = 0; i < coords.length; i++) {
            const dist = getHaversineDistance(latlng.lat, latlng.lng, coords[i][0], coords[i][1]);
            if (dist < minDistance) {
                minDistance = dist;
                closestIdx = i;
            }
        }

        // Evitar divisiones en extremos absolutos
        if (closestIdx <= 0 || closestIdx >= coords.length - 1) {
            appAlert("No se puede registrar el obstáculo en los extremos del tramo.", "warning");
            return;
        }

        // Dividir coordenadas
        const coordsPart1 = coords.slice(0, closestIdx + 1);
        const coordsPart2 = coords.slice(closestIdx);

        const length1 = calculateLineLength(coordsPart1);
        const length2 = calculateLineLength(coordsPart2);

        // Crear parentInfo
        const timePart = Date.now();
        const parentInfo = {
            id: tramo.id,
            name: tramo.parentInfo ? tramo.parentInfo.name : tramo.name,
            status: tramo.parentInfo ? tramo.parentInfo.status : tramo.status,
            rightMarginStatus: tramo.parentInfo ? tramo.parentInfo.rightMarginStatus : tramo.rightMarginStatus,
            leftMarginStatus: tramo.parentInfo ? tramo.parentInfo.leftMarginStatus : tramo.leftMarginStatus,
            dateCompleted: tramo.parentInfo ? tramo.parentInfo.dateCompleted : tramo.dateCompleted,
            color: tramo.parentInfo ? tramo.parentInfo.color : tramo.color,
            weekNumber: tramo.parentInfo ? tramo.parentInfo.weekNumber : tramo.weekNumber,
            weekCompleted: tramo.parentInfo ? tramo.parentInfo.weekCompleted : tramo.weekCompleted
        };

        const nameMatch = tramo.name.match(/(.+)\s+\(Parte\s+([\d\.]+)\)$/);
        let namePart1, namePart2;
        if (nameMatch) {
            const cleanBase = nameMatch[1];
            const currentSeq = nameMatch[2];
            namePart1 = `${cleanBase} (Parte ${currentSeq}.1)`;
            namePart2 = `${cleanBase} (Parte ${currentSeq}.2)`;
        } else {
            namePart1 = `${tramo.name} (Parte 1)`;
            namePart2 = `${tramo.name} (Parte 2)`;
        }

        // Crear la primera parte (lo recorrido desbrozado)
        const part1 = {
            ...tramo,
            id: `${tramo.id}_p1_${timePart}`,
            name: namePart1,
            coordinates: coordsPart1,
            originalCoordinates: coordsPart1.map(c => [...c]),
            length: length1,
            mapLayer: null,
            clickTarget: null,
            parentInfo: parentInfo,
            latLngsCache: undefined,
            totalLength: undefined,
            accumLengths: undefined,
            observaciones: tramo.observaciones ? tramo.observaciones.filter(o => {
                const proj = projectLatLngToPolyline(o.lat, o.lng, coordsPart1);
                return proj.distance < 30;
            }) : []
        };

        // Crear la segunda parte (lo que queda pendiente por desbrozar)
        const part2 = {
            ...tramo,
            id: `${tramo.id}_p2_${timePart}`,
            name: namePart2,
            coordinates: coordsPart2,
            originalCoordinates: coordsPart2.map(c => [...c]),
            length: length2,
            mapLayer: null,
            clickTarget: null,
            parentInfo: parentInfo,
            latLngsCache: undefined,
            totalLength: undefined,
            accumLengths: undefined,
            observaciones: tramo.observaciones ? tramo.observaciones.filter(o => {
                const proj = projectLatLngToPolyline(o.lat, o.lng, coordsPart2);
                return proj.distance < 30;
            }) : []
        };

        // 1. Determinar qué parte es la recorrida y cuál es la restante en base al punto de inicio de la pasada
        const startLatLng = state.activeWork.startLatLng;
        let isInverseDirection = false;
        if (startLatLng) {
            const distToStart = getHaversineDistance(startLatLng.lat, startLatLng.lng, coords[0][0], coords[0][1]);
            const distToEnd = getHaversineDistance(startLatLng.lat, startLatLng.lng, coords[coords.length-1][0], coords[coords.length-1][1]);
            if (distToEnd < distToStart) {
                isInverseDirection = true;
            }
        }

        const activeMargin = state.activeWork.margin || 'right';
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const { week, year } = getISOWeekAndYear(today);

        // Crear la Alerta/Observación de bloqueo
        // IMPORTANTE: usar el nodo exacto del corte (coords[closestIdx]) para que
        // isTramoFullyBlocked lo detecte siempre a 0m del extremo del tramo partido.
        const splitNode = coords[closestIdx];
        const newObs = {
            id: 'obs_' + Date.now(),
            lat: splitNode[0],
            lng: splitNode[1],
            type: obsData.type,
            label: `${obsData.label} (Corte por bloqueo)`,
            comment: obsData.comment || 'Tractorista dio la vuelta en este punto.',
            date: Date.now(),
            isBlockSplit: true  // Marca que esta obs causó la división del tramo
        };

        // Verificar si hay un desbroce en curso activo sobre este tramo
        const isCurrentlyWorkingOnThisTramo = (state.activeWork.tramoId === tramoId);

        if (isCurrentlyWorkingOnThisTramo) {
            if (isInverseDirection) {
                // El operario entró por el final del tramo (Extremo B) y avanzó hacia atrás.
                // Por tanto, la parte recorrida es PART2 y la parte restante es PART1.
                
                // Configurar PART2 (recorrida)
                if (activeMargin === 'right') {
                    part2.rightMarginStatus = 'completed';
                    part2.rightMarginDate = dateStr;
                } else {
                    part2.leftMarginStatus = 'completed';
                    part2.leftMarginDate = dateStr;
                }
                part2.weekCompleted = `W${week}-${year}`;
                part2.color = getWeekColor(part2.weekCompleted);
                if (part2.rightMarginStatus === 'completed' && part2.leftMarginStatus === 'completed') {
                    part2.status = 'completed';
                    part2.dateCompleted = dateStr;
                } else {
                    part2.status = 'partial';
                    part2.dateCompleted = dateStr;
                }

                // Configurar PART1 (restante - hereda del tramo original)
                if (activeMargin === 'right') {
                    part1.rightMarginStatus = tramo.rightMarginStatus || 'pending';
                    part1.rightMarginDate = tramo.rightMarginDate || null;
                } else {
                    part1.leftMarginStatus = tramo.leftMarginStatus || 'pending';
                    part1.leftMarginDate = tramo.leftMarginDate || null;
                }
                part1.status = getTramoOverallStatus(part1);

                // La alerta se asocia al final del tramo restante (PART1)
                part1.observaciones.push(newObs);
            } else {
                // Dirección directa normal. PART1 es recorrido, PART2 es restante.
                
                // Configurar PART1 (recorrida)
                if (activeMargin === 'right') {
                    part1.rightMarginStatus = 'completed';
                    part1.rightMarginDate = dateStr;
                } else {
                    part1.leftMarginStatus = 'completed';
                    part1.leftMarginDate = dateStr;
                }
                part1.weekCompleted = `W${week}-${year}`;
                part1.color = getWeekColor(part1.weekCompleted);
                if (part1.rightMarginStatus === 'completed' && part1.leftMarginStatus === 'completed') {
                    part1.status = 'completed';
                    part1.dateCompleted = dateStr;
                } else {
                    part1.status = 'partial';
                    part1.dateCompleted = dateStr;
                }

                // Configurar PART2 (restante - hereda del tramo original)
                if (activeMargin === 'right') {
                    part2.rightMarginStatus = tramo.rightMarginStatus || 'pending';
                    part2.rightMarginDate = tramo.rightMarginDate || null;
                } else {
                    part2.leftMarginStatus = tramo.leftMarginStatus || 'pending';
                    part2.leftMarginDate = tramo.leftMarginDate || null;
                }
                part2.status = getTramoOverallStatus(part2);

                // La alerta se asocia al inicio del tramo restante (PART2)
                part2.observaciones.push(newObs);
            }
        } else {
            // Colocación puramente manual desde el mapa de alertas de bloqueo (sin desbroce activo).
            // Ambas partes conservan intactos todos los márgenes y estado del tramo original.
            part1.rightMarginStatus = tramo.rightMarginStatus || 'pending';
            part1.rightMarginDate = tramo.rightMarginDate || null;
            part1.leftMarginStatus = tramo.leftMarginStatus || 'pending';
            part1.leftMarginDate = tramo.leftMarginDate || null;
            part1.status = getTramoOverallStatus(part1);

            part2.rightMarginStatus = tramo.rightMarginStatus || 'pending';
            part2.rightMarginDate = tramo.rightMarginDate || null;
            part2.leftMarginStatus = tramo.leftMarginStatus || 'pending';
            part2.leftMarginDate = tramo.leftMarginDate || null;
            part2.status = getTramoOverallStatus(part2);

            // La alerta se asocia a la parte restante 2 en su punto de corte
            part2.observaciones.push(newObs);
        }

        // Desactivar el modo trabajo activo
        cancelActiveWork();

        // Reemplazar tramo en la lista principal
        const tramoIndex = state.tramos.findIndex(t => t.id === tramoId);
        if (tramoIndex !== -1) {
            state.tramos.splice(tramoIndex, 1, part1, part2);
        }

        saveToLocalStorage();
        renderTramosOnMap();
        updateUI();

        appAlert(`Trayecto dividido. Tramo recorrido registrado en Semana ${part1.weekCompleted}. Alerta de bloqueo posicionada en el mapa.`, "success");
    } catch (err) {
        console.error("Error en splitTramoOnObstacle:", err);
    }
}

// ─── Fusión silenciosa al eliminar una observación que causó la división ─────
// Recibe el tramo del que se acaba de quitar la obs y el obsId ya eliminado.
// Si ese tramo tiene un hermano (mismo parentInfo.id + mismo timestamp) y el
// obs eliminada era la única que los mantenía "separados lógicamente", une
// ambos tramos sin pedir confirmación. Devuelve el id del tramo resultante o null.
function tryMergeAfterObsRemoval(tramo, removedObs) {
    try {
        // Solo actuar si la alerta eliminada es la que causó la división
        if (!removedObs || !removedObs.isBlockSplit) return null;

        // Necesitamos que el tramo provenga de una división (tenga parentInfo)
        let parentId = null;
        let partPrefix = null;
        let timestamp = null;

        if (tramo.parentInfo && tramo.parentInfo.id) {
            parentId = tramo.parentInfo.id;
            const match = tramo.id.match(/(.+)(_p[12]_)(\d+)$/);
            if (match) { partPrefix = match[2]; timestamp = match[3]; }
        } else {
            const match = tramo.id.match(/(.+)(_p[12]_)(\d+)$/);
            if (match) { parentId = match[1]; partPrefix = match[2]; timestamp = match[3]; }
        }

        if (!parentId || !partPrefix || !timestamp) return null;

        // Localizar al hermano
        const partnerId = partPrefix === '_p1_' ? `${parentId}_p2_${timestamp}` : `${parentId}_p1_${timestamp}`;
        const partner = state.tramos.find(t => t.id === partnerId);
        if (!partner) return null;

        const part1 = partPrefix === '_p1_' ? tramo : partner;
        const part2 = partPrefix === '_p1_' ? partner : tramo;

        // Unir coordenadas (el último punto de part1 es idéntico al primero de part2)
        const mergedCoords = [...part1.coordinates.slice(0, -1), ...part2.coordinates];

        // Fusionar observaciones de ambas partes (ya sin la obs eliminada)
        const mergedObs = [
            ...(part1.observaciones || []),
            ...(part2.observaciones || [])
        ];

        // Cálculo conservador de márgenes: solo se marca completado si ambas partes lo tenían
        const mergeMarginStatus = (s1, s2) => {
            if (s1 === 'completed' && s2 === 'completed') return 'completed';
            if (s1 === 'pending' && s2 === 'pending') return 'pending';
            return 'partial';
        };
        const mergedRight = mergeMarginStatus(part1.rightMarginStatus, part2.rightMarginStatus);
        const mergedLeft  = mergeMarginStatus(part1.leftMarginStatus,  part2.leftMarginStatus);
        const mergedStatus = getTramoOverallStatus({ rightMarginStatus: mergedRight, leftMarginStatus: mergedLeft });

        // Reconstruir el tramo padre
        const parentTramo = {
            id: parentId,
            name: tramo.parentInfo ? tramo.parentInfo.name : tramo.name.replace(/\s*\(Parte\s+[12]\)$/, ''),
            fileId: tramo.fileId,
            coordinates: mergedCoords,
            originalCoordinates: mergedCoords.map(c => [...c]),
            length: calculateLineLength(mergedCoords),
            status: mergedStatus,
            rightMarginStatus: mergedRight,
            leftMarginStatus: mergedLeft,
            dateCompleted: tramo.parentInfo ? tramo.parentInfo.dateCompleted : null,
            color: tramo.parentInfo ? tramo.parentInfo.color : null,
            weekNumber: tramo.parentInfo ? tramo.parentInfo.weekNumber : null,
            weekCompleted: tramo.parentInfo ? tramo.parentInfo.weekCompleted : null,
            observaciones: mergedObs,
            mapLayer: null
        };

        // Conservar parentInfo del abuelo si existía (recursividad multinivel)
        if (tramo.parentInfo && tramo.parentInfo.parentInfo) {
            parentTramo.parentInfo = tramo.parentInfo.parentInfo;
        }

        // Reemplazar los dos hijos por el padre en state.tramos
        const idx1 = state.tramos.findIndex(t => t.id === part1.id);
        const idx2 = state.tramos.findIndex(t => t.id === part2.id);
        if (idx1 !== -1 && idx2 !== -1) {
            const minIdx = Math.min(idx1, idx2);
            const maxIdx = Math.max(idx1, idx2);
            state.tramos.splice(maxIdx, 1);
            state.tramos.splice(minIdx, 1, parentTramo);
        }

        // Reemplazar en routeOrder
        const rIdx1 = state.routeOrder.indexOf(part1.id);
        const rIdx2 = state.routeOrder.indexOf(part2.id);
        if (rIdx1 !== -1 && rIdx2 !== -1) {
            const rMinIdx = Math.min(rIdx1, rIdx2);
            const rMaxIdx = Math.max(rIdx1, rIdx2);
            state.routeOrder.splice(rMaxIdx, 1);
            state.routeOrder.splice(rMinIdx, 1, parentTramo.id);
        }

        // Limpiar capas del mapa de ambos hijos
        if (part1.mapLayer && map) tramosLayerGroup.removeLayer(part1.mapLayer);
        if (part2.mapLayer && map) tramosLayerGroup.removeLayer(part2.mapLayer);

        return parentTramo.id;
    } catch (e) {
        console.error('Error en tryMergeAfterObsRemoval:', e);
        return null;
    }
}

// Eliminar un marcador de advertencia/observación
function removeObservation(tramoId, obsId) {
    try {
        const tramo = state.tramos.find(t => t.id === tramoId);
        if (!tramo) return;

        // Guardar la obs que se va a eliminar antes de quitarla
        const removedObs = (tramo.observaciones || []).find(o => o.id === obsId);

        tramo.observaciones = tramo.observaciones.filter(o => o.id !== obsId);

        // Cerrar popups de Leaflet que puedan estar abiertos
        map.closePopup();

        // Intentar fusión silenciosa si la obs era un bloqueo y el tramo viene de una división
        const mergedId = tryMergeAfterObsRemoval(tramo, removedObs);

        saveToLocalStorage();
        renderTramosOnMap();
        appAlert("Observación eliminada del tramo.", "info");

        // Si la bottom sheet de detalles estaba abierta, refrescarla con el tramo resultante
        const refreshId = mergedId || tramoId;
        if (state.selectedTramoId === tramoId || state.selectedTramoId === refreshId) {
            const exists = state.tramos.find(t => t.id === refreshId);
            if (exists) {
                state.selectedTramoId = refreshId;
                openRoadDetail(refreshId);
            }
        }
    } catch (err) {
        console.error("Error en removeObservation:", err);
    }
}

