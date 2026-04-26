import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import type BetterSqlite3 from "better-sqlite3"

type ProjectRow = {
  id: string
  name: string
  root_dir: string
  created_at: string
  updated_at: string
}

type AnnotationRow = {
  id: string
  project_id: string
  image_path: string
  label: string
  bbox_json: string
  meta_json: string
  updated_at: string
}

const dbCache = new Map<string, BetterSqlite3.Database>()
const requireFromMain = createRequire(import.meta.url)

type DatabaseCtor = typeof BetterSqlite3

let databaseCtor: DatabaseCtor | null = null

function resolveBetterSqlite3ModulePath(): string {
  const candidates = [
    path.resolve(process.cwd(), "node_modules", "better-sqlite3"),
    path.resolve(path.dirname(process.execPath), "..", "..", "node_modules", "better-sqlite3"),
    "better-sqlite3",
  ]
  for (const candidate of candidates) {
    try {
      requireFromMain.resolve(candidate)
      return candidate
    } catch {
      // continue to next candidate
    }
  }
  throw new Error(
    "Cannot resolve better-sqlite3. Make sure dependency is installed in project node_modules.",
  )
}

function getDatabaseCtor(): DatabaseCtor {
  if (databaseCtor) return databaseCtor
  const resolved = resolveBetterSqlite3ModulePath()
  const loaded = requireFromMain(resolved) as DatabaseCtor
  databaseCtor = loaded
  return loaded
}

function resolveDbFile(databaseDir: string): string {
  const baseDir = databaseDir.trim() ? databaseDir.trim() : path.resolve(process.cwd(), "data")
  fs.mkdirSync(baseDir, { recursive: true })
  return path.join(baseDir, "easyannotate-annotations.sqlite")
}

function getDb(databaseDir: string): BetterSqlite3.Database {
  const dbFile = resolveDbFile(databaseDir)
  const cached = dbCache.get(dbFile)
  if (cached) return cached

  const Database = getDatabaseCtor()
  const db = new Database(dbFile)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotation_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      label TEXT NOT NULL,
      bbox_json TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES annotation_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_project_id ON annotations(project_id);
  `)

  dbCache.set(dbFile, db)
  return db
}

export function listAnnotationProjects(databaseDir: string): ProjectRow[] {
  const db = getDb(databaseDir)
  return db
    .prepare<[], ProjectRow>(
      `SELECT id, name, root_dir, created_at, updated_at
       FROM annotation_projects
       ORDER BY updated_at DESC`,
    )
    .all()
}

export function upsertAnnotationProject(
  databaseDir: string,
  project: { id: string; name: string; rootDir: string; createdAt: string; updatedAt: string },
): void {
  const db = getDb(databaseDir)
  db.prepare(
    `INSERT INTO annotation_projects (id, name, root_dir, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       root_dir = excluded.root_dir,
       updated_at = excluded.updated_at`,
  ).run(project.id, project.name, project.rootDir, project.createdAt, project.updatedAt)
}

export function deleteAnnotationProject(databaseDir: string, id: string): void {
  const db = getDb(databaseDir)
  db.prepare("DELETE FROM annotation_projects WHERE id = ?").run(id)
}

export function listAnnotationsByProject(
  databaseDir: string,
  projectId: string,
): AnnotationRow[] {
  const db = getDb(databaseDir)
  return db
    .prepare<[string], AnnotationRow>(
      `SELECT id, project_id, image_path, label, bbox_json, meta_json, updated_at
       FROM annotations
       WHERE project_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(projectId)
}

export function upsertAnnotation(
  databaseDir: string,
  annotation: {
    id: string
    projectId: string
    imagePath: string
    label: string
    bboxJson: string
    metaJson: string
    updatedAt: string
  },
): void {
  const db = getDb(databaseDir)
  db.prepare(
    `INSERT INTO annotations (id, project_id, image_path, label, bbox_json, meta_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       image_path = excluded.image_path,
       label = excluded.label,
       bbox_json = excluded.bbox_json,
       meta_json = excluded.meta_json,
       updated_at = excluded.updated_at`,
  ).run(
    annotation.id,
    annotation.projectId,
    annotation.imagePath,
    annotation.label,
    annotation.bboxJson,
    annotation.metaJson,
    annotation.updatedAt,
  )
}

export function deleteAnnotation(databaseDir: string, id: string): void {
  const db = getDb(databaseDir)
  db.prepare("DELETE FROM annotations WHERE id = ?").run(id)
}
