import { readFileSync, writeFileSync } from "node:fs";

const file = "dist/server/index.js";
const source = readFileSync(file, "utf8");
if (source.includes(".scheduled=async function")) process.exit(0);
const match = source.match(
  /var ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\?\?\{\};export\{\1 as default\};/,
);
if (!match) {
  console.error("vinext worker export was not found; scheduled handler was not attached");
  process.exit(1);
}
const worker = match[1];
const scheduled = `${worker}.scheduled=async function(e,t,n){globalThis.AI=t.AI||null;let r=new Request("https://commishhq.internal/api/internal/scheduler",{method:"POST",headers:{authorization:"Bearer "+(t.CRON_SECRET||"")}});n.waitUntil(${worker}.fetch(r,t,n))};`;
writeFileSync(file, source.replace(match[0], `var ${worker}=${match[2]}??{};${scheduled}export{${worker} as default};`));
