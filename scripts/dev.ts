// Starts the API server and the Vite dev server together.
const opts = { stdio: ["inherit", "inherit", "inherit"] as ["inherit", "inherit", "inherit"], cwd: import.meta.dir + "/.." };
const procs = [
  Bun.spawn(["bun", "--watch", "server/index.ts"], opts),
  Bun.spawn(["bun", "x", "vite"], opts),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
