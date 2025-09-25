const { console, core, event, mpv } = iina;

// Variables
let checkInterval = null;
let currentSubEnd = 0;
let pluginEnabled = true; // Flag para activar/desactivar (puedes togglear con 'p' por ejemplo)

// Función para pausar antes del siguiente subtítulo
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const pauseMargin = 0.2; // Pausa 0.2s antes del fin
  console.log(`Configurando pausa para subtítulo que termina en ${currentSubEnd.toFixed(2)}s (margen: ${pauseMargin}s)`);

  checkInterval = setInterval(() => {
    const currentTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid"); // ID de pista de subtítulos

    console.log(`Chequeo: tiempo=${currentTime.toFixed(2)}s, pausa=${isPaused}, vis=${subVisibility}, sid=${sid}, fin_sub=${currentSubEnd.toFixed(2)}s`);

    if (!isPaused && subVisibility && sid > 0 && currentTime >= (currentSubEnd - pauseMargin)) {
      core.command("set pause yes");
      console.log(`*** PAUSADO AUTOMÁTICO a los ${currentTime.toFixed(2)}s (antes de fin: ${currentSubEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Presiona play para siguiente subtítulo", "info");
      clearInterval(checkInterval);
    }
  }, 100); // Cada 100ms para menos logs/CPU
}

// Escucha cambios en el texto del subtítulo (inicio de nuevo subtítulo)
event.on("mpv.sub-text.changed", () => {
  const subText = mpv.getString("sub-text");
  const sid = mpv.getNumber("sid");
  console.log(`*** EVENTO sub-text.changed detectado! Texto: "${subText.substring(0, 50)}...", SID: ${sid}`);

  if (subText && subText.trim() !== "" && sid > 0) {
    currentSubEnd = mpv.getNumber("sub-end");
    console.log(`Nuevo subtítulo detectado. Fin en: ${currentSubEnd.toFixed(2)}s`);
    if (pluginEnabled) {
      setupPauseBeforeNextSub();
    }
  } else {
    console.log("Subtítulo vacío o no activo, ignorando.");
  }
});

// Log cuando se presiona play (para ver avances manuales)
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual presionado. Reiniciando chequeo si hay subtítulo activo. ***");
    const currentSub = mpv.getString("sub-text");
    if (currentSub && currentSub.trim() !== "") {
      currentSubEnd = mpv.getNumber("sub-end");
      if (pluginEnabled) setupPauseBeforeNextSub();
    }
  }
});

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  if (checkInterval) clearInterval(checkInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Sub vis: ${subVis}`);
  core.osd("Plugin de pausa: Activo. Chequea consola para logs.", "info");
});

// Toggle con tecla 'P' (opcional, para desactivar temporalmente)
event.on("mpv.key-press", (event) => {
  if (event.key === "P") { // Mayúscula P
    pluginEnabled = !pluginEnabled;
    const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
    console.log(`Plugin ${status}`);
    core.osd(`Pausa antes de subs: ${status}`, "info");
  }
});

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  console.log("Plugin descargado.");
});