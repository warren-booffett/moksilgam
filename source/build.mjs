// node build.mjs            → 저장소 루트(..)에 배포용 파일을 씀 (GitHub Pages가 루트를 그대로 서비스)
// node build.mjs --dev <샘플.xlsx> → source/dev/ 에 빌드하고 http://localhost:5173 로 띄움 (샘플은 dev/에만 복사, 배포에는 안 들어감)
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const dev = process.argv.includes("--dev");
const sample = dev ? process.argv[process.argv.indexOf("--dev") + 1] : null;
const out = dev ? "dev" : "..";

// dev 폴더만 통째로 지움. 배포(루트)는 아래 파일들만 덮어씀
if (dev) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync("public")) fs.copyFileSync(path.join("public", f), path.join(out, f));
fs.copyFileSync("index.html", path.join(out, "index.html"));
fs.copyFileSync("src/app.css", path.join(out, "app.css"));
if (sample) fs.copyFileSync(sample, path.join(out, "sample.xlsx"));
// 올리기 화면용 라이브러리(html2canvas)는 따로 쪼개서 필요할 때만 받음. 지난 빌드 조각은 지움
fs.rmSync(path.join(out, "chunks"), { recursive: true, force: true });

const opts = { absWorkingDir: process.cwd(), entryPoints: ["src/main.js"], bundle: true, format: "esm", target: "es2020", outdir: out, entryNames: "app", chunkNames: "chunks/[name]-[hash]", splitting: true, minify: !dev, sourcemap: dev, logLevel: "info" };
if (dev) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173, host: "127.0.0.1" });
  console.log(`dev server: http://localhost:${port}`);
} else {
  await esbuild.build(opts);
}
