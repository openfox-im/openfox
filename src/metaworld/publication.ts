import fs from "fs/promises";
import path from "path";
import { ulid } from "ulid";
import type { OpenFoxDatabase } from "../types.js";
import type { MetaWorldSiteManifest, MetaWorldSiteExportResult } from "./site.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";

const SITE_PUBLICATIONS_KV_KEY = "metaworld:site_publications";
const FEDERATION_PEERS_KV_KEY = "metaworld:federation_peers";

export interface MetaWorldSitePublicationRecord {
  publicationId: string;
  label: string;
  outputDir: string;
  manifestPath: string;
  publicationPath: string;
  baseUrl: string | null;
  generatedAt: string;
  registeredAt: string;
  foxPageCount: number;
  groupPageCount: number;
  shellPath: string;
  searchPath: string;
}

export interface MetaWorldFederationPeerRecord {
  peerId: string;
  label: string;
  baseUrl: string | null;
  manifestUrl: string;
  addedAt: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  remoteGeneratedAt: string | null;
  foxPageCount: number;
  groupPageCount: number;
  shellPath: string | null;
  publicationPath: string | null;
  searchPath: string | null;
}

export interface MetaWorldPublishedFoxProfileRef {
  address: string;
  displayName: string;
  tnsName: string | null;
  publishedCid: string;
  publishedAt: string | null;
}

export interface MetaWorldPublishedGroupProfileRef {
  groupId: string;
  name: string;
  visibility: "private" | "listed" | "public";
  publishedCid: string;
  publishedAt: string | null;
}

export interface MetaWorldPublicationSnapshot {
  generatedAt: string;
  summary: string;
  publishedFoxProfiles: MetaWorldPublishedFoxProfileRef[];
  publishedGroupProfiles: MetaWorldPublishedGroupProfileRef[];
  sitePublications: MetaWorldSitePublicationRecord[];
  federationPeers: MetaWorldFederationPeerRecord[];
  counts: {
    publishedFoxCount: number;
    publishedGroupCount: number;
    sitePublicationCount: number;
    federationPeerCount: number;
  };
}

function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readRecords<T>(db: OpenFoxDatabase, key: string): T[] {
  return parseJsonSafe<T[]>(db.getKV(key), []);
}

function writeRecords<T>(db: OpenFoxDatabase, key: string, items: T[]): void {
  db.setKV(key, JSON.stringify(items, null, 2));
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function deriveDefaultPublicationLabel(result: {
  outputDir: string;
  baseUrl: string | null;
}): string {
  if (result.baseUrl) {
    return result.baseUrl;
  }
  return path.basename(result.outputDir) || "metaworld-site";
}

async function loadSiteManifestFromDisk(outputDir: string): Promise<{
  manifest: MetaWorldSiteManifest;
  manifestPath: string;
}> {
  const manifestPath = path.join(outputDir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return {
    manifest: JSON.parse(raw) as MetaWorldSiteManifest,
    manifestPath,
  };
}

function upsertSitePublicationRecord(
  db: OpenFoxDatabase,
  record: MetaWorldSitePublicationRecord,
): MetaWorldSitePublicationRecord {
  const existing = readRecords<MetaWorldSitePublicationRecord>(db, SITE_PUBLICATIONS_KV_KEY);
  const next = existing.filter(
    (item) =>
      item.publicationId !== record.publicationId &&
      item.outputDir !== record.outputDir &&
      item.manifestPath !== record.manifestPath,
  );
  next.unshift(record);
  writeRecords(db, SITE_PUBLICATIONS_KV_KEY, next);
  return record;
}

export function listMetaWorldSitePublications(
  db: OpenFoxDatabase,
): MetaWorldSitePublicationRecord[] {
  return readRecords<MetaWorldSitePublicationRecord>(db, SITE_PUBLICATIONS_KV_KEY)
    .map((item) => ({
      ...item,
      publicationPath: item.publicationPath || "publication/index.html",
    }))
    .sort((left, right) => right.registeredAt.localeCompare(left.registeredAt));
}

export function registerMetaWorldSitePublication(params: {
  db: OpenFoxDatabase;
  result: MetaWorldSiteExportResult;
  baseUrl?: string | null;
  label?: string;
}): MetaWorldSitePublicationRecord {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const record: MetaWorldSitePublicationRecord = {
    publicationId: ulid(),
    label: params.label?.trim() || deriveDefaultPublicationLabel({
      outputDir: params.result.outputDir,
      baseUrl,
    }),
    outputDir: params.result.outputDir,
    manifestPath: params.result.manifestPath,
    publicationPath: params.result.publicationPath,
    baseUrl,
    generatedAt: params.result.generatedAt,
    registeredAt: new Date().toISOString(),
    foxPageCount: params.result.foxPages.length,
    groupPageCount: params.result.groupPages.length,
    shellPath: params.result.shellPath,
    searchPath: params.result.searchPath,
  };
  return upsertSitePublicationRecord(params.db, record);
}

export async function registerMetaWorldSitePublicationFromOutputDir(params: {
  db: OpenFoxDatabase;
  outputDir: string;
  baseUrl?: string | null;
  label?: string;
}): Promise<MetaWorldSitePublicationRecord> {
  const { manifest, manifestPath } = await loadSiteManifestFromDisk(params.outputDir);
  const record: MetaWorldSitePublicationRecord = {
    publicationId: ulid(),
    label:
      params.label?.trim() ||
      deriveDefaultPublicationLabel({
        outputDir: params.outputDir,
        baseUrl: normalizeBaseUrl(params.baseUrl),
      }),
    outputDir: params.outputDir,
    manifestPath,
    publicationPath: manifest.publicationPath || "publication/index.html",
    baseUrl: normalizeBaseUrl(params.baseUrl),
    generatedAt: manifest.generatedAt,
    registeredAt: new Date().toISOString(),
    foxPageCount: manifest.foxPages.length,
    groupPageCount: manifest.groupPages.length,
    shellPath: manifest.shellPath,
    searchPath: manifest.searchPath,
  };
  return upsertSitePublicationRecord(params.db, record);
}

export function listMetaWorldFederationPeers(
  db: OpenFoxDatabase,
): MetaWorldFederationPeerRecord[] {
  return readRecords<MetaWorldFederationPeerRecord>(db, FEDERATION_PEERS_KV_KEY)
    .map((item) => ({
      ...item,
      publicationPath: item.publicationPath ?? null,
    }))
    .sort((left, right) => right.addedAt.localeCompare(left.addedAt));
}

function upsertFederationPeerRecord(
  db: OpenFoxDatabase,
  record: MetaWorldFederationPeerRecord,
): MetaWorldFederationPeerRecord {
  const existing = readRecords<MetaWorldFederationPeerRecord>(db, FEDERATION_PEERS_KV_KEY);
  const next = existing.filter((item) => item.peerId !== record.peerId);
  next.unshift(record);
  writeRecords(db, FEDERATION_PEERS_KV_KEY, next);
  return record;
}

async function fetchRemoteManifest(manifestUrl: string): Promise<MetaWorldSiteManifest> {
  const response = await fetch(manifestUrl, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MetaWorldSiteManifest;
}

export async function addMetaWorldFederationPeer(params: {
  db: OpenFoxDatabase;
  manifestUrl: string;
  baseUrl?: string | null;
  label?: string;
}): Promise<MetaWorldFederationPeerRecord> {
  const manifestUrl = params.manifestUrl.trim();
  const baseUrl =
    normalizeBaseUrl(params.baseUrl) ||
    normalizeBaseUrl(manifestUrl.replace(/\/manifest\.json$/i, ""));
  const now = new Date().toISOString();
  const manifest = await fetchRemoteManifest(manifestUrl);
  const record: MetaWorldFederationPeerRecord = {
    peerId: ulid(),
    label: params.label?.trim() || baseUrl || manifestUrl,
    baseUrl,
    manifestUrl,
    addedAt: now,
    lastFetchedAt: now,
    lastError: null,
    remoteGeneratedAt: manifest.generatedAt,
    foxPageCount: manifest.foxPages.length,
    groupPageCount: manifest.groupPages.length,
    shellPath: manifest.shellPath,
    publicationPath: manifest.publicationPath ?? null,
    searchPath: manifest.searchPath,
  };
  return upsertFederationPeerRecord(params.db, record);
}

export async function refreshMetaWorldFederationPeer(params: {
  db: OpenFoxDatabase;
  peerId: string;
}): Promise<MetaWorldFederationPeerRecord> {
  const existing = listMetaWorldFederationPeers(params.db).find(
    (peer) => peer.peerId === params.peerId,
  );
  if (!existing) {
    throw new Error(`federation peer not found: ${params.peerId}`);
  }
  const now = new Date().toISOString();
  try {
    const manifest = await fetchRemoteManifest(existing.manifestUrl);
    return upsertFederationPeerRecord(params.db, {
      ...existing,
      lastFetchedAt: now,
      lastError: null,
      remoteGeneratedAt: manifest.generatedAt,
      foxPageCount: manifest.foxPages.length,
      groupPageCount: manifest.groupPages.length,
      shellPath: manifest.shellPath,
      publicationPath: manifest.publicationPath ?? null,
      searchPath: manifest.searchPath,
    });
  } catch (err) {
    return upsertFederationPeerRecord(params.db, {
      ...existing,
      lastFetchedAt: now,
      lastError: err instanceof Error ? err.message : "failed to refresh federation peer",
    });
  }
}

export function buildMetaWorldPublicationSnapshot(
  db: OpenFoxDatabase,
  options?: {
    previewSitePublication?: MetaWorldSitePublicationRecord | null;
  },
): MetaWorldPublicationSnapshot {
  const publishedFoxProfiles = (
    db.raw
      .prepare(
        `SELECT fp.address, fp.display_name, fp.tns_name, fp.published_cid, fp.published_at
           FROM fox_profiles fp
          WHERE fp.published_cid IS NOT NULL
          ORDER BY COALESCE(fp.published_at, fp.updated_at) DESC`,
      )
      .all() as Array<{
      address: string;
      display_name: string | null;
      tns_name: string | null;
      published_cid: string;
      published_at: string | null;
    }>
  ).map((row) => {
    const bundle = parseJsonSafe<{
      address?: string;
      displayName?: string;
      tnsName?: string | null;
      publishedAt?: string | null;
    } | null>(
      db.getKV(`fox_profile:published_bundle:${row.published_cid}`),
      null,
    );
    return {
      address: row.address,
      displayName:
        bundle?.displayName || row.display_name || row.tns_name || row.address,
      tnsName: bundle?.tnsName ?? row.tns_name ?? null,
      publishedCid: row.published_cid,
      publishedAt: bundle?.publishedAt ?? row.published_at,
    };
  });

  const publishedGroupProfiles = (
    db.raw
      .prepare(
        `SELECT gp.group_id, g.name, g.visibility, gp.published_cid, gp.published_at
           FROM group_profiles gp
           JOIN groups g ON g.group_id = gp.group_id
          WHERE gp.published_cid IS NOT NULL
          ORDER BY COALESCE(gp.published_at, gp.updated_at) DESC`,
      )
      .all() as Array<{
      group_id: string;
      name: string;
      visibility: "private" | "listed" | "public";
      published_cid: string;
      published_at: string | null;
    }>
  ).map((row) => ({
    groupId: row.group_id,
    name: row.name,
    visibility: row.visibility,
    publishedCid: row.published_cid,
    publishedAt: row.published_at,
  }));

  const sitePublications = listMetaWorldSitePublications(db);
  const preview = options?.previewSitePublication ?? null;
  const mergedSitePublications = preview
    ? [
        preview,
        ...sitePublications.filter(
          (item) =>
            item.outputDir !== preview.outputDir &&
            item.manifestPath !== preview.manifestPath &&
            item.publicationId !== preview.publicationId,
        ),
      ]
    : sitePublications;
  const federationPeers = listMetaWorldFederationPeers(db);

  return {
    generatedAt: new Date().toISOString(),
    summary: `${publishedFoxProfiles.length} published fox profile(s), ${publishedGroupProfiles.length} published group profile(s), ${mergedSitePublications.length} site publication(s), ${federationPeers.length} federation peer(s).`,
    publishedFoxProfiles,
    publishedGroupProfiles,
    sitePublications: mergedSitePublications,
    federationPeers,
    counts: {
      publishedFoxCount: publishedFoxProfiles.length,
      publishedGroupCount: publishedGroupProfiles.length,
      sitePublicationCount: mergedSitePublications.length,
      federationPeerCount: federationPeers.length,
    },
  };
}

export function buildMetaWorldPublicationHtml(
  snapshot: MetaWorldPublicationSnapshot,
  options?: {
    homeHref?: string;
    foxDirectoryHref?: string;
    groupDirectoryHref?: string;
    searchHref?: string;
  },
): string {
  const foxItems = snapshot.publishedFoxProfiles
    .slice(0, 16)
    .map(
      (item) => `<li><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(item.publishedCid)}${item.publishedAt ? ` · ${escapeHtml(item.publishedAt)}` : ""}</span></li>`,
    )
    .join("");
  const groupItems = snapshot.publishedGroupProfiles
    .slice(0, 16)
    .map(
      (item) => `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.visibility)} · ${escapeHtml(item.publishedCid)}</span></li>`,
    )
    .join("");
  const siteItems = snapshot.sitePublications
    .slice(0, 16)
    .map(
      (item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.baseUrl || item.outputDir)} · foxes=${item.foxPageCount} · groups=${item.groupPageCount}</span></li>`,
    )
    .join("");
  const federationItems = snapshot.federationPeers
    .slice(0, 16)
    .map(
      (item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.manifestUrl)} · foxes=${item.foxPageCount} · groups=${item.groupPageCount}${item.lastError ? ` · error=${escapeHtml(item.lastError)}` : ""}</span></li>`,
    )
    .join("");

  return renderMetaWorldPageFrame({
    title: "Publication & Federation · OpenFox metaWorld",
    eyebrow: "OpenFox Publication Surface",
    heading: "Publication & Federation",
    lede: snapshot.summary,
    generatedAt: snapshot.generatedAt,
    metrics: [
      { label: "Published Foxes", value: snapshot.counts.publishedFoxCount },
      { label: "Published Groups", value: snapshot.counts.publishedGroupCount },
      { label: "Site Bundles", value: snapshot.counts.sitePublicationCount },
      { label: "Federation Peers", value: snapshot.counts.federationPeerCount },
    ],
    navLinks: [
      { label: "World Shell", href: options?.homeHref ?? "/" },
      { label: "Fox Directory", href: options?.foxDirectoryHref ?? "/directory/foxes" },
      { label: "Group Directory", href: options?.groupDirectoryHref ?? "/directory/groups" },
      { label: "Search", href: options?.searchHref ?? "/search" },
    ],
    sections: [
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Published Fox Profiles</h3>
            <span>${snapshot.publishedFoxProfiles.length}</span>
          </div>
          <ul class="directory-list">${foxItems || '<li class="empty">No published Fox profiles.</li>'}</ul>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Published Group Profiles</h3>
            <span>${snapshot.publishedGroupProfiles.length}</span>
          </div>
          <ul class="directory-list">${groupItems || '<li class="empty">No published Group profiles.</li>'}</ul>
        </section>
      </section>`,
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Hosted Site Bundles</h3>
            <span>${snapshot.sitePublications.length}</span>
          </div>
          <ul class="directory-list">${siteItems || '<li class="empty">No registered site bundles.</li>'}</ul>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Federation Peers</h3>
            <span>${snapshot.federationPeers.length}</span>
          </div>
          <ul class="directory-list">${federationItems || '<li class="empty">No federation peers yet.</li>'}</ul>
        </section>
      </section>`,
    ],
  });
}
