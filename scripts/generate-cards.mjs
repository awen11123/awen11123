#!/usr/bin/env node
// Self-hosted SVG card generator. No external image services.
// Writes:
//   assets/stats.svg          - aggregate stats card
//   assets/languages.svg      - top languages card
//   assets/repos/<o>-<r>.svg  - per-repo pin cards
// And updates the "Open Source Contributions" block in README.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const USERNAME = process.env.GH_USERNAME || "awen11123";
const README = "README.md";
const ASSETS = "assets";
const REPO_DIR = `${ASSETS}/repos`;
const START = "<!-- CONTRIBUTIONS:START -->";
const END = "<!-- CONTRIBUTIONS:END -->";

mkdirSync(REPO_DIR, { recursive: true });

const gh = (args) =>
  execSync(`gh ${args}`, { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });

const ghJSON = (args) => JSON.parse(gh(args));

// gh API call with retry — used for per-repo lookups that may flake.
function ghJSONRetry(args, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return ghJSON(args);
    } catch (e) {
      lastErr = e;
      // Linear backoff; gh CLI surfaces network errors via stderr+exit.
      const ms = 500 * (i + 1);
      const end = Date.now() + ms;
      while (Date.now() < end) {} // intentional spin — keeps script sync
    }
  }
  throw lastErr;
}

// ---------- palette ----------
const C = {
  bg: "#ffffff",
  border: "#d0d7de",
  title: "#0969da",
  text: "#1f2328",
  muted: "#656d76",
  icon: "#656d76",
  accent: "#2da44e",
  star: "#d4a72c",
  fork: "#656d76",
};

// Common language colors (subset of github-linguist).
const LANG_COLOR = {
  Swift: "#F05138", Python: "#3572A5", TypeScript: "#3178c6",
  JavaScript: "#f1e05a", Go: "#00ADD8", Rust: "#dea584",
  "C++": "#f34b7d", C: "#555555", "C#": "#178600",
  Java: "#b07219", Kotlin: "#A97BFF", Ruby: "#701516",
  PHP: "#4F5D95", Shell: "#89e051", HTML: "#e34c26",
  CSS: "#663399", SCSS: "#c6538c", Vue: "#41b883",
  Svelte: "#ff3e00", Dart: "#00B4AB", Lua: "#000080",
  MDX: "#fcb32c", "Jupyter Notebook": "#DA5B0B",
  TeX: "#3D6117", "Objective-C": "#438eff",
};
const langColor = (l) => LANG_COLOR[l] || "#999999";

// ---------- svg helpers ----------
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function svg({ width, height, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .title { font: 600 16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; fill: ${C.title}; }
    .desc  { font: 400 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; fill: ${C.muted}; }
    .label { font: 600 13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; fill: ${C.text}; }
    .num   { font: 700 22px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; fill: ${C.text}; }
    .meta  { font: 400 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; fill: ${C.muted}; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" ry="6"
        fill="${C.bg}" stroke="${C.border}" />
  ${body}
</svg>`;
}

// ---------- pixel cat sprite ----------
// Pixel-art tabby cat holding a ledger labeled "STATS".
// Color key:
//   B = black outline      O = orange tabby       o = dark orange (stripes)
//   W = eye highlight      P = pink (ears/nose)   C = book cover
//   c = book page          T = book text          . = transparent
const CAT_PIXELS = [
  "..BB......BB..",
  ".BPB......BPB.",
  ".BOB......BOB.",
  "BOOOBBBBBBOOOB",
  "BOoOOOOOOOoOOB",
  "BOOOBOOOOBOOOB",
  "BOWBOOOOOOWBOB",
  "BOOOOPPPPOOOOB",
  "BOOOOoooooOOOB",
  ".BOOOOOOOOOOB.",
  "..BBBBBBBBBBB.",
  "..BcccccccccB.",
  "..BcTTTTTTTcB.",
  "..BcccccccccB.",
  "..BBBBBBBBBBB.",
];
const CAT_PALETTE = {
  B: "#2a1810",
  O: "#e89559",
  o: "#c46f2c",
  W: "#ffffff",
  P: "#f4a5a5",
  c: "#f5e6c8",
  T: "#3a2818",
  C: "#6b4423",
};

function renderCat({ x, y, scale }) {
  let out = "";
  for (let r = 0; r < CAT_PIXELS.length; r++) {
    const row = CAT_PIXELS[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      const fill = CAT_PALETTE[ch] || "#000";
      out += `<rect x="${x + c * scale}" y="${y + r * scale}" width="${scale}" height="${scale}" fill="${fill}" />`;
    }
  }
  return out;
}

// ---------- stats card ----------
function statsCard({ user, repos, totalStars, totalForks, totalCommits, mergedPRs, contributedRepos }) {
  const rows = [
    ["Public repos",       repos.length],
    ["Stars earned",       totalStars],
    ["Forks",              totalForks],
    ["Commits",            totalCommits],
    ["Merged PRs",         mergedPRs],
    ["Contributed to",     contributedRepos],
  ];
  const W = 560, H = 210;
  const catScale = 9;
  const catW = 14 * catScale;            // 126
  const catX = 18;
  const catY = (H - 15 * catScale) / 2;   // vertical center
  const statsX = catX + catW + 24;        // start of stats area
  const colW = 195;
  const body = `
    ${renderCat({ x: catX, y: catY, scale: catScale })}
    <text x="${statsX}" y="32" class="title">${esc(user.name || user.login)}'s GitHub Stats</text>
    ${rows.map(([k, v], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = statsX + col * colW;
      const y = 70 + row * 42;
      return `
        <text x="${x}" y="${y}" class="label">${esc(k)}</text>
        <text x="${x + colW - 15}" y="${y}" class="num" text-anchor="end">${v}</text>`;
    }).join("")}`;
  return svg({ width: W, height: H, body });
}

// ---------- languages card ----------
function languagesCard(langs) {
  const W = 400, H = 195;
  const total = langs.reduce((a, [, b]) => a + b, 0) || 1;
  const top = langs.slice(0, 6);
  // Stacked bar
  let x = 22;
  const barY = 50, barW = W - 44, barH = 8;
  const segs = top
    .map(([name, bytes]) => {
      const w = (bytes / total) * barW;
      const seg = `<rect x="${x}" y="${barY}" width="${w}" height="${barH}" fill="${langColor(name)}" />`;
      x += w;
      return seg;
    })
    .join("");
  const items = top
    .map(([name, bytes], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ix = 22 + col * 190;
      const iy = 90 + row * 28;
      const pct = ((bytes / total) * 100).toFixed(1);
      return `
        <circle cx="${ix + 6}" cy="${iy - 5}" r="6" fill="${langColor(name)}" />
        <text x="${ix + 20}" y="${iy}" class="label">${esc(name)}</text>
        <text x="${ix + 170}" y="${iy}" class="meta" text-anchor="end">${pct}%</text>`;
    })
    .join("");
  return svg({
    width: W,
    height: H,
    body: `
      <text x="22" y="32" class="title">Most Used Languages</text>
      <rect x="22" y="${barY}" width="${barW}" height="${barH}" rx="4" ry="4" fill="#eaeef2" />
      ${segs}
      ${items}`,
  });
}

// ---------- repo pin card ----------
function repoCard({ owner, name, description, language, stars, forks }) {
  const W = 400, H = 120;
  const desc = (description || "").slice(0, 90);
  const langDot = language
    ? `<circle cx="28" cy="92" r="6" fill="${langColor(language)}" />
       <text x="40" y="96" class="meta">${esc(language)}</text>`
    : "";
  const starIcon = `<text x="${language ? 140 : 28}" y="96" class="meta">★ ${stars}</text>`;
  const forkIcon = `<text x="${language ? 200 : 88}" y="96" class="meta">⑂ ${forks}</text>`;
  return svg({
    width: W,
    height: H,
    body: `
      <text x="22" y="32" class="title">${esc(owner)} / <tspan font-weight="700">${esc(name)}</tspan></text>
      <text x="22" y="60" class="desc">${esc(desc)}</text>
      ${langDot}${starIcon}${forkIcon}`,
  });
}

// ============================================================
// Data fetching
// ============================================================

console.log("Fetching user...");
const user = ghJSON(`api users/${USERNAME}`);

console.log("Fetching repos...");
const repos = ghJSON(`api users/${USERNAME}/repos?per_page=100&type=owner`);
const ownRepos = repos.filter((r) => !r.fork);

const totalStars = ownRepos.reduce((a, r) => a + r.stargazers_count, 0);
const totalForks = ownRepos.reduce((a, r) => a + r.forks_count, 0);

console.log("Fetching languages...");
const langTotals = new Map();
for (const r of ownRepos) {
  try {
    const langs = ghJSON(`api repos/${USERNAME}/${r.name}/languages`);
    for (const [k, v] of Object.entries(langs)) {
      langTotals.set(k, (langTotals.get(k) || 0) + v);
    }
  } catch {
    /* repo may be empty */
  }
}
const langs = [...langTotals.entries()].sort((a, b) => b[1] - a[1]);

console.log("Fetching commit count (own repos)...");
let totalCommits = 0;
for (const r of ownRepos) {
  try {
    const out = gh(
      `api "repos/${USERNAME}/${r.name}/commits?author=${USERNAME}&per_page=1" --include`,
    );
    const m = out.match(/<[^>]*[?&]page=(\d+)>; rel="last"/);
    if (m) totalCommits += parseInt(m[1], 10);
    else {
      // single page — count entries
      const body = out.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      try {
        const arr = JSON.parse(body);
        totalCommits += Array.isArray(arr) ? arr.length : 0;
      } catch {}
    }
  } catch {}
}

console.log("Fetching merged PRs...");
const prs = ghJSON(
  `search prs --author ${USERNAME} --merged --limit 200 ` +
    `--json repository,title,url,number,updatedAt`,
);
const external = prs.filter(
  (p) =>
    !p.repository.nameWithOwner.toLowerCase().startsWith(`${USERNAME.toLowerCase()}/`),
);
const byRepo = new Map();
for (const pr of external) {
  const key = pr.repository.nameWithOwner;
  if (!byRepo.has(key)) byRepo.set(key, []);
  byRepo.get(key).push(pr);
}
const contributedRepoList = [...byRepo.entries()]
  .map(([name, list]) => ({
    name,
    count: list.length,
    latest: list.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)),
  }))
  .sort(
    (a, b) =>
      b.count - a.count || b.latest.updatedAt.localeCompare(a.latest.updatedAt),
  );

// ============================================================
// Render
// ============================================================

console.log("Rendering stats card...");
writeFileSync(
  `${ASSETS}/stats.svg`,
  statsCard({
    user,
    repos: ownRepos,
    totalStars,
    totalForks,
    totalCommits,
    mergedPRs: prs.length,
    contributedRepos: byRepo.size,
  }),
);

console.log("Rendering languages card...");
writeFileSync(`${ASSETS}/languages.svg`, languagesCard(langs));

console.log("Rendering featured project cards...");
const FEATURED = ["usage-pet"];
for (const name of FEATURED) {
  const r = ownRepos.find((x) => x.name === name);
  if (!r) continue;
  writeFileSync(
    `${REPO_DIR}/${USERNAME}-${name}.svg`,
    repoCard({
      owner: USERNAME,
      name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
    }),
  );
}

console.log("Rendering contribution cards...");
const contribCardLinks = [];
for (const { name, count, latest } of contributedRepoList) {
  const [owner, repo] = name.split("/");
  let meta;
  try {
    meta = ghJSONRetry(`api repos/${owner}/${repo}`);
  } catch (e) {
    console.error(`Failed to fetch ${name} after retries:`, e.message);
    throw e; // fail loud — better than silently dropping the section
  }
  const file = `${owner}-${repo}.svg`;
  writeFileSync(
    `${REPO_DIR}/${file}`,
    repoCard({
      owner,
      name: repo,
      description: meta.description,
      language: meta.language,
      stars: meta.stargazers_count,
      forks: meta.forks_count,
    }),
  );
  contribCardLinks.push({ owner, repo, file, count, latest });
}

// ============================================================
// Patch README contributions block
// ============================================================

const cards = contribCardLinks
  .map(
    ({ owner, repo, file, count, latest }) =>
      `<a href="https://github.com/${owner}/${repo}/pulls?q=is%3Apr+author%3A${USERNAME}+is%3Amerged">` +
      `<img src="assets/repos/${file}" alt="${owner}/${repo}" /></a> ` +
      `<sub><b>${count}</b> merged · latest: ` +
      `<a href="${latest.url}">#${latest.number}</a></sub>`,
  )
  .join("\n\n");

const block =
  `${START}\n\n` +
  `> Auto-generated daily. Last updated: ${new Date().toISOString().slice(0, 10)}\n\n` +
  (cards || "_No external contributions yet._") +
  `\n\n${END}`;

const readme = readFileSync(README, "utf8");
if (!readme.includes(START) || !readme.includes(END))
  throw new Error("README markers missing");
writeFileSync(
  README,
  readme.replace(
    new RegExp(`${START}[\\s\\S]*?${END}`),
    block.replace(/\$/g, "$$$$"),
  ),
);

console.log(
  `Done. langs=${langs.length}, contribRepos=${contribCardLinks.length}, ` +
    `commits=${totalCommits}, stars=${totalStars}.`,
);
