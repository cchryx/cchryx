#!/usr/bin/env node
// Rebuilds the Inkference sections of README.md from the Inkference API.
// Needs INKFERENCE_API_KEY in the environment. Node 20 or newer.

import { readFile, writeFile } from "node:fs/promises";

const API = "https://inkference.app/api/v1";
const KEY = process.env.INKFERENCE_API_KEY;
const README = process.env.README_PATH ?? "README.md";

// Project titles to leave out (case does not matter).
// Inkference has its own line at the top.
const HIDE = ["Inkference"];
const MAX_SKILLS = 12;
const MAX_SUMMARY = 90;

const STAGES = {
  idea: { label: "IDEA", color: "4C6EF5" },
  building: { label: "BUILDING", color: "E07B24" },
  shipped: { label: "SHIPPED", color: "3E8E5E" },
  paused: { label: "PAUSED", color: "8A8A85" },
};

async function call(path) {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function allProjects() {
  const out = [];
  let cursor = null;
  do {
    const query = `?limit=100&role=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await call(`/projects${query}`);
    out.push(...(body.data ?? []));
    cursor = body.nextCursor ?? null;
  } while (cursor);
  return out;
}

const text = (s) => String(s ?? "").replace(/</g, "&lt;").replace(/\r?\n/g, " ").trim();
const short = (s) => {
  const t = text(s);
  return t.length > MAX_SUMMARY ? `${t.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, "")}…` : t;
};
const stageOf = (p) => STAGES[String(p.stage ?? p.status ?? "").toLowerCase()] ?? null;
const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
const shieldText = (s) => encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__"));
const logoSlug = (name) =>
  name.toLowerCase().replace(/\+/g, "plus").replace(/#/g, "sharp").replace(/\./g, "dot").replace(/[^a-z0-9]/g, "");

function stageBadge(stage) {
  return `<img src="https://img.shields.io/badge/${shieldText(`● ${stage.label}`)}-${stage.color}?style=flat-square" alt="${stage.label}" height="18" />`;
}

function activeLine(p) {
  const role = String(p.role ?? "").toLowerCase() === "contributor" ? " <sub>(contributor)</sub>" : "";
  const summary = p.summary ? `: ${short(p.summary)}` : "";
  return `- ${stageBadge(stageOf(p))} **[${text(p.title)}](${p.url})**${role}${summary}`;
}

function skillBadges(skills) {
  const ranked = skills
    .filter((s) => s.name && (s.listed || count(s.usedIn?.projects) > 0))
    .sort(
      (a, b) =>
        Number(!!b.usingNow) - Number(!!a.usingNow) ||
        Number(!!b.listed) - Number(!!a.listed) ||
        count(b.usedIn?.projects) - count(a.usedIn?.projects)
    )
    .slice(0, MAX_SKILLS);
  if (ranked.length === 0) return "";
  return ranked
    .map(
      (s) =>
        `<img src="https://img.shields.io/badge/${shieldText(s.name)}-161616?style=flat-square&logo=${logoSlug(s.name)}&logoColor=F3F3F1" alt="${text(s.name)}" />`
    )
    .join("\n");
}

function replaceSection(readme, name, body) {
  const pattern = new RegExp(`(<!-- INKFERENCE:${name}:START -->)[\\s\\S]*?(<!-- INKFERENCE:${name}:END -->)`);
  if (!pattern.test(readme)) throw new Error(`README is missing the INKFERENCE:${name} markers`);
  return readme.replace(pattern, (_, start, end) => `${start}\n${body}\n${end}`);
}

async function main() {
  if (!KEY) throw new Error("Set INKFERENCE_API_KEY first.");

  const hidden = new Set(HIDE.map((t) => t.toLowerCase()));
  const projects = (await allProjects()).filter((p) => stageOf(p) && !hidden.has(String(p.title).toLowerCase()));

  const order = { BUILDING: 0, IDEA: 1 };
  const active = projects
    .filter((p) => stageOf(p).label in order)
    .sort((a, b) => order[stageOf(a).label] - order[stageOf(b).label]);

  const skills = (await call("/skills")).data ?? [];

  let readme = await readFile(README, "utf8");
  readme = replaceSection(readme, "BUILDING", active.map(activeLine).join("\n") || "_Nothing right now._");
  readme = replaceSection(readme, "SKILLS", skillBadges(skills));
  await writeFile(README, readme);

  console.log(`README updated: ${active.length} active projects.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
