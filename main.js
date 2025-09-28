const { console, core, event, mpv, preferences, input } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;

// Defaults
let pauseMargin = 0.0;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;

// Cargar settings ASÍNCRONAMENTE
function loadSettings(callback) {
  let loaded = 0;
  const total = 4;

  function checkLoaded() {
    loaded++;
    if (loaded === total && callback) callback();
  }

  preferences.get("pauseMargin", (value) => {
    pauseMargin = parseFloat(value) || 0.0;
    checkLoaded();
  });

  preferences.get("checkIntervalMs", (value) => {
    checkIntervalMs = parseInt(value) || 100;
    checkLoaded();
  });

  preferences.get("pollIntervalMs", (value) => {
    pollIntervalMs = parseInt(value) || 200;
    checkLoaded();
  });

  preferences.get("timeOffset", (value) => {
    timeOffset = parseFloat(value) || 0;
    checkLoaded();
  });
}

// Función para configurar pausa cerca del final del subtítulo actual
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const currentTime = mpv.getNumber("playback-time");
  const adjustedEnd = currentSubEnd + timeOffset;
  
  if (currentTime > adjustedEnd) {
    console.log(`Sub ya terminó (tiempo=${currentTime.toFixed(2)}s > fin=${adjustedEnd.toFixed(2)}s). Esperando nuevo.`);
    return;
  }

  console.log(`Configurando pausa: Fin ajustado=${adjustedEnd.toFixed(2)}s (desde ${currentTime.toFixed(2)}s, margen=${pauseMargin}s, offset=${timeOffset}s)`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    if (Math.floor(nowTime * 10) % 5 === 0) {
      console.log(`Chequeo: t=${nowTime.toFixed(2)}s, p=${isPaused}, fin_ajustado=${adjustedEnd.toFixed(2)}s`);
    }

    if (!isPaused && subVisibility && sid > 0 && nowTime >= (adjustedEnd - pauseMargin) && nowTime < adjustedEnd + 1) {
      core.pause();
      console.log(`*** PAUSADO ANTES DEL SIGUIENTE a ${nowTime.toFixed(2)}s (fin: ${adjustedEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Play para siguiente subtítulo");
      clearInterval(checkInterval);
    }
  }, checkIntervalMs);
}

// Polling de respaldo para detectar cambios en sub-text
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    setTimeout(() => {
      const subText = mpv.getString("sub-text");
      if (subText && subText.trim() !== "" && subText !== lastSubText) {
        lastSubText = subText;
        currentSubEnd = mpv.getNumber("sub-end");
        console.log(`*** Nuevo sub por POLLING: fin=${currentSubEnd.toFixed(2)}s ***`);
        if (pluginEnabled) {
          setupPauseBeforeNextSub();
        }
      }
    }, 50);
  }, pollIntervalMs);
}

// Función helper para navegar subtítulos
function handleSubtitleNavigation(command) {
  const sid = mpv.getNumber("sid");
  if (sid <= 0) {
    core.osd("❌ No hay subtítulos activos para navegar", "warning");
    return;
  }
  
  switch(command) {
    case "next":
      mpv.command("sub_step", ["1"]);
      console.log("*** Avanzar: Siguiente subtítulo ***");
      core.osd("⏭️ Siguiente subtítulo");
      break;
    case "repeat":
      const subStart = mpv.getNumber("sub-start");
      if (subStart && subStart > 0) {
        mpv.command("seek", [subStart.toString(), "absolute"]);
        console.log(`*** Repetir: Seek a ${subStart.toFixed(2)}s ***`);
        core.osd("🔄 Repitiendo subtítulo actual");
      } else {
        core.osd("⚠️ No se puede repetir el subtítulo actual");
      }
      break;
    case "previous":
      mpv.command("sub_step", ["-1"]);
      console.log("*** Retroceder: Subtítulo anterior ***");
      core.osd("⏮️ Subtítulo anterior");
      break;
  }
}

// Evento: Inicio de nuevo subtítulo
event.on("mpv.sub-start.changed", () => {
  const subStart = mpv.getNumber("sub-start");
  const subText = mpv.getString("sub-text");
  const sid = mpv.getNumber("sid");
  
  if (sid > 0 && subText && subText.trim() !== "") {
    currentSubEnd = mpv.getNumber("sub-end");
    lastSubText = subText;
    console.log(`*** Nuevo sub por EVENTO: inicio=${subStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s ***`);
    if (pluginEnabled) {
      setupPauseBeforeNextSub();
    }
  }
});

// Evento: Play manual
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual: Reiniciando polling. ***");
    startPolling();
  }
});

// SOLUCIÓN: Usar la API correcta de IINA para keybindings
// Registrar handlers con bind en lugar de on

// Toggle plugin (P)
input.bind("p", (data) => {
  pluginEnabled = !pluginEnabled;
  const status = pluginEnabled ? "ACTIVADO ✅" : "DESACTIVADO ❌";
  console.log(`Plugin: ${status}`);
  core.osd(`Pausa-subs: ${status}`);
  if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
  return true; // Evento manejado
});

// Subtítulo anterior (A)
input.bind("a", (data) => {
  console.log("Tecla A presionada - Subtítulo anterior");
  handleSubtitleNavigation("previous");
  return true; // Evento manejado
});

// Repetir subtítulo (S)
input.bind("s", (data) => {
  console.log("Tecla S presionada - Repetir subtítulo");
  handleSubtitleNavigation("repeat");
  return true; // Evento manejado
});

// Siguiente subtítulo (D)
input.bind("d", (data) => {
  console.log("Tecla D presionada - Siguiente subtítulo");
  handleSubtitleNavigation("next");
  return true; // Evento manejado
});

// ALTERNATIVA: Si las teclas simples no funcionan, usar modificadores
// Shift+A para anterior
input.bind("Shift+a", (data) => {
  console.log("Shift+A - Subtítulo anterior");
  handleSubtitleNavigation("previous");
  return true;
});

// Shift+S para repetir
input.bind("Shift+s", (data) => {
  console.log("Shift+S - Repetir subtítulo");
  handleSubtitleNavigation("repeat");
  return true;
});

// Shift+D para siguiente
input.bind("Shift+d", (data) => {
  console.log("Shift+D - Siguiente subtítulo");
  handleSubtitleNavigation("next");
  return true;
});

// OTRA ALTERNATIVA: Usar teclas numéricas que tienen menos conflictos
input.bind("1", (data) => {
  handleSubtitleNavigation("previous");
  return true;
});

input.bind("2", (data) => {
  handleSubtitleNavigation("repeat");
  return true;
});

input.bind("3", (data) => {
  handleSubtitleNavigation("next");
  return true;
});

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  lastSubText = "";
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  
  loadSettings(() => {
    console.log(`Settings: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, Polling=${pollIntervalMs}ms, Offset=${timeOffset}s`);
    core.osd(`📺 Plugin activo - Controles:
• P: Activar/Desactivar
• A/S/D o Shift+A/S/D o 1/2/3:
  Anterior/Repetir/Siguiente`);
    if (sid > 0) startPolling();
  });
});

// Inicializar
loadSettings(() => {
  console.log("=================================");
  console.log("Plugin de Subtítulos Iniciado");
  console.log("Controles disponibles:");
  console.log("• P: Toggle plugin on/off");
  console.log("• A o Shift+A o 1: Subtítulo anterior");
  console.log("• S o Shift+S o 2: Repetir subtítulo");
  console.log("• D o Shift+D o 3: Siguiente subtítulo");
  console.log("=================================");
  
  // Mostrar teclas ya registradas (para debug)
  const bindings = input.getAllKeyBindings();
  console.log("Teclas ya registradas en IINA:", Object.keys(bindings).filter(k => 
    k.toLowerCase() === 'a' || 
    k.toLowerCase() === 's' || 
    k.toLowerCase() === 'd' || 
    k.toLowerCase() === 'p'
  ));
});

// Limpieza al descargar el plugin
event.on("iina.plugin-will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  
  // Limpiar todos los key bindings
  input.bind("p", null);
  input.bind("a", null);
  input.bind("s", null);
  input.bind("d", null);
  input.bind("Shift+a", null);
  input.bind("Shift+s", null);
  input.bind("Shift+d", null);
  input.bind("1", null);
  input.bind("2", null);
  input.bind("3", null);
  
  console.log("Plugin descargado y bindings limpiados.");
});