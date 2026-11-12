// Renders the driver app icons (assets/) from one original SVG design. Needs sharp, which is not a
// project dependency:  npx -p sharp@0.34.5 node scripts/make-icons.mjs assets
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const BLUE = "#0F5FA8";
const DEEP = "#0A3F73";
const GREEN = "#22C55E";

// Truck + motion lines + "sent" badge, drawn on a 1024 canvas. `cut` is the colour behind the wheels.
const art = (cut) => `
  <g>
    <!-- motion lines -->
    <rect x="132" y="418" width="96" height="30" rx="15" fill="#fff" opacity="0.55"/>
    <rect x="96"  y="484" width="132" height="30" rx="15" fill="#fff" opacity="0.75"/>
    <rect x="150" y="550" width="78" height="30" rx="15" fill="#fff" opacity="0.55"/>
    <!-- cargo box -->
    <rect x="254" y="356" width="338" height="262" rx="34" fill="#fff"/>
    <!-- cab -->
    <path d="M604 432 H708 Q728 432 740 448 L806 534 Q814 545 814 560 V594 Q814 618 790 618 H604 Z" fill="#fff"/>
    <!-- window -->
    <path d="M636 462 H700 Q708 462 713 469 L758 530 H636 Z" fill="${BLUE}"/>
    <!-- wheels, with a ring in the background colour so they read separately from the body -->
    <circle cx="372" cy="628" r="84" fill="${cut}"/>
    <circle cx="700" cy="628" r="84" fill="${cut}"/>
    <circle cx="372" cy="628" r="62" fill="#fff"/>
    <circle cx="700" cy="628" r="62" fill="#fff"/>
    <circle cx="372" cy="628" r="24" fill="${BLUE}"/>
    <circle cx="700" cy="628" r="24" fill="${BLUE}"/>
    <!-- sent / synced badge -->
    <circle cx="772" cy="330" r="72" fill="${cut}"/>
    <circle cx="772" cy="330" r="58" fill="${GREEN}"/>
    <path d="M744 331 L764 351 L802 311" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

// Full icon: gradient square (the launcher masks the corners itself).
const full = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <g transform="translate(512 512) scale(0.92) translate(-455 -487)">${art(BLUE).replaceAll(`fill="${BLUE}"/>\n    <circle cx="700" cy="628" r="84"`, `fill="${BLUE}"/>\n    <circle cx="700" cy="628" r="84"`)}</g>
</svg>`;

// Android adaptive foreground: transparent, artwork inside the 66% safe zone; background colour is set in app.json.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(0.66) translate(-455 -487)">${art(BLUE)}</g>
</svg>`;

// Monochrome (Android 13 themed icons): white shapes only.
const mono = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(0.66) translate(-455 -487)">${art("#000").replaceAll(BLUE, "#000").replaceAll(GREEN, "#fff").replaceAll('opacity="0.55"', "").replaceAll('opacity="0.75"', "")}</g>
</svg>`;

await sharp(Buffer.from(full)).png().toFile(join(out, "icon.png"));
await sharp(Buffer.from(fg)).png().toFile(join(out, "adaptive-icon.png"));
await sharp(Buffer.from(mono)).png().toFile(join(out, "adaptive-icon-monochrome.png"));
// Preview of how a launcher shows it (rounded mask), for review only.
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><clipPath id="c"><rect width="1024" height="1024" rx="230"/></clipPath></defs><image href="data:image/png;base64,${(await sharp(Buffer.from(full)).png().toBuffer()).toString("base64")}" width="1024" height="1024" clip-path="url(#c)"/></svg>`;
await sharp(Buffer.from(preview)).resize(512).png().toFile(join(out, "..", "icon-preview.png"));
console.log("icons written to", out);
