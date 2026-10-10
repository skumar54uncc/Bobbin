/**
 * Builds icons/icon-{16,48,128}.png from icons/bobbin-brand.png (Sharp).
 * Replace bobbin-brand.png with your halftone source whenever branding updates.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "icons", "bobbin-brand.png");
const dir = path.join(root, "icons");

async function main() {
  if (!fs.existsSync(src)) {
    console.error("Missing:", src);
    console.error("Add bobbin-brand.png (square PNG) to icons/");
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });

  for (const size of [16, 48, 128]) {
    const out = path.join(dir, `icon-${size}.png`);
    await sharp(src).resize(size, size).png().toFile(out);
    console.log("wrote", path.relative(root, out));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
