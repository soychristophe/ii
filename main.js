const { console, core, event, mpv, preferences, input, menu } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;
let remainingPlays = 1;

// Defaults
let pauseMargin = 0.0;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;
let autoRepeatEnabled = false;
let repeatTimes = 2;

// Cargar settings ASÍNCRONAMENTE
function loadSettings(callback) {
  let loaded = 0;
  const total = 6;

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

  preferences.get("autoRepeat", (value) => {
    autoRepeatEnabled = value === true || value === "true";
    checkLoaded();
  });

  preferences.get("repeatTimes", (value) => {
    repeatTimes = parseInt(value) || 2;
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
      if (autoRepeatEnabled && remainingPlays > 1) {
        const thisRepeatNum = repeatTimes - remainingPlays + 1;
        console.log(`*** Repitiendo subtítulo ${thisRepeatNum}/${repeatTimes} a ${nowTime.toFixed(2)}s ***`);
        mpv.command("sub-seek", ["0"]);
        remainingPlays--;
        core.resume();
        clearInterval(checkInterval);
        setupPauseBeforeNextSub();
      } else if (autoRepeatEnabled && remainingPlays === 1) {
        console.log(`*** Última reproducción completada a ${nowTime.toFixed(2)}s. Continuando al siguiente... ***`);
        clearInterval(checkInterval);
      } else {
        core.pause();
        console.log(`*** PAUSADO ANTES DEL SIGUIENTE a ${nowTime.toFixed(2)}s (fin: ${adjustedEnd.toFixed(2)}s) ***`);
        core.osd("⏸️ Pausa: Play para siguiente subtítulo");
        clearInterval(checkInterval);
      }
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
          remainingPlays = autoRepeatEnabled ? repeatTimes : 1;
          setupPauseBeforeNextSub();
        }
      }
    }, 50);
  }, pollIntervalMs);
}

// Función helper para navegar subtítulos (ACTUALIZADA: usa sub-seek para mover video time y resume playback)
function handleSubtitleNavigation(command) {
  const sid = mpv.getNumber("sid");
  if (sid <= 0) {
    core.osd("❌ No hay subtítulos activos para navegar", "warning");
    return;
  }
  
  switch(command) {
    case "next":
      mpv.command("sub-seek", ["1"]);
      console.log("*** Avanzar: Siguiente subtítulo (seek video) ***");
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
      mpv.command("sub-seek", ["-1"]);
      console.log("*** Retroceder: Subtítulo anterior (seek video) ***");
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
      remainingPlays = autoRepeatEnabled ? repeatTimes : 1;
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

// Registrar tecla P para toggle
input.onKeyDown("p", (data) => {
  console.log("Tecla P detectada - Toggle plugin");
  handleSubtitleNavigation("toggle");
  return true; // Indica que manejamos el evento
});

// Registrar teclas A, S, D
input.onKeyDown("a", (data) => {
  console.log("Tecla A detectada - Subtítulo anterior");
  handleSubtitleNavigation("previous");
  return true;
});

input.onKeyDown("s", (data) => {
  console.log("Tecla S detectada - Repetir subtítulo");
  handleSubtitleNavigation("repeat");
  return true;
});

input.onKeyDown("d", (data) => {
  console.log("Tecla D detectada - Siguiente subtítulo");
  handleSubtitleNavigation("next");
  return true;
});

// MÉTODO 2: Si lo anterior no funciona, intentar con el menú API
// Usar el módulo menu para registrar comandos con atajos
try {
  if (menu && menu.addItem) {
    console.log("Intentando registrar items de menú con atajos...");
    
    menu.addItem({
      title: "Plugin: Toggle On/Off",
      action: () => handleSubtitleNavigation("toggle"),
      key: "Ctrl+Shift+P",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "p"
    });
    
    menu.addItem({
      title: "Subtítulo Anterior",
      action: () => handleSubtitleNavigation("previous"),
      key: "Ctrl+Shift+A",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "a"
    });
    
    menu.addItem({
      title: "Repetir Subtítulo",
      action: () => handleSubtitleNavigation("repeat"),
      key: "Ctrl+Shift+S",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "s"
    });
    
    menu.addItem({
      title: "Siguiente Subtítulo",
      action: () => handleSubtitleNavigation("next"),
      key: "Ctrl+Shift+D",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "d"
    });
    
    console.log("Items de menú registrados con éxito");
  }
} catch (e) {
  console.log("No se pudieron registrar items de menú:", e.message);
}

// MÉTODO 3: Usar comandos MPV personalizados
// Registrar comandos personalizados que puedan ser mapeados en IINA
try {
  // Registrar comandos script-message que pueden ser vinculados en IINA
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
  
  console.log("Comandos MPV registrados. Puedes mapearlos en IINA:");
  console.log("- script-message subtitle-previous");
  console.log("- script-message subtitle-repeat");
  console.log("- script-message subtitle-next");
  console.log("- script-message subtitle-toggle");
  
} catch (e) {
  console.log("Error registrando comandos MPV:", e.message);
}

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  lastSubText = "";
  remainingPlays = 1;
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  
  loadSettings(() => {
    console.log(`Settings: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, Polling=${pollIntervalMs}ms, Offset=${timeOffset}s, AutoRepeat=${autoRepeatEnabled ? 'Sí (' + repeatTimes + ' veces)' : 'No'}`);
    
    // Mostrar instrucciones detalladas
    let instructions = `📺 Plugin de Subtítulos Activo\n\nIntenta estas opciones:\n1) Teclas directas: P, A, S, D\n2) Con menú: Ctrl+Shift+P/A/S/D\n3) Configura en IINA Preferences:\n   - script-message subtitle-previous\n   - script-message subtitle-repeat\n   - script-message subtitle-next`;
    if (autoRepeatEnabled) {
      instructions += `\n\n🔄 Auto-repeat ACTIVADO (${repeatTimes} veces total por subtítulo)`;
    }
    core.osd(instructions);
    
    if (sid > 0) startPolling();
  });
});

// Debug: Mostrar todas las teclas registradas
setTimeout(() => {
  try {
    const bindings = input.getAllKeyBindings();
    console.log("=== TECLAS YA REGISTRADAS EN IINA ===");
    Object.keys(bindings).forEach(key => {
      if (key.toLowerCase().includes('a') || 
          key.toLowerCase().includes('s') || 
          key.toLowerCase().includes('d') || 
          key.toLowerCase().includes('p') ||
          key === '1' || key === '2' || key === '3') {
        console.log(`Tecla "${key}": ${JSON.stringify(bindings[key])}`);
      }
    });
    console.log("=====================================");
  } catch (e) {
    console.log("No se pudo obtener key bindings:", e.message);
  }
}, 1000);

// Inicializar
loadSettings(() => {
  console.log("=================================");
  console.log("Plugin de Subtítulos v2.0 Iniciado");
  console.log("=================================");
  console.log("MÉTODOS DE CONTROL DISPONIBLES:");
  console.log("");
  console.log("1. TECLAS DIRECTAS (si funcionan):");
  console.log("   P = Toggle plugin");
  console.log("   A = Anterior");
  console.log("   S = Repetir");
  console.log("   D = Siguiente");
  console.log("");
  console.log("2. ATAJOS DE MENÚ:");
  console.log("   Ctrl+Shift+P = Toggle");
  console.log("   Ctrl+Shift+A = Anterior");
  console.log("   Ctrl+Shift+S = Repetir");
  console.log("   Ctrl+Shift+D = Siguiente");
  console.log("");
  console.log("3. COMANDOS MPV (configurar en IINA):");
  console.log("   script-message subtitle-previous");
  console.log("   script-message subtitle-repeat");
  console.log("   script-message subtitle-next");
  console.log("   script-message subtitle-toggle");
  if (autoRepeatEnabled) {
    console.log("");
    console.log(`🔄 Auto-repeat: ${repeatTimes} veces total por subtítulo`);
  }
  console.log("=================================");
});

// Limpieza al descargar el plugin
event.on("iina.plugin-will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  
  // Limpiar handlers
  try {
    input.onKeyDown("p", null);
    input.onKeyDown("a", null);
    input.onKeyDown("s", null);
    input.onKeyDown("d", null);
  } catch (e) {
    console.log("Error limpiando key handlers:", e.message);
  }
  
  console.log("Plugin descargado.");
});