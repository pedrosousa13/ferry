import { createWriteStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const { ZipFile } = yazl;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

// Ferry builds a separate dist dir per browser (the manifests differ), so the
// zip is parameterized by which browser dir to package.
const browser = process.argv[2];
if (browser !== "chrome" && browser !== "firefox") {
  throw new Error("Usage: zip-dist.mjs <chrome|firefox> [outputName]");
}

const sourceDir = resolve(projectRoot, "dist", browser);
const outputName = process.argv[3] ?? `ferry-${browser}.zip`;
const outputFile = resolve(projectRoot, outputName);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const dirStats = await stat(sourceDir).catch(() => null);

  if (!dirStats?.isDirectory()) {
    throw new Error(`${relative(projectRoot, sourceDir)} not found. Run the build first.`);
  }

  const files = await listFiles(sourceDir);

  if (files.length === 0) {
    throw new Error(`${relative(projectRoot, sourceDir)} is empty. Run the build first.`);
  }

  await rm(outputFile, { force: true });

  const zipFile = new ZipFile();

  // Paths relative to the browser dir so manifest.json sits at the zip root,
  // which is what both stores require.
  for (const file of files) {
    zipFile.addFile(file, relative(sourceDir, file).replace(/\\/g, "/"));
  }

  await new Promise((resolvePromise, rejectPromise) => {
    zipFile.outputStream.on("error", rejectPromise);
    zipFile.outputStream
      .pipe(createWriteStream(outputFile))
      .on("close", resolvePromise)
      .on("error", rejectPromise);

    zipFile.end();
  });

  console.log(`Created ${relative(projectRoot, outputFile)} from ${relative(projectRoot, sourceDir)}`);
}

await main();
