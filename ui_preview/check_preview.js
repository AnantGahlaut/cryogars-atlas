const fs = require("fs");

const file = process.argv[2];
if (!file) throw new Error("usage: node check_preview.js <html>");

const html = fs.readFileSync(file, "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
if (scripts.length < 2) throw new Error("expected payload and application scripts");

for (const [, attributes, body] of scripts) {
  if (/type=["']application\/json["']/i.test(attributes)) JSON.parse(body);
  else new Function(body);
}

const required = [
  'id="settingsPanel"',
  'id="setTheme"',
  'id="setPrimaryPalette"',
  'snowex-viewer-preferences-v2',
  'LEGACY_PREF_KEYS',
  'savedPalettes',
  'typeActive',
  'id=\'leSaveType\'',
  'id=\'leEditType\'',
  'id=\'leDeleteType\'',
  'id=\'leDeleteConfirm\'',
  'id=\'leSaveTypeNew\'',
  'Use locked default',
  'PREF_WINDOW_PREFIX',
  'id="rangeState"',
  'rangeModes',
  'id=\'iShown\'',
  '.le-presets button.on',
  'w:Math.floor((W-1)/st)+1',
];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`missing ${marker}`);
}

console.log(`preview syntax ok · ${scripts.length} scripts · ${html.length.toLocaleString()} characters`);
