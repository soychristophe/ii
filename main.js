const { console, core, event, mpv } = iina;
// Variables principales
let checkInterval = null;
let currentSubEnd = 0;
let currentSubStart = 0;
let lastSubText = "";
let currentRepeatCount = 0;
let isAutoRepeating = false;
let lastProcessedSubtitle = "";
// Configuración fija
const REPEAT_TIMES = 3;
const CHECK_INTERVAL_MS = 100;
// Función para configurar detección del final del subtítulo
function setupPauseBeforeNextSub() {
if (checkInterval) clearInterval(checkInterval);
const currentTime = mpv.getNumber("playback-time");
if (currentTime > currentSubEnd) {
console.log(Sub ya terminó. Esperando nuevo.);
return;
}
console.log(Configurando detección: inicio=${currentSubStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s);
checkInterval = setInterval(() => {
const nowTime = mpv.getNumber("playback-time");
const isPaused = mpv.getFlag("pause");
const subVisibility = mpv.getFlag("sub-visibility");
const sid = mpv.getNumber("sid");
if (!isPaused && subVisibility && sid > 0 && nowTime >= currentSubEnd && nowTime < currentSubEnd + 1) {
clearInterval(checkInterval);
mpv.set("pause", true);  // Pausar inmediatamente para evitar avance
currentRepeatCount++;
console.log(*** Fin de subtítulo - Repetición ${currentRepeatCount}/${REPEAT_TIMES} ***);
if (currentRepeatCount < REPEAT_TIMES) {
core.osd(🔄 Repitiendo ${currentRepeatCount + 1}/${REPEAT_TIMES});
isAutoRepeating = true;
setTimeout(() => {
mpv.command("seek", [currentSubStart.toString(), "absolute"]);
mpv.set("pause", false);  // Reanudar después del seek
}, 100);
} else {
console.log(*** ${REPEAT_TIMES} repeticiones completadas. Siguiente subtítulo. ***);
core.osd(➡️ Siguiente subtítulo);
currentRepeatCount = 0;
isAutoRepeating = true;
setTimeout(() => {
mpv.command("sub-seek", ["1"]);
mpv.set("pause", false);  // Reanudar después del sub-seek
}, 100);
}
}
}, CHECK_INTERVAL_MS);
}
// Evento: Inicio de subtítulo
event.on("mpv.sub-start.changed", () => {
const subStart = mpv.getNumber("sub-start");
const subText = mpv.getString("sub-text");
const sid = mpv.getNumber("sid");
if (sid > 0 && subText && subText.trim() !== "") {
const subEnd = mpv.getNumber("sub-end");
// Crear ID único (aumentar precisión a toFixed(3) por si hay issues de float)
const subtitleId = ${subStart.toFixed(3)}-${subEnd.toFixed(3)}-${subText.substring(0, 20)};
// Ignorar duplicados
if (subtitleId === lastProcessedSubtitle) {
console.log(Evento duplicado ignorado);
return;
}
currentSubEnd = subEnd;
currentSubStart = subStart;
lastSubText = subText;
// Determinar si es nuevo o repetición
if (!isAutoRepeating) {
currentRepeatCount = 0;
console.log(*** NUEVO SUBTÍTULO: inicio=${subStart.toFixed(2)}s, fin=${subEnd.toFixed(2)}s ***);
} else {
console.log(*** Repetición detectada (contador: ${currentRepeatCount}) ***);
isAutoRepeating = false;
}
lastProcessedSubtitle = subtitleId;
setupPauseBeforeNextSub();
}
});
// Al cargar archivo
event.on("mpv.file-loaded", () => {
currentSubEnd = 0;
currentSubStart = 0;
lastSubText = "";
lastProcessedSubtitle = "";
currentRepeatCount = 0;
isAutoRepeating = false;
if (checkInterval) clearInterval(checkInterval);
const sid = mpv.getNumber("sid");
console.log(Archivo cargado. Subtítulos: ${sid > 0 ? 'SÍ' : 'NO'});
if (sid > 0) {
core.osd(📺 Auto-repetición activada\nCada subtítulo se repetirá ${REPEAT_TIMES} veces);
}
});
// Inicializar
console.log("=================================");
console.log("Plugin Auto-Repetición Subtítulos");
console.log("=================================");
console.log(Cada subtítulo se repetirá ${REPEAT_TIMES} veces automáticamente);
console.log("=================================");
// Limpieza
event.on("iina.plugin-will-unload", () => {
if (checkInterval) clearInterval(checkInterval);
console.log("Plugin descargado.");
});