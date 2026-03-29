import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outdir = "./dist";

// 1. Clean and create dist folder
try {
  await mkdir(outdir, { recursive: true });
} catch (e) {}

// 2. Build the TypeScript code
console.log("Building main.ts...");
const result = await Bun.build({
  entrypoints: ["./main.ts"],
  outdir: outdir,
  target: "browser",
  minify: true,
});

if (!result.success) {
  console.error("Build failed", result.logs);
  process.exit(1);
}

// 3. Copy assets
console.log("Copying assets...");
try {
  await mkdir(join(outdir, "assets"), { recursive: true });
  // We don't need to copy the PNGs manually if Bun bundled them into the JS,
  // but since we are using relative paths in the code, let's copy them to be safe.
  const assets = await Array.fromAsync(new Bun.Glob("assets/*.png").scan());
  for (const asset of assets) {
    await copyFile(asset, join(outdir, asset));
  }
} catch (e) {
  console.error("Failed to copy assets", e);
}

// 4. Prepare index.html for production
console.log("Preparing index.html...");
let html = await Bun.file("index.html").text();
// Change .ts reference to .js for the browser
html = html.replace('src="./main.ts"', 'src="./main.js"');
await writeFile(join(outdir, "index.html"), html);

console.log("Build complete! Files are in ./dist");
