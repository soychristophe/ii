const { console, core, event, mpv } = iina;

let repeatCount = 0;
let maxRepeats = 3;

// Función que repite el subtítulo actual o avanza al siguiente
function repeatOrNext() {
  if (repeatCount < maxRepeats) {
    mpv.command("sub-seek", ["0"]); // Repetir subtítulo actual
    core.osd(`🔄 Repetición ${repeatCount + 1}/${maxRepeats}`);
    core.resume();
    repeatCount++;
  } else {
    mpv.command("sub-seek", ["1"]); // Pasar al siguiente subtítulo
    core.osd("⏭️ Siguiente subtítulo");
    core.resume();
    repeatCount = 0; // Reiniciar para el próximo subtítulo
  }
}

// Cada vez que empieza un subtítulo
event.on("mpv.sub-start.changed", () => {
  repeatCount = 0;
  // Esperar un instante y arrancar el ciclo
  setTimeout(() => {
    repeatOrNext();
  }, 200);
});

// Limpieza
event.on("iina.plugin-will-unload", () => {
  console.log("Plugin descargado.");
});
