/* ============================================================
   ROBOCONTROL — app.js  (Mobile / Android version)
   Arduino Mega + HC-06 + HC-SR04
   ============================================================ */
'use strict';

// ─── State ───────────────────────────────────────────────────
const S = {
  connected:    false,
  mode:         'manual',
  speed:        150,
  distance:     0,
  cmdCount:     0,
  obstCount:    0,
  startTime:    null,
  activeCmd:    null,
  moveTimer:    null,
  simTimer:     null,
  timerTick:    null,
  device:       null,
  charRx:       null,
};

// BLE UUIDs for HC-06 SPP-over-BLE
const SVC  = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb';

// Distance ring-buffer for chart
const hist = new Array(34).fill(0);

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  startSimulation();
  startClock();
  
  // Soporte para teclado en Laptop
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  log('Sistema listo.', 'info');
  log('Usar Chrome/Edge para Web Bluetooth.', 'info');
  updateTele();
});

// ─── Bluetooth ───────────────────────────────────────────────
async function connectBluetooth() {
  const btn = document.getElementById('btnConnect');

  // Disconnect if already connected
  if (S.connected) {
    doDisconnect();
    return;
  }

  // Check API
  if (!navigator.bluetooth) {
    log('⚠ Web Bluetooth no disponible. Abre en Chrome Android.', 'error');
    demoFeedback();
    return;
  }

  try {
    btn.disabled = true;
    btn.innerHTML = '⏳ Conectando…';
    log('Buscando HC-06…', 'info');

    S.device = await navigator.bluetooth.requestDevice({
      filters: [
        { name: 'HC-06' }, { name: 'HC06' },
        { namePrefix: 'HC' }, { services: [SVC] }
      ],
      optionalServices: [SVC]
    });

    S.device.addEventListener('gattserverdisconnected', onBtDrop);
    log(`Encontrado: ${S.device.name || 'HC-06'}`, 'ok');

    const server = await S.device.gatt.connect();
    const svc    = await server.getPrimaryService(SVC);
    S.charRx     = await svc.getCharacteristic(CHAR);

    await S.charRx.startNotifications();
    S.charRx.addEventListener('characteristicvaluechanged', onData);

    onBtConnect();
  } catch (e) {
    if (e.name !== 'NotFoundError') log(`Error: ${e.message}`, 'error');
    else log('Búsqueda cancelada.', 'warn');
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M13 3L4 14h7l-1 7 9-11h-7l1-10z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg> Conectar HC-06`;
  }
}

function onBtConnect() {
  S.connected = true;
  S.startTime = Date.now();
  stopSimulation();
  setConnectedUI(true);
  log(`✅ Conectado: ${S.device.name || 'HC-06'}`, 'ok');
  document.getElementById('btMac').textContent =
    S.device.id ? S.device.id.slice(-17).toUpperCase() : '—';
}

function onBtDrop() {
  S.connected = false;
  setConnectedUI(false);
  log('⚠ Dispositivo desconectado.', 'warn');
  startSimulation();
}

function doDisconnect() {
  if (S.device?.gatt?.connected) S.device.gatt.disconnect();
}

function onData(e) {
  const txt = new TextDecoder().decode(e.target.value).trim();
  if (txt.startsWith('D:')) updateDist(parseInt(txt.slice(2)) || 0);
}

// ─── Send command ────────────────────────────────────────────
async function sendCommand(cmd) {
  updateDirLabel(cmd);
  S.cmdCount++;
  updateTele();

  if (!S.connected) {
    log(`[DEMO] ${cmdLabel(cmd)}`, 'cmd');
    return;
  }
  try {
    const data = new TextEncoder().encode(cmd);
    // Muchos módulos BLE (como HM-10) requieren escribir sin esperar respuesta
    if (S.charRx.properties.writeWithoutResponse) {
      await S.charRx.writeValueWithoutResponse(data);
    } else {
      await S.charRx.writeValue(data);
    }
    log(`→ ${cmdLabel(cmd)}`, 'cmd');
  } catch (e) { 
    log(`Error: ${e.message}`, 'error'); 
  }
}

const cmdLabel = c => ({ F:'AVANZAR', B:'RETROCEDER', L:'IZQUIERDA', R:'DERECHA', S:'DETENER', A:'MODO AUTO', M:'MODO MANUAL' }[c] || c);

// ─── D-Pad touch handling ─────────────────────────────────────
function startMove(cmd, e) {
  e.preventDefault();
  if (S.mode !== 'manual') return;
  if (S.activeCmd === cmd) return;
  S.activeCmd = cmd;
  sendCommand(cmd);
  setDpadActive(cmd, true);
  clearInterval(S.moveTimer);
  S.moveTimer = setInterval(() => sendCommand(cmd), 220);
}

function stopMove(e) {
  if (e) e.preventDefault();
  clearInterval(S.moveTimer); S.moveTimer = null;
  if (S.activeCmd) { setDpadActive(S.activeCmd, false); S.activeCmd = null; }
  sendCommand('S');
}

function setDpadActive(cmd, on) {
  const map = { F:'dpUp', B:'dpDown', L:'dpLeft', R:'dpRight' };
  const el = document.getElementById(map[cmd]);
  if (el) el.classList.toggle('on', on);
}

// ─── Keyboard (Laptop) ────────────────────────────────────────
const keyMap = { w:'F', a:'L', s:'S', d:'R', x:'B', 
                 ArrowUp:'F', ArrowLeft:'L', ArrowRight:'R', ArrowDown:'B' };
const activeKeys = new Set();

function onKeyDown(e) {
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  const cmd = keyMap[e.key.toLowerCase()] || keyMap[e.key];
  if (!cmd || activeKeys.has(e.key)) return;
  
  activeKeys.add(e.key);
  if (cmd === 'S') {
    sendCommand('S');
  } else {
    // Simulamos el evento para reutilizar la función de movimiento
    startMove(cmd, { preventDefault: () => e.preventDefault() });
  }
}

function onKeyUp(e) {
  const cmd = keyMap[e.key.toLowerCase()] || keyMap[e.key];
  if (!cmd || !activeKeys.has(e.key)) return;
  
  activeKeys.delete(e.key);
  if (cmd !== 'S') stopMove({ preventDefault: () => e.preventDefault() });
}

// ─── Mode ─────────────────────────────────────────────────────
function setMode(m) {
  S.mode = m;
  const track  = document.getElementById('modeTrack');
  const btnM   = document.getElementById('btnManual');
  const btnA   = document.getElementById('btnAuto');
  const desc   = document.getElementById('modeDesc');
  const telM   = document.getElementById('teleMode');

  if (m === 'manual') {
    track.classList.remove('right');
    btnM.classList.add('active'); btnA.classList.remove('active');
    desc.textContent = 'Control directo por joystick táctil. Comandos en tiempo real.';
    telM.textContent = 'MAN';
    sendCommand('M');
    log('Modo MANUAL activado.', 'ok');
  } else {
    track.classList.add('right');
    btnA.classList.add('active'); btnM.classList.remove('active');
    desc.textContent = 'El robot evita obstáculos automáticamente con el sensor HC-SR04.';
    telM.textContent = 'AUTO';
    sendCommand('A');
    log('Modo AUTOMÁTICO activado.', 'ok');
  }
}

// ─── Speed ────────────────────────────────────────────────────
function updateSpeed(v) {
  S.speed = +v;
  document.getElementById('speedNum').textContent = v;
  if (S.connected) sendCommand(`V${v}`);
}

// ─── Distance / Sensor ────────────────────────────────────────
function updateDist(d) {
  S.distance = d;
  const ratio = Math.min(d / 400, 1);

  // Gauge
  document.getElementById('gaugeNum').textContent = d;
  const arc = document.getElementById('gaugeArc');
  arc.setAttribute('stroke-dashoffset', (226 - ratio * 226).toFixed(1));

  // Text
  document.getElementById('distVal').textContent = `${d} cm`;

  // Proximity bar (inverted)
  document.getElementById('proxFill').style.width = `${Math.max(0, 100 - ratio * 100)}%`;

  // Obstacle status
  const el = document.getElementById('obstState');
  if (d < 15) {
    el.textContent = '⚠ OBSTÁCULO'; el.className = 'stat-val red';
    S.obstCount++;
  } else if (d < 30) {
    el.textContent = '⚡ Cerca'; el.className = 'stat-val amber';
  } else {
    el.textContent = '✓ Libre'; el.className = 'stat-val green';
  }

  hist.push(d); hist.shift();
  drawChart();
  updateTele();
}

// ─── Simulation ───────────────────────────────────────────────
let simPh = 0;
function startSimulation() {
  if (S.simTimer) return;
  S.simTimer = setInterval(() => {
    simPh += 0.07;
    updateDist(Math.max(5, Math.round(60 + Math.sin(simPh) * 45 + Math.random() * 8)));
  }, 320);
}
function stopSimulation() { clearInterval(S.simTimer); S.simTimer = null; }

// ─── Chart ────────────────────────────────────────────────────
let ctx;
function initChart() {
  const c = document.getElementById('distChart');
  ctx = c.getContext('2d');
  // Set canvas internal size to match CSS
  c.width  = c.offsetWidth  || 340;
  c.height = c.offsetHeight || 56;
}

function drawChart() {
  if (!ctx) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const max = 200, step = W / (hist.length - 1);

  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(22,40,64,.9)'; ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  // Fill
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(0,212,255,.22)');
  gr.addColorStop(1, 'rgba(0,212,255,0)');

  ctx.beginPath();
  hist.forEach((v, i) => {
    const x = i * step, y = H - (Math.min(v, max) / max) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = gr; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1.8;
  ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 5;
  hist.forEach((v, i) => {
    const x = i * step, y = H - (Math.min(v, max) / max) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke(); ctx.shadowBlur = 0;
}

// ─── Clock ────────────────────────────────────────────────────
function startClock() {
  S.timerTick = setInterval(() => {
    if (!S.startTime) return;
    const s = Math.floor((Date.now() - S.startTime) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    document.getElementById('teleTime').textContent = `${mm}:${ss}`;
  }, 1000);
}

// ─── Telemetry ────────────────────────────────────────────────
function updateTele() {
  document.getElementById('teleCmds').textContent = S.cmdCount;
  document.getElementById('teleObst').textContent = S.obstCount;
}

// ─── Direction label ──────────────────────────────────────────
function updateDirLabel(cmd) {
  const el = document.getElementById('dirLabel');
  const labels = { F:'▲ AVANZAR', B:'▼ RETROCEDER', L:'◀ IZQUIERDA', R:'▶ DERECHA', S:'■ DETENIDO' };
  el.textContent = labels[cmd] || cmd;
  el.classList.toggle('active', cmd !== 'S');
}

// ─── Scan (simulated) ─────────────────────────────────────────
async function scanDevices() {
  const btn = document.getElementById('btnScan');
  const res = document.getElementById('scanResults');
  const lst = document.getElementById('deviceList');

  btn.disabled = true;
  btn.innerHTML = '⏳ Escaneando…';
  log('Buscando dispositivos Bluetooth…', 'info');

  await delay(1400);

  const found = [
    { name: 'HC-06',      mac: 'AA:BB:CC:11:22:33', rssi: '-50 dBm' },
    { name: 'HC-05',      mac: 'AA:BB:CC:44:55:66', rssi: '-63 dBm' },
    { name: 'Arduino-BT', mac: 'AA:BB:CC:77:88:99', rssi: '-78 dBm' },
  ];

  lst.innerHTML = '';
  found.forEach(d => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${d.name}<br><small style="color:#2a4560;font-family:monospace">${d.mac}</small></span><span class="dev-rssi">${d.rssi}</span>`;
    li.addEventListener('click', () => connectBluetooth());
    lst.appendChild(li);
  });

  res.style.display = 'block';
  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Buscar`;
  log(`${found.length} dispositivos encontrados.`, 'ok');
}

// ─── Connected UI ─────────────────────────────────────────────
function setConnectedUI(on) {
  const dot    = document.getElementById('statusDot');
  const lbl    = document.getElementById('statusLabel');
  const ring   = document.getElementById('btRing');
  const btTxt  = document.getElementById('btStatusText');
  const badge  = document.getElementById('btBadge');
  const btn    = document.getElementById('btnConnect');

  dot.classList.toggle('on', on);
  lbl.textContent = on ? 'Conectado' : 'Desconectado';
  ring.classList.toggle('on', on);
  btTxt.textContent = on ? 'Conectado ✓' : 'Desconectado';
  badge.classList.toggle('connected', on);

  if (on) {
    btn.disabled = false;
    btn.className = 'btn btn-outline';
    btn.style.borderColor = 'rgba(255,68,85,.4)';
    btn.style.color = '#ff7788';
    btn.innerHTML = '✕ Desconectar';
  } else {
    btn.className = 'btn btn-primary';
    btn.style.cssText = '';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M13 3L4 14h7l-1 7 9-11h-7l1-10z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg> Conectar HC-06`;
    document.getElementById('btMac').textContent = '—';
  }
}

// ─── Demo feedback ────────────────────────────────────────────
function demoFeedback() {
  log('▶ Modo DEMO — comandos simulados activos.', 'warn');
}

// ─── Log ──────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const wrap = document.getElementById('logWrap');
  const now  = new Date();
  const t    = `${h2(now.getHours())}:${h2(now.getMinutes())}:${h2(now.getSeconds())}`;
  const el   = document.createElement('div');
  el.className = `log-line log-${type}`;
  el.textContent = `[${t}] ${msg}`;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  while (wrap.children.length > 80) wrap.removeChild(wrap.firstChild);
}

function clearLog() {
  document.getElementById('logWrap').innerHTML = '';
  log('Log limpiado.', 'info');
}

// ─── Copy Arduino code ────────────────────────────────────────
function copyCode() {
  const code = `// ── Robot Arduino Mega + HC-06 + HC-SR04 ──
#include <SoftwareSerial.h>

SoftwareSerial bt(10, 11);   // RX=10, TX=11

// ── Pines HC-SR04 ──
const int TRIG = 7, ECHO = 8;

// ── Pines L298N ──
const int ENA=3, IN1=4, IN2=5;
const int ENB=6, IN3=22, IN4=23;

int  spd  = 150;
char mode = 'M';   // M = Manual, A = Auto

// ── Setup ──
void setup() {
  bt.begin(9600);
  Serial.begin(9600);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  int pins[] = {ENA,IN1,IN2,ENB,IN3,IN4};
  for (int p : pins) pinMode(p, OUTPUT);
}

// ── Sensor ──
long getDist() {
  digitalWrite(TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  return pulseIn(ECHO, HIGH) * 0.034 / 2;
}

// ── Motores ──
void forward()  { analogWrite(ENA,spd); analogWrite(ENB,spd); digitalWrite(IN1,1); digitalWrite(IN2,0); digitalWrite(IN3,1); digitalWrite(IN4,0); }
void backward() { analogWrite(ENA,spd); analogWrite(ENB,spd); digitalWrite(IN1,0); digitalWrite(IN2,1); digitalWrite(IN3,0); digitalWrite(IN4,1); }
void left()     { analogWrite(ENA,spd); analogWrite(ENB,spd); digitalWrite(IN1,0); digitalWrite(IN2,1); digitalWrite(IN3,1); digitalWrite(IN4,0); }
void right()    { analogWrite(ENA,spd); analogWrite(ENB,spd); digitalWrite(IN1,1); digitalWrite(IN2,0); digitalWrite(IN3,0); digitalWrite(IN4,1); }
void stopAll()  { digitalWrite(IN1,0); digitalWrite(IN2,0); digitalWrite(IN3,0); digitalWrite(IN4,0); }

void exec(char c) {
  switch(c) {
    case 'F': forward();  break;
    case 'B': backward(); break;
    case 'L': left();     break;
    case 'R': right();    break;
    case 'S': stopAll();  break;
    case 'V': spd = bt.parseInt(); break;
  }
}

void autoNav(long d) {
  if (d < 30) {
    stopAll(); delay(300);
    backward(); delay(500);
    left();     delay(400);
  } else { forward(); }
}

// ── Loop ──
void loop() {
  long d = getDist();
  bt.print("D:"); bt.println(d);
  if (bt.available()) {
    char c = bt.read();
    if      (c == 'A') mode = 'A';
    else if (c == 'M') mode = 'M';
    else if (mode == 'M') exec(c);
  }
  if (mode == 'A') autoNav(d);
  delay(100);
}`;

  navigator.clipboard.writeText(code).then(() => {
    log('✅ Código Arduino copiado.', 'ok');
  }).catch(() => {
    log('No se pudo copiar (requiere HTTPS).', 'warn');
  });
}

// ─── Util ─────────────────────────────────────────────────────
const h2    = n => String(n).padStart(2, '0');
const delay = ms => new Promise(r => setTimeout(r, ms));
