// Генерация иконок из фирменного знака WPlan (пути взяты с сайта).
// Рендер через offscreen BrowserWindow (canvas → PNG), запись в assets/.
// Запуск: npx electron scripts/gen-logo-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICONSET = path.join(ASSETS, 'appIcon.iconset');

const D1 = "M93.044 116H23.236C10.471 116 0 105.554 0 92.82V23.18C0 10.446 10.471 0 23.236 0h69.808c12.765 0 23.236 10.446 23.236 23.18v69.64c0 12.734-10.471 23.18-23.236 23.18Z";
const D2 = "M109.012 74.128h-.582l-23.837-20.93c-.29-.291-1.163 0-.872.581l7.849 30.814c0 .29 0 .581-.29.581L73.255 96.512h-.582L24.71 56.105c-.29-.291-.29-.872 0-.872l16.86-10.756h.582L68.023 66.86c.291.29 1.163 0 .872-.582l-8.43-33.14c0-.29 0-.58.29-.58l15.408-9.594h.581l25.872 22.674c.291.291 1.163 0 .872-.58l-8.72-33.431c0-.29 0-.582.29-.582l11.047-6.976C102.326 1.453 97.965 0 93.023 0H23.256C10.466 0 0 10.465 0 23.256v69.767c0 12.791 10.465 23.256 23.256 23.256h69.767c12.791 0 23.256-10.465 23.256-23.256V69.768l-7.267 4.36Z";

// Функция рендера выполняется В СТРАНИЦЕ (имеет доступ к canvas).
const PAGE_FN = `
const D1=${JSON.stringify(D1)}, D2=${JSON.stringify(D2)};
const P1=new Path2D(D1), P2=new Path2D(D2);
// Монохромный глиф «W» (штрихи): squircle минус (squircle без W-каналов).
function glyph(size, color, factor){
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const g=c.getContext('2d'); const s=size/116; g.setTransform(s,0,0,s,0,0);
  g.fillStyle=color||'#000'; g.fill(P1);
  g.globalCompositeOperation='destination-out'; g.fill(P2);
  // Срезаем тонкие дуги по углам (несовпадение контуров d1/d2): маска по чуть
  // уменьшенному squircle вокруг центра.
  g.globalCompositeOperation='destination-in';
  const k=0.95, off=116*(1-k)/2; g.setTransform(s*k,0,0,s*k,s*off,s*off); g.fill(P1);
  if(factor&&factor<1){ g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-over';
    const d=g.getImageData(0,0,size,size); for(let i=3;i<d.data.length;i+=4) d.data[i]=Math.round(d.data[i]*factor); g.putImageData(d,0,0);}
  return c;
}
// Цветная app-иконка: синий squircle с белым глифом, padding под squircle macOS.
function appIcon(size){
  const pad=Math.round(size*0.1), inner=size-pad*2;
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const g=c.getContext('2d'); g.translate(pad,pad); const s=inner/116; g.save(); g.scale(s,s);
  g.fillStyle='#4C63E6'; g.fill(P1); g.restore();
  const gl=glyph(inner,'#FFFFFF',1); g.drawImage(gl,0,0);
  return c.toDataURL('image/png').split(',')[1];
}
// Трей-глиф с паддингом (чтобы не упирался в край и не было пикселей по углам).
function tray(size, factor){
  const pad=Math.round(size*0.05), inner=size-pad*2;
  const gl=glyph(inner,'#000',factor);
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  c.getContext('2d').drawImage(gl, pad, pad);
  return c.toDataURL('image/png').split(',')[1];
}
`;

async function run() {
  const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: {} });
  await win.loadURL('data:text/html,<body></body>');
  await win.webContents.executeJavaScript(PAGE_FN + '\ntrue');

  const write = (name, b64) => fs.writeFileSync(path.join(ASSETS, name), Buffer.from(b64, 'base64'));
  const evalJs = (expr) => win.webContents.executeJavaScript(expr);

  // Трей-иконки (template, монохром)
  write('workingTemplate.png', await evalJs('tray(18,1)'));
  write('workingTemplate@2x.png', await evalJs('tray(36,1)'));
  write('idleTemplate.png', await evalJs('tray(18,0.45)'));
  write('idleTemplate@2x.png', await evalJs('tray(36,0.45)'));

  // App-иконка .icns
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const s of sizes) {
    const b = await evalJs(`appIcon(${s})`);
    // имена по требованию iconutil
    if (s <= 512) fs.writeFileSync(path.join(ICONSET, `icon_${s}x${s}.png`), Buffer.from(b, 'base64'));
    if (s >= 32) fs.writeFileSync(path.join(ICONSET, `icon_${s / 2}x${s / 2}@2x.png`), Buffer.from(b, 'base64'));
  }
  try {
    execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', path.join(ASSETS, 'appIcon.icns')]);
    console.log('appIcon.icns создан');
  } catch (e) {
    console.error('iconutil failed:', e.message);
  }
  console.log('иконки сгенерированы в', ASSETS);
  app.quit();
}

app.whenReady().then(run);
