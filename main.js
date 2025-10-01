const { console, core, event, mpv, preferences, input, menu } = iina;

// --- Variables Globales ---
let checkInterval = null;
let currentSubStart = 0;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;
let remainingPlays = 1;

// --- Configuración (cargada desde preferencias) ---
let pauseMargin = 0.0;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;
let autoRepeatEnabled = false;
let repeatTimes = 5;

// --- Carga de Configuración ---
function loadSettings(callback) {
  let loaded = 0;
  const total = 6;
  const settings = ["pauseMargin", "checkIntervalMs", "pollIntervalMs", "timeOffset", "autoRepeat", "repeatTimes"];
  
  settings.forEach(key => {
    preferences.get(key, (value) => {
      if (key === "autoRepeat") {
        autoRepeatEnabled = value === true || value === "true";
      } else {
        // Asegura que los valores numéricos sean del tipo correcto
        window[key] = (key.includes("Ms")) ? parseInt(value) || 100 : parseFloat(value) || 0;
      }
      if (++loaded === total && callback) callback();
    });
  });
}

/**
 * Se llama cuando se detecta un nuevo subtítulo.
 * Esta función centraliza el reinicio del estado.
 */
function onNewSubtitleDetected(subStart, subEnd, subText) {
  // Limpiar cualquier intervalo anterior
  if (checkInterval) clearInterval(checkInterval);

  currentSubStart = subStart;
  currentSubEnd = subEnd;
  lastSubText = subText;

  console.log(`*** NUEVO SUBTÍTULO ***: Inicio=${currentSubStart.toFixed(2)}s, Fin=${currentSubEnd.toFixed(2)}s, Texto="${subText.substring(0, 30)}..."`);

  if (pluginEnabled) {
    // Reiniciar el contador de repeticiones para el nuevo subtítulo
    remainingPlays = autoRepeatEnabled ? repeatTimes : 1;
    console.log(`Reiniciando reps. Restantes: ${remainingPlays}`);
    setupSubtitleTimer();
  }
}

/**
 * Configura el temporizador que espera el momento de pausar o repetir.
 */
function setupSubtitleTimer() {
  if (checkInterval) clearInterval(checkInterval);

  // Si el tiempo de fin es inválido, no hacer nada
  if (currentSubEnd <= 0) return;

  const adjustedEndTime = currentSubEnd + timeOffset;
  const triggerTime = adjustedEndTime - pauseMargin;

  console.log(`Configurando temporizador. Trigger en: ${triggerTime.toFixed(2)}s. Fin ajustado: ${adjustedEndTime.toFixed(2)}s.`);

  checkInterval = setInterval(() => {
    const currentTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");

    // Salir si el video está pausado o no hay subtítulos visibles
    if (isPaused || !mpv.getFlag("sub-visibility") || mpv.getNumber("sid") <= 0) {
      return;
    }

    // Condición principal: ¿hemos llegado al momento de actuar?
    if (currentTime >= triggerTime) {
      console.log(`*** TRIGGER ACTIVADO a ${currentTime.toFixed(2)}s (Trigger: ${triggerTime.toFixed(2)}s) ***`);
      
      // Detener este intervalo inmediatamente
      clearInterval(checkInterval);
      checkInterval = null;

      if (autoRepeatEnabled && remainingPlays > 1) {
        handleRepeat();
      } else {
        handlePause();
      }
    }
  }, checkIntervalMs);
}

/**
 * Maneja la lógica de repetición.
 */
function handleRepeat() {
  remainingPlays--;
  const currentRepeat = repeatTimes - remainingPlays;
  console.log(`*** AUTO-REPEAT: Repetición ${currentRepeat}/${repeatTimes}. Volviendo a ${currentSubStart.toFixed(2)}s ***`);
  
  core.osd(`🔄 Rep ${currentRepeat}/${repeatTimes}`);
  
  // Usar seek absoluto para máxima fiabilidad
  mpv.command("seek", [currentSubStart, "absolute"]);
  core.resume();

  // Dar tiempo a MPV para procesar el seek antes de reconfigurar el temporizador
  setTimeout(() => {
    // Después de seek, reconfirmar el tiempo de fin por si acaso
    currentSubEnd = mpv.getNumber("sub-end");
    console.log(`Post-seek: Nuevo fin confirmado=${currentSubEnd.toFixed(2)}s. Restantes=${remainingPlays}.`);
    setupSubtitleTimer();
  }, 150); // 150ms es un buen punto de partida
}

/**
 * Maneja la lógica de pausa.
 */
function handlePause() {
  console.log(`*** PAUSANDO en el final del subtítulo. ***`);
  core.pause();
  core.osd("⏸️ Pausado. Presiona Play para continuar.");
}

// --- Eventos y Control de Usuario ---

// Detectar nuevos subtítulos a través del evento de cambio de propiedad
event.on("mpv.property-changed", (data) => {
  if (data.name === "sub-start") {
    const subText = mpv.getString("sub-text");
    // Solo actuar si el texto es nuevo y no está vacío
    if (subText && subText.trim() !== "" && subText !== lastSubText) {
      const subStart = mpv.getNumber("sub-start");
      const subEnd = mpv.getNumber("sub-end");
      onNewSubtitleDetected(subStart, subEnd, subText);
    }
  }
});

// Polling como respaldo para cuando el evento no se dispara (poco común)
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    const subText = mpv.getString("sub-text");
    if (subText && subText.trim() !== "" && subText !== lastSubText) {
      const subStart = mpv.getNumber("sub-start");
      const subEnd = mpv.getNumber("sub-end");
      onNewSubtitleDetected(subStart, subEnd, subText);
    }
  }, pollIntervalMs);
}

// Función helper para navegación de subtítulos
function handleSubtitleNavigation(command) {
  if (mpv.getNumber("sid") <= 0) {
    core.osd("❌ No hay subtítulos activos", "warning");
    return;
  }
  
  // Limpiar cualquier temporizador activo al navegar manualmente
  if (checkInterval) clearInterval(checkInterval);

  switch(command) {
    case "next":
      mpv.command("sub-seek", ["1"]);
      core.osd("⏭️ Siguiente");
      break;
    case "repeat":
      // La repetición manual ahora también usa seek absoluto
      mpv.command("seek", [currentSubStart, "absolute"]);
      core.osd("🔄 Repitiendo");
      break;
    case "previous":
      mpv.command("sub-seek", ["-1"]);
      core.osd("⏮️ Anterior");
      break;
    case "toggle":
      pluginEnabled = !pluginEnabled;
      core.osd(`Plugin: ${pluginEnabled ? 'ACTIVADO ✅' : 'DESACTIVADO ❌'}`);
      if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
      break;
  }
  core.resume();
}

// --- Registro de Teclas y Menús ---
input.onKeyDown("p", () => { handleSubtitleNavigation("toggle"); return true; });
input.onKeyDown("a", () => { handleSubtitleNavigation("previous"); return true; });
input.onKeyDown("s", () => { handleSubtitleNavigation("repeat"); return true; });
input.onKeyDown("d", () => { handleSubtitleNavigation("next"); return true; });

// ... (El código de registro de menú y comandos MPV puede permanecer igual) ...
try {
  if (menu && menu.addItem) {
    menu.addItem({ title: "Plugin: Toggle On/Off", action: () => handleSubtitleNavigation("toggle") });
    menu.addItem({ title: "Subtítulo Anterior", action: () => handleSubtitleNavigation("previous") });
    menu.addItem({ title: "Repetir Subtítulo", action: () => handleSubtitleNavigation("repeat") });
    menu.addItem({ title: "Siguiente Subtítulo", action: () => handleSubtitleNavigation("next") });
  }
} catch (e) { console.log("Error menú:", e.message); }

try {
  mpv.registerScriptMessageHandler("subtitle-previous", () => handleSubtitleNavigation("previous"));
  mpv.registerScriptMessageHandler("subtitle-repeat", () => handleSubtitleNavigation("repeat"));
  mpv.registerScriptMessageHandler("subtitle-next", () => handleSubtitleNavigation("next"));
  mpv.registerScriptMessageHandler("subtitle-toggle", () => handleSubtitleNavigation("toggle"));
} catch (e) { console.log("Error comandos MPV:", e.message); }


// --- Inicialización ---
event.on("mpv.file-loaded", () => {
  // Resetear estado
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  currentSubStart = 0;
  currentSubEnd = 0;
  lastSubText = "";
  remainingPlays = 1;

  loadSettings(() => {
    console.log(`Settings cargados. AutoRepeat: ${autoRepeatEnabled} (${repeatTimes} veces)`);
    
    if (autoRepeatEnabled) {
      try {
        mpv.setOption("sub-ass-prune-delay", "inf");
        console.log("PRUNING OFF: sub-ass-prune-delay=inf");
      } catch (e) { console.log("Error prune-delay:", e.message); }
    }
    
    core.osd(`📺 Plugin Activo. Auto-repeat: ${autoRepeatEnabled ? 'ON' : 'OFF'}`);
    
    if (mpv.getNumber("sid") > 0) {
      startPolling();
    }
  });
});

// Limpieza al descargar el plugin
event.on("iina.plugin-will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});