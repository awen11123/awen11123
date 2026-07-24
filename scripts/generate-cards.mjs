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

// ---------- pixel Westie sprite ----------
// Pixel-art West Highland White Terrier: sitting, sunglasses on the forehead,
// holding an open ledger. Ported rect-for-rect from westie.svg (a 22x24 grid,
// variable-width runs) so the card sprite matches the source exactly.
// Palette keys: B outline · W white fur · f fur shadow · P inner-ear ·
//   G glasses frame · L lens · H lens shine · K nose/mouth ·
//   C book cover · A book page · T book binding
const DOG_PALETTE = {
  B: "#3a352e", W: "#ffffff", f: "#e6e1d6", P: "#e0a58a",
  G: "#17171d", L: "#3d4a57", H: "#5b6b7a", K: "#2b2b2b",
  C: "#6b4f34", A: "#f5e6c8", T: "#4a3b2a",
};
// [col, row, runWidth, key] — one entry per <rect>, all height 1 in grid units.
const DOG_RECTS = [
  [6,0,1,"B"],[15,0,1,"B"],
  [5,1,1,"B"],[6,1,1,"W"],[7,1,1,"B"],[14,1,1,"B"],[15,1,1,"W"],[16,1,1,"B"],
  [5,2,1,"B"],[6,2,1,"P"],[7,2,1,"W"],[8,2,1,"B"],[13,2,1,"B"],[14,2,1,"W"],[15,2,1,"P"],[16,2,1,"B"],
  [4,3,1,"B"],[5,3,12,"W"],[17,3,1,"B"],
  [3,4,1,"B"],[4,4,14,"W"],[18,4,1,"B"],
  [3,5,1,"B"],[4,5,1,"W"],[5,5,12,"G"],[17,5,1,"W"],[18,5,1,"B"],
  [3,6,1,"B"],[4,6,1,"W"],[5,6,1,"G"],[6,6,1,"H"],[7,6,2,"L"],[9,6,1,"G"],[10,6,2,"G"],[12,6,1,"G"],[13,6,1,"H"],[14,6,2,"L"],[16,6,1,"G"],[17,6,1,"W"],[18,6,1,"B"],
  [3,7,1,"B"],[4,7,1,"W"],[5,7,5,"G"],[10,7,2,"W"],[12,7,5,"G"],[17,7,1,"W"],[18,7,1,"B"],
  [2,8,1,"B"],[3,8,15,"W"],[18,8,1,"B"],
  [2,9,1,"B"],[3,9,15,"W"],[18,9,1,"B"],
  [2,10,1,"B"],[3,10,6,"W"],[9,10,4,"K"],[13,10,5,"W"],[18,10,1,"B"],
  [2,11,1,"B"],[3,11,6,"W"],[9,11,4,"K"],[13,11,5,"W"],[18,11,1,"B"],
  [2,12,1,"B"],[3,12,15,"W"],[18,12,1,"B"],[10,12,2,"K"],[20,12,1,"B"],
  [3,13,1,"B"],[4,13,13,"W"],[17,13,1,"B"],[9,13,1,"K"],[12,13,1,"K"],[19,13,1,"B"],[20,13,1,"W"],[21,13,1,"B"],
  [5,14,1,"B"],[6,14,10,"W"],[16,14,1,"B"],[8,14,1,"f"],[19,14,1,"B"],[20,14,1,"W"],[21,14,1,"B"],
  [4,15,1,"B"],[5,15,13,"W"],[18,15,1,"B"],[19,15,1,"B"],[20,15,1,"W"],[21,15,1,"B"],
  [3,16,1,"B"],[4,16,13,"W"],[17,16,1,"f"],[18,16,1,"B"],[7,16,1,"f"],[13,16,1,"f"],[19,16,1,"B"],[20,16,1,"W"],[21,16,1,"B"],
  [3,17,1,"B"],[4,17,13,"W"],[17,17,1,"f"],[18,17,1,"B"],[9,17,1,"f"],[11,17,1,"f"],[19,17,1,"B"],[20,17,1,"W"],[21,17,1,"B"],
  [3,18,1,"B"],[4,18,13,"W"],[17,18,1,"f"],[18,18,1,"B"],
  [3,19,1,"B"],[4,19,3,"W"],[7,19,8,"C"],[15,19,3,"W"],[18,19,1,"B"],
  [3,20,1,"B"],[4,20,3,"W"],[7,20,1,"C"],[8,20,2,"A"],[10,20,2,"T"],[12,20,2,"A"],[14,20,1,"C"],[15,20,3,"W"],[18,20,1,"B"],
  [3,21,1,"B"],[4,21,3,"W"],[7,21,1,"C"],[8,21,2,"A"],[10,21,2,"T"],[12,21,2,"A"],[14,21,1,"C"],[15,21,3,"W"],[18,21,1,"B"],
  [3,22,1,"B"],[4,22,1,"W"],[5,22,1,"B"],[6,22,1,"W"],[7,22,8,"C"],[15,22,1,"W"],[16,22,1,"B"],[17,22,1,"W"],[18,22,1,"B"],
  [4,23,3,"B"],[7,23,8,"C"],[15,23,3,"B"],
];

function renderDog({ x, y, scale }) {
  let out = "";
  for (const [c, r, w, key] of DOG_RECTS) {
    const fill = DOG_PALETTE[key] || "#000";
    out += `<rect x="${x + c * scale}" y="${y + r * scale}" width="${w * scale}" height="${scale}" fill="${fill}" />`;
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
  const dogScale = 8;
  const dogW = 22 * dogScale;             // 176
  const dogX = 14;
  const dogY = (H - 24 * dogScale) / 2;   // vertical center (9)
  const statsX = dogX + dogW + 22;        // start of stats area
  const colW = 175;
  const body = `
    ${renderDog({ x: dogX, y: dogY, scale: dogScale })}
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
