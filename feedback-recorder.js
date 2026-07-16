/**
 * DesbroceApp - Módulo de Grabación de Feedback por Voz
 * 
 * Este módulo es 100% independiente y autocontenido.
 * Para desactivarlo en el futuro, solo hay que retirar su importación en index.html.
 */

(function () {
    // Verificar si el navegador soporta las APIs necesarias
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        console.warn("La grabación de audio no está soportada en este navegador.");
        return;
    }

    // Inicializar base de datos IndexedDB
    let db = null;
    const DB_NAME = "DesbroceFeedbackDB";
    const DB_VERSION = 1;

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (e) => console.error("Error abriendo DB de feedback:", e);
    request.onsuccess = (e) => {
        db = e.target.result;
        renderFeedbackMarkersOnMap(); // Pintar en el mapa notas previas
    };
    request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains("voice_notes")) {
            database.createObjectStore("voice_notes", { keyPath: "id", autoIncrement: true });
        }
    };

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    // Crear elementos de la interfaz flotante
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        .feedback-mic-btn {
            position: fixed;
            top: 15px;
            right: 15px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background-color: #27272a;
            color: #ef4444; /* Icono rojo sutil para indicar función de micro */
            border: 1px solid #3f3f46;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            cursor: pointer;
            z-index: 1100;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .feedback-mic-btn:hover {
            transform: scale(1.05);
            background-color: #3f3f46;
            color: #fca5a5;
        }
        .feedback-mic-btn.recording {
            background-color: #ef4444 !important;
            color: white !important;
            animation: pulse-red-mic 1.2s infinite;
            border-color: #fca5a5;
            box-shadow: 0 0 15px rgba(239, 68, 68, 0.6);
        }
        .feedback-list-btn {
            position: fixed;
            top: 15px;
            right: 75px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background-color: #27272a;
            color: #d4d4d8;
            border: 1px solid #3f3f46;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            cursor: pointer;
            z-index: 1100;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }
        .feedback-list-btn:hover {
            background-color: #3f3f46;
            color: #ffffff;
            transform: scale(1.05);
        }
        @keyframes pulse-red-mic {
            0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
            70% { box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); }
            100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        
        /* Panel de notas guardadas */
        .feedback-panel {
            position: fixed;
            top: 75px;
            right: 15px;
            width: 320px;
            max-height: 400px;
            background: rgba(9, 9, 11, 0.95);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            box-shadow: 0 15px 30px rgba(0, 0, 0, 0.5);
            z-index: 1100;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Outfit', sans-serif;
            color: #f4f4f5;
            transition: all 0.3s ease;
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
            pointer-events: none;
        }
        .feedback-panel.active {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: all;
        }
        .feedback-panel-header {
            padding: 12px 16px;
            background: rgba(255, 255, 255, 0.05);
            border-bottom: 1px solid rgba(255,255,255,0.08);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .feedback-panel-title {
            font-size: 0.85rem;
            font-weight: 700;
            color: #f59e0b;
        }
        .feedback-panel-close {
            background: none;
            border: none;
            color: #a1a1aa;
            font-size: 1.2rem;
            cursor: pointer;
        }
        .feedback-notes-list {
            padding: 10px;
            overflow-y: auto;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .feedback-note-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 8px;
            font-size: 0.75rem;
        }
        .feedback-note-meta {
            display: flex;
            justify-content: space-between;
            color: #a1a1aa;
            margin-bottom: 6px;
            font-size: 0.7rem;
        }
        .feedback-note-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 6px;
        }
        .feedback-note-btn {
            background: none;
            border: none;
            color: #10b981;
            cursor: pointer;
            padding: 2px 6px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .feedback-note-btn.delete {
            color: #ef4444;
        }
        .feedback-note-btn.gps {
            color: #3b82f6;
        }
        .feedback-empty-state {
            text-align: center;
            color: #71717a;
            padding: 30px 10px;
            font-size: 0.8rem;
        }
        
        /* Marcador especial en el mapa */
        .feedback-map-icon {
            background-color: #ef4444;
            border: 2px solid white;
            border-radius: 50%;
            width: 14px;
            height: 14px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.5);
            animation: bounce-marker 1s infinite alternate;
        }
        @keyframes bounce-marker {
            from { transform: translateY(0); }
            to { transform: translateY(-4px); }
        }
    `;
    document.head.appendChild(styleEl);

    // Botón micrófono principal
    const micBtn = document.createElement('button');
    micBtn.className = 'feedback-mic-btn';
    micBtn.title = "Grabar nota de voz rápida sobre la marcha";
    micBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px;">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
            <line x1="12" x2="12" y1="19" y2="22"></line>
        </svg>
    `;

    // Botón de listado de notas
    const listBtn = document.createElement('button');
    listBtn.className = 'feedback-list-btn';
    listBtn.title = "Ver notas de voz guardadas";
    listBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
    `;

    // Panel de visualización de notas
    const panel = document.createElement('div');
    panel.className = 'feedback-panel';
    panel.innerHTML = `
        <div class="feedback-panel-header">
            <span class="feedback-panel-title">NOTAS DE VOZ (DIAGNÓSTICO)</span>
            <button class="feedback-panel-close">&times;</button>
        </div>
        <div class="feedback-notes-list" id="feedbackNotesList"></div>
    `;

    document.body.appendChild(micBtn);
    document.body.appendChild(listBtn);
    document.body.appendChild(panel);

    // Eventos del panel
    listBtn.onclick = () => {
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            loadAndRenderNotes();
        }
    };
    panel.querySelector('.feedback-panel-close').onclick = () => {
        panel.classList.remove('active');
    };

    // Evento de grabación del micrófono
    micBtn.onclick = async () => {
        if (!isRecording) {
            // Empezar a grabar
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    saveVoiceNote(audioBlob);
                    
                    // Detener todos los tracks del micro para liberar hardware
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                isRecording = true;
                micBtn.classList.add('recording');
                
                // Pequeño sonido indicador o vibración si el móvil lo soporta
                if (navigator.vibrate) navigator.vibrate(80);
            } catch (err) {
                console.error("Error al acceder al micrófono:", err);
                if (window.appAlert) {
                    window.appAlert("No se pudo acceder al micrófono para grabar la nota de voz. Otorga los permisos necesarios.", "error");
                }
            }
        } else {
            // Detener grabación
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
            isRecording = false;
            micBtn.classList.remove('recording');
            if (navigator.vibrate) navigator.vibrate([40, 40]);
        }
    };

    // Guardar nota de voz en IndexedDB con metadatos
    function saveVoiceNote(audioBlob) {
        if (!db) return;

        // Capturar estado de la app si está disponible
        const appState = window.state || {};
        const userLoc = appState.userLocation || null;
        let activeRoadName = "Ninguno";
        let currentMargin = "";

        if (appState.activeWork) {
            const tramo = (appState.tramos || []).find(t => t.id === appState.activeWork.tramoId);
            if (tramo) {
                activeRoadName = tramo.name;
                currentMargin = appState.activeWork.margin === 'right' ? 'Derecho' : 'Izquierdo';
            }
        }

        const date = new Date();
        const note = {
            timestamp: date.toLocaleString('es-ES'),
            rawTimestamp: date.getTime(),
            latlng: userLoc ? { lat: userLoc.lat, lng: userLoc.lng } : null,
            activeRoad: activeRoadName,
            margin: currentMargin,
            audioBlob: audioBlob
        };

        const tx = db.transaction("voice_notes", "readwrite");
        const store = tx.objectStore("voice_notes");
        const requestAdd = store.add(note);

        requestAdd.onsuccess = () => {
            if (window.appAlert) {
                window.appAlert("Nota de voz guardada con éxito.", "success");
            }
            loadAndRenderNotes();
            renderFeedbackMarkersOnMap();
        };

        requestAdd.onerror = (e) => {
            console.error("Error guardando nota de voz:", e);
        };
    }

    // Cargar y mostrar las notas de voz en el panel lateral
    function loadAndRenderNotes() {
        if (!db) return;

        const container = document.getElementById("feedbackNotesList");
        container.innerHTML = "";

        const tx = db.transaction("voice_notes", "readonly");
        const store = tx.objectStore("voice_notes");
        const cursorRequest = store.openCursor(null, "prev"); // Orden descendente

        let count = 0;

        cursorRequest.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                count++;
                const note = cursor.value;
                const card = document.createElement("div");
                card.className = "feedback-note-card";

                // Crear URL para el reproductor de audio
                const audioUrl = URL.createObjectURL(note.audioBlob);

                card.innerHTML = `
                    <div class="feedback-note-meta">
                        <span>📅 ${note.timestamp}</span>
                        <span>🛣️ ${note.activeRoad} ${note.margin ? '('+note.margin+')' : ''}</span>
                    </div>
                    <audio src="${audioUrl}" controls style="width: 100%; height: 32px; margin-top: 4px; border-radius: 4px; background: #18181b; outline: none;"></audio>
                    <div class="feedback-note-actions">
                        <div>
                            ${note.latlng ? `<button class="feedback-note-btn gps" data-lat="${note.latlng.lat}" data-lng="${note.latlng.lng}">📍 Ver en Mapa</button>` : `<span style="color:#71717a; font-size:0.7rem;">Sin GPS</span>`}
                        </div>
                        <button class="feedback-note-btn delete" data-id="${note.id}">Eliminar</button>
                    </div>
                `;

                // Eventos de botones
                const gpsBtn = card.querySelector(".gps");
                if (gpsBtn) {
                    gpsBtn.onclick = () => {
                        const lat = parseFloat(gpsBtn.getAttribute("data-lat"));
                        const lng = parseFloat(gpsBtn.getAttribute("data-lng"));
                        if (window.map) {
                            window.map.setView([lat, lng], 17);
                        }
                    };
                }

                card.querySelector(".delete").onclick = () => {
                    const id = parseInt(card.querySelector(".delete").getAttribute("data-id"));
                    deleteNote(id);
                };

                container.appendChild(card);
                cursor.continue();
            } else {
                if (count === 0) {
                    container.innerHTML = `<div class="feedback-empty-state">No tienes notas de voz grabadas.</div>`;
                }
            }
        };
    }

    // Eliminar nota de voz
    function deleteNote(id) {
        if (!db) return;
        const tx = db.transaction("voice_notes", "readwrite");
        const store = tx.objectStore("voice_notes");
        const requestDel = store.delete(id);

        requestDel.onsuccess = () => {
            loadAndRenderNotes();
            renderFeedbackMarkersOnMap();
        };
    }

    // Dibujar marcadores espaciales en el mapa Leaflet de las notas grabadas
    let feedbackMapMarkers = [];

    function renderFeedbackMarkersOnMap() {
        if (!db || !window.map || !window.L) return;

        // Limpiar marcadores anteriores
        feedbackMapMarkers.forEach(marker => window.map.removeLayer(marker));
        feedbackMapMarkers = [];

        const tx = db.transaction("voice_notes", "readonly");
        const store = tx.objectStore("voice_notes");
        const requestGetAll = store.getAll();

        requestGetAll.onsuccess = () => {
            const notes = requestGetAll.result;
            notes.forEach(note => {
                if (note.latlng) {
                    const customIcon = L.divIcon({
                        className: 'feedback-map-icon',
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });

                    const audioUrl = URL.createObjectURL(note.audioBlob);
                    
                    const marker = L.marker([note.latlng.lat, note.latlng.lng], { icon: customIcon })
                        .addTo(window.map)
                        .bindPopup(`
                            <div style="font-family:'Outfit', sans-serif; font-size: 11px; color:#fff; width:220px; background:#09090b; padding:10px; border-radius:10px;">
                                <strong style="color:#f59e0b; display:block; margin-bottom:4px;">Nota de Voz de Feedback</strong>
                                <span style="display:block; color:#a1a1aa; font-size:9px; margin-bottom:6px;">🕒 ${note.timestamp}</span>
                                <span style="display:block; color:#cbd5e1; margin-bottom:8px;">🛣️ Tramo: ${note.activeRoad}</span>
                                <audio src="${audioUrl}" controls style="width:100%; height:26px;"></audio>
                            </div>
                        `, { className: 'custom-leaflet-popup' });
                    
                    feedbackMapMarkers.push(marker);
                }
            });
        };
    }

    // Volver a renderizar los marcadores cuando se cargue el mapa
    window.addEventListener('load', () => {
        setTimeout(() => {
            renderFeedbackMarkersOnMap();
        }, 2000);
    });

})();
