#!/usr/bin/env node
// Rebuilds the Inkference sections of README.md from the Inkference API.
// Needs INKFERENCE_API_KEY in the environment. Node 20 or newer.

import { readFile, writeFile } from "node:fs/promises";

const API = "https://inkference.app/api/v1";
const KEY = process.env.INKFERENCE_API_KEY;
const README = process.env.README_PATH ?? "README.md";

// Project titles to leave off the tables (case does not matter).
// Inkference has its own featured section at the top.
const HIDE = ["Inkference"];
// Shipped projects to always show first, in this order.
const PIN = ["Hydra", "Pluto"];
const MAX_SHIPPED = 6;
const MAX_SKILLS = 24;
const PROFILE = "https://inkference.app/profile/cchryx";

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

// Small helpers that accept the different shapes a field can come in.
const text = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\r?\n/g, " ").trim();
const imageUrl = (img) => (typeof img === "string" ? img : img?.thumbnail ?? img?.url ?? null);
const skillName = (s) => (typeof s === "string" ? s : s?.name ?? "");
const stageOf = (p) => STAGES[String(p.stage ?? p.status ?? "").toLowerCase()] ?? null;
const linkUrl = (l) => (typeof l === "string" ? l : l?.url ?? "");
const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);

function shieldText(s) {
  return encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__"));
}

function logoSlug(name) {
  return name
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/\./g, "dot")
    .replace(/[^a-z0-9]/g, "");
}

function stageBadge(stage) {
  return `<img src="https://img.shields.io/badge/${shieldText(`● ${stage.label}`)}-${stage.color}?style=flat-square" alt="${stage.label}" />`;
}

function formatDate(due) {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function projectRow(p, nextMilestone) {
  const icon = imageUrl(p.icon);
  const iconCell = icon ? `<img src="${icon}" width="44" alt="" />` : "";
  const repo = (p.links ?? []).map(linkUrl).find((u) => /github\.com/i.test(u));
  const title = `**[${text(p.title)}](${p.url})**`;
  const extra = repo ? ` · [code](${repo})` : "";
  const contributor = String(p.role ?? "").toLowerCase() === "contributor" ? `<br><sub><b>Contributor</b>${p.contributedAs ? `: ${text(p.contributedAs)}` : ""}</sub>` : "";
  const summary = (p.summary ? `<br><sub>${text(p.summary)}</sub>` : "") + contributor;
  const next = nextMilestone
    ? `<br><sub><b>Next:</b> ${text(nextMilestone.title)}${formatDate(nextMilestone.due) ? ` · ${formatDate(nextMilestone.due)}` : ""}</sub>`
    : "";
  const stack = (p.skills ?? []).map(skillName).filter(Boolean).slice(0, 4).map((s) => `\`${text(s)}\``).join(" ");
  return `| ${iconCell} | ${title}${extra}${summary}${next} | ${stageBadge(stageOf(p))} | ${stack} |`;
}

function projectTable(rows) {
  if (rows.length === 0) return "_Nothing here yet._";
  return ["| | Project | Stage | Stack |", "|:-:|---|:-:|---|", ...rows].join("\n");
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
  if (ranked.length === 0) return "_No skills listed yet._";
  const badges = ranked.map(
    (s) =>
      `<img src="https://img.shields.io/badge/${shieldText(s.name)}-161616?style=flat-square&logo=${logoSlug(s.name)}&logoColor=F3F3F1" alt="${text(s.name)}" />`
  );
  return `<p>\n  ${badges.join("\n  ")}\n</p>`;
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

  const pinRank = (p) => {
    const i = PIN.findIndex((t) => t.toLowerCase() === String(p.title).toLowerCase());
    return i === -1 ? PIN.length : i;
  };
  const ended = (p) => new Date(p.endDate ?? p.updatedAt ?? 0).getTime() || 0;
  const allShipped = projects.filter((p) => stageOf(p).label === "SHIPPED");
  const shipped = [...allShipped].sort((a, b) => pinRank(a) - pinRank(b) || ended(b) - ended(a)).slice(0, MAX_SHIPPED);

  // For active projects, look up the next milestone that is not done.
  const activeRows = [];
  for (const p of active) {
    const detail = (await call(`/projects/${encodeURIComponent(p.id)}`)).data ?? {};
    const next = (detail.milestones ?? []).find((m) => !m.done) ?? null;
    activeRows.push(projectRow(p, next));
  }
  const shippedRows = shipped.map((p) => projectRow(p, null));

  const skills = (await call("/skills")).data ?? [];

  let readme = await readFile(README, "utf8");
  readme = replaceSection(readme, "BUILDING", projectTable(activeRows));
  const more = allShipped.length > shipped.length ? `\n\n<sub>Plus ${allShipped.length - shipped.length} more on <a href="${PROFILE}">my Inkference profile</a>.</sub>` : "";
  readme = replaceSection(readme, "SHIPPED", projectTable(shippedRows) + more);
  readme = replaceSection(readme, "SKILLS", skillBadges(skills));
  await writeFile(README, readme);

  console.log(`README updated: ${activeRows.length} active projects, ${shippedRows.length} shipped projects.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
