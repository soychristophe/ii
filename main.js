const { console, core, event, mpv, preferences, input, menu } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;

// Variables para auto-repetición
let autoRepeatEnabled = false;
let autoRepeatTimes = 2;
let currentRepeatCount = 0;
let isAutoRepeating = false;

// Defaults
let pauseMargin = 0.0;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;

// Cargar settings ASÍNCRONAMENTE con callbacks
function loadSettings(callback) {
  let loaded = 0;
  const total = 6;

  function checkLoaded() {
    loaded++;
    if (loaded === total && callback) {
      callback();
    }
  }

  preferences.get("pauseMargin", (value) => {
    if (value !== undefined && value !== null) {
      pauseMargin = parseFloat(value);
    }
    checkLoaded();
  });

  preferences.get("checkIntervalMs", (value) => {
    if (value !== undefined && value !== null) {
      checkIntervalMs = parseInt(value);
    }
    checkLoaded();
  });

  preferences.get("pollIntervalMs", (value) => {
    if (value !== undefined && value !== null) {
      pollIntervalMs = parseInt(value);
    }
    checkLoaded();
  });

  preferences.get("timeOffset", (value) => {
    if (value !== undefined && value !== null) {
      timeOffset = parseFloat(value);
    }
    checkLoaded();
  });

  preferences.get("autoRepeatEnabled", (value) => {
    if (value !== undefined && value !== null) {
      autoRepeatEnabled = (value === true || value === "true");
    }
    checkLoaded();
  });

  preferences.get("autoRepeatTimes", (value) => {
    if (value !== undefined && value !== null) {
      autoRepeatTimes = parseInt(value);
      if (autoRepeatTimes < 1) autoRepeatTimes = 1;
      if (autoRepeatTimes > 10) autoRepeatTimes = 10;
    }
    checkLoaded();
  });
}

// Función para manejar la auto-repetición
function handleAutoRepeat() {
  if (!autoRepeatEnabled) return;

  currentRepeatCount++;
  
  console.log(`Auto-repetición: ${currentRepeatCount}/${autoRepeatTimes}`);
  
  if (currentRepeatCount < autoRepeatTimes) {
    // Repetir el subtítulo actual
    isAutoRepeating = true;
    setTimeout(() => {
      mpv.command("sub-seek", ["0"]);
      core.osd(`🔄 Repitiendo ${currentRepeatCount}/${autoRepeatTimes}`);
      core.resume();
    }, 300);
  } else {
    // Ya se repitió suficientes veces, avanzar al siguiente
    console.log(`Auto-repetición completada. Avanzando al siguiente subtítulo.`);
    currentRepeatCount = 0;
    isAutoRepeating = true;
    setTimeout(() => {
      mpv.command("sub-seek", ["1"]);
      core.osd(`➡️ Siguiente subtítulo (auto)`);
      core.resume();
    }, 300);
  }
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
      
      // Mostrar mensaje apropiado según auto-repetición
      if (autoRepeatEnabled) {
        core.osd(`⏸️ Pausa: Play para continuar (${currentRepeatCount}/${autoRepeatTimes})`);
        // Ejecutar auto-repetición después de pausar
        handleAutoRepeat();
      } else {
        core.osd("⏸️ Pausa: Play para siguiente subtítulo");
      }
      
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
        
        // Si no estamos en modo auto-repetición, resetear el contador
        if (!isAutoRepeating) {
          currentRepeatCount = 0;
          console.log(`*** Nuevo sub por POLLING: fin=${currentSubEnd.toFixed(2)}s (contador reset) ***`);
        } else {
          isAutoRepeating = false;
          console.log(`*** Nuevo sub por POLLING: fin=${currentSubEnd.toFixed(2)}s (después de repetición) ***`);
        }
        
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
  if (sid <= 0 && command !== "toggle" && command !== "toggle-autorepeat") {
    core.osd("❌ No hay subtítulos activos para navegar");
    return;
  }
  
  switch(command) {
    case "next":
      currentRepeatCount = 0;
      mpv.command("sub-seek", ["1"]);
      console.log("*** Avanzar: Siguiente subtítulo (manual) ***");
      core.osd("⏭️ Siguiente subtítulo");
      core.resume();
      break;
    case "repeat":
      mpv.command("sub-seek", ["0"]);
      console.log("*** Repetir: Seek a inicio subtítulo actual ***");
      core.osd("🔄 Repitiendo subtítulo actual");
      core.resume();
      break;
    case "previous":
      currentRepeatCount = 0;
      mpv.command("sub-seek", ["-1"]);
      console.log("*** Retroceder: Subtítulo anterior (manual) ***");
      core.osd("⏮️ Subtítulo anterior");
      core.resume();
      break;
    case "toggle":
      pluginEnabled = !pluginEnabled;
      const status = pluginEnabled ? "ACTIVADO ✅" : "DESACTIVADO ❌";
      console.log(`Plugin: ${status}`);
      core.osd(`Pausa-subs: ${status}`);
      if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
      break;
    case "toggle-autorepeat":
      autoRepeatEnabled = !autoRepeatEnabled;
      // Guardar la preferencia
      preferences.set("autoRepeatEnabled", autoRepeatEnabled);
      preferences.sync();
      
      const arStatus = autoRepeatEnabled ? "ACTIVADA ✅" : "DESACTIVADA ❌";
      console.log(`Auto-repetición: ${arStatus} (${autoRepeatTimes} veces)`);
      core.osd(`Auto-repetición: ${arStatus}\nRepeticiones: ${autoRepeatTimes}`);
      currentRepeatCount = 0;
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
    
    // Si no estamos en modo auto-repetición, resetear el contador
    if (!isAutoRepeating) {
      currentRepeatCount = 0;
      console.log(`*** Nuevo sub por EVENTO: inicio=${subStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s (contador reset) ***`);
    } else {
      isAutoRepeating = false;
      console.log(`*** Nuevo sub por EVENTO: inicio=${subStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s (después de repetición) ***`);
    }
    
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

// Registrar teclas
input.onKeyDown("p", () => {
  console.log("Tecla P detectada - Toggle plugin");
  handleSubtitleNavigation("toggle");
  return true;
});

input.onKeyDown("a", () => {
  console.log("Tecla A detectada - Subtítulo anterior");
  handleSubtitleNavigation("previous");
  return true;
});

input.onKeyDown("s", () => {
  console.log("Tecla S detectada - Repetir subtítulo");
  handleSubtitleNavigation("repeat");
  return true;
});

input.onKeyDown("d", () => {
  console.log("Tecla D detectada - Siguiente subtítulo");
  handleSubtitleNavigation("next");
  return true;
});

input.onKeyDown("r", () => {
  console.log("Tecla R detectada - Toggle auto-repetición");
  handleSubtitleNavigation("toggle-autorepeat");
  return true;
});

// Registrar comandos MPV
try {
  mpv.registerScriptMessageHandler("subtitle-previous", () => {
    console.log("Comando MPV: subtitle-previous");
    handleSubtitleNavigation("previous");
  });
  
  mpv.registerScriptMessageHandler("subtitle-repeat", () => {
    console.log("Comando MPV: subtitle-repeat");
    handleSubtitleNavigation("repeat");
  });
  
  mpv.registerScriptMessageHandler("subtitle-next", () => {
    console.log("Comando MPV: subtitle-next");
    handleSubtitleNavigation("next");
  });
  
  mpv.registerScriptMessageHandler("subtitle-toggle", () => {
    console.log("Comando MPV: subtitle-toggle");
    handleSubtitleNavigation("toggle");
  });

  mpv.registerScriptMessageHandler("subtitle-toggle-autorepeat", () => {
    console.log("Comando MPV: subtitle-toggle-autorepeat");
    handleSubtitleNavigation("toggle-autorepeat");
  });
  
  console.log("Comandos MPV registrados correctamente");
  
} catch (e) {
  console.log("Error registrando comandos MPV:", e.message);
}

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  lastSubText = "";
  currentRepeatCount = 0;
  isAutoRepeating = false;
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  
  loadSettings(() => {
    console.log(`Settings cargados:`);
    console.log(`  - Margen: ${pauseMargin}s`);
    console.log(`  - Chequeo: ${checkIntervalMs}ms`);
    console.log(`  - Polling: ${pollIntervalMs}ms`);
    console.log(`  - Offset: ${timeOffset}s`);
    console.log(`  - Auto-repetición: ${autoRepeatEnabled ? 'ON' : 'OFF'}`);
    console.log(`  - Repeticiones: ${autoRepeatTimes}`);
    
    core.osd(`📺 Plugin de Subtítulos Activo

Controles:
• P = Toggle plugin
• A/S/D = Anterior/Repetir/Siguiente
• R = Toggle Auto-repetición

Auto-repetición: ${autoRepeatEnabled ? '✅ ON' : '❌ OFF'} (${autoRepeatTimes}x)`);
    
    if (sid > 0) startPolling();
  });
});

// Inicializar
loadSettings(() => {
  console.log("=================================");
  console.log("Plugin de Subtítulos v2.1 Iniciado");
  console.log("=================================");
  console.log("CONFIGURACIÓN:");
  console.log(`  Margen: ${pauseMargin}s`);
  console.log(`  Chequeo: ${checkIntervalMs}ms`);
  console.log(`  Polling: ${pollIntervalMs}ms`);
  console.log(`  Offset: ${timeOffset}s`);
  console.log(`  Auto-repetición: ${autoRepeatEnabled ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`  Número de repeticiones: ${autoRepeatTimes}`);
  console.log("");
  console.log("CONTROLES:");
  console.log("  P = Toggle plugin");
  console.log("  A = Anterior");
  console.log("  S = Repetir");
  console.log("  D = Siguiente");
  console.log("  R = Toggle Auto-repetición");
  console.log("=================================");
});

// Limpieza al descargar el plugin
event.on("iina.plugin-will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  
  console.log("Plugin descargado.");
});