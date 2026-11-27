// Generates icon + splash PNGs (assets/ for @capacitor/assets, www/icon.png favicon) from vector art.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const fg = (scale) => `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <path d="M512 210c-120 0-210 92-210 205 0 150 210 380 210 380s210-230 210-380c0-113-90-205-210-205z" fill="#fff"/>
    <path d="M392 450 L470 380 L522 425 L590 360 L650 430 L650 470 L392 470Z" fill="#10B981"/>
    <rect x="392" y="470" width="258" height="18" rx="9" fill="#047857"/>
  </g>`;
const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10B981"/><stop offset="1" stop-color="#047857"/></linearGradient></defs>`;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const splash = (dark) => svg(2732, 2732, `<rect width="2732" height="2732" fill="${dark ? "#0B1220" : "#F8FAFC"}"/>
  <g transform="translate(1366 1250)"><rect x="-200" y="-200" width="400" height="400" rx="110" fill="#10B981" transform="rotate(-5)"/>
  <g transform="scale(0.55) translate(-512 -512)">${fg(1)}</g></g>
  <text x="1366" y="1600" font-family="Arial, sans-serif" font-size="150" font-weight="800" fill="${dark ? "#E2E8F0" : "#0F172A"}" text-anchor="middle">LANDIER</text>`);

mkdirSync("assets", { recursive: true });
await sharp(svg(1024, 1024, grad + `<rect width="1024" height="1024" fill="url(#g)"/>` + fg(1))).png().toFile("assets/icon-only.png");
await sharp(svg(1024, 1024, fg(0.72))).png().toFile("assets/icon-foreground.png");
await sharp(svg(1024, 1024, grad + `<rect width="1024" height="1024" fill="url(#g)"/>`)).png().toFile("assets/icon-background.png");
await sharp(splash(false)).png().toFile("assets/splash.png");
await sharp(splash(true)).png().toFile("assets/splash-dark.png");
await sharp("assets/icon-only.png").resize(192, 192).png().toFile("www/icon.png");
console.log("Icons generated.");
