#!/usr/bin/env node
// Updates the "Open Source Contributions" section in README.md.
// Reads merged PRs authored by USERNAME in repos NOT owned by USERNAME,
// groups by repo, and renders a card grid between the markers.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const USERNAME = process.env.GH_USERNAME || "awen11123";
const README = "README.md";
const START = "<!-- CONTRIBUTIONS:START -->";
const END = "<!-- CONTRIBUTIONS:END -->";

function gh(args) {
  return execSync(`gh ${args}`, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

const prs = JSON.parse(
  gh(
    `search prs --author ${USERNAME} --merged --limit 200 ` +
      `--json repository,title,url,number,updatedAt`,
  ),
);

const external = prs.filter(
  (p) => !p.repository.nameWithOwner.toLowerCase().startsWith(`${USERNAME.toLowerCase()}/`),
);

const byRepo = new Map();
for (const pr of external) {
  const key = pr.repository.nameWithOwner;
  if (!byRepo.has(key)) byRepo.set(key, []);
  byRepo.get(key).push(pr);
}

const repos = [...byRepo.entries()]
  .map(([name, list]) => ({
    name,
    count: list.length,
    latest: list.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)),
  }))
  .sort((a, b) => (b.count - a.count) || b.latest.updatedAt.localeCompare(a.latest.updatedAt));

const cards = repos
  .map(({ name, count, latest }) => {
    const [owner, repo] = name.split("/");
    const card =
      `https://github-readme-stats.vercel.app/api/pin/` +
      `?username=${owner}&repo=${repo}&theme=default`;
    return (
      `<a href="https://github.com/${name}/pulls?q=is%3Apr+author%3A${USERNAME}+is%3Amerged">` +
      `<img src="${card}" alt="${name}" />` +
      `</a> ` +
      `<sub><b>${count}</b> merged · latest: ` +
      `<a href="${latest.url}">#${latest.number}</a></sub>`
    );
  })
  .join("\n\n");

const block =
  `${START}\n\n` +
  `> Auto-generated daily from merged PRs. Last updated: ` +
  `${new Date().toISOString().slice(0, 10)}\n\n` +
  (cards || "_No external contributions yet._") +
  `\n\n${END}`;

const readme = readFileSync(README, "utf8");
if (!readme.includes(START) || !readme.includes(END)) {
  throw new Error("README markers not found");
}
const updated = readme.replace(
  new RegExp(`${START}[\\s\\S]*?${END}`),
  block.replace(/\$/g, "$$$$"),
);
writeFileSync(README, updated);
console.log(`Updated ${repos.length} contribution cards.`);
