/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { applyEditsToSource, compileProjectSource } from "./compiler";
import type { CompileResult, FsEntry, FsStat, ProjectInfo, SourceEdit, WriteResult } from "./types";

export const DEFAULT_MOBILE_ROOT = "C:/Projects";

const STORAGE_PROJECTS_KEY = "ds_mobile_projects_v2";
const STORAGE_FILES_PREFIX = "ds_file_";

export const STARTER_PORTRAIT_TSX = `export default function Project() {
  return (
    <stage background="#121212" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Vertical Shorts" width={1080} height={1920} fill="#18181b" active>
        <rect width={1080} height={1920} fill="#18181b" start={0} end={10} />
        <text y={850} width={1080} textAlign="center" fontFamily="Inter" fontSize={72} fill="#ffffff" start={0} end={10}>
          Diffusion Studio Mobile
        </text>
        <text y={980} width={1080} textAlign="center" fontFamily="Inter" fontSize={36} fill="#a1a1aa" start={0} end={10}>
          Touch-First Video Editor
        </text>
      </scene>
    </stage>
  );
}
`;

type StoredProject = ProjectInfo & {
  config?: unknown;
  manifest?: unknown;
};

class MobileProjectsEngine {
  private projects: Map<string, StoredProject> = new Map();
  private watchers: Set<string> = new Set();
  private changeListeners: Set<(dir: string, path: string) => void> = new Set();

  constructor() {
    this.loadFromStorage();
    if (this.projects.size === 0) {
      this.initDefaultProject();
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (raw) {
        const list = JSON.parse(raw) as StoredProject[];
        for (const p of list) {
          this.projects.set(p.dir, p);
        }
      }
    } catch (e) {
      console.warn("[projects-engine] Failed to load projects from storage", e);
    }
  }

  private saveToStorage(): void {
    try {
      const list = Array.from(this.projects.values());
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("[projects-engine] Failed to save projects to storage", e);
    }
  }

  private getFile(path: string): string | null {
    return localStorage.getItem(STORAGE_FILES_PREFIX + path);
  }

  private setFile(path: string, content: string): void {
    localStorage.setItem(STORAGE_FILES_PREFIX + path, content);
  }

  private removeFile(path: string): void {
    localStorage.removeItem(STORAGE_FILES_PREFIX + path);
  }

  private initDefaultProject(): void {
    const dir = `${DEFAULT_MOBILE_ROOT}/mobile-shorts-intro`;
    const id = "proj_mobile_shorts_01";
    const now = new Date().toISOString();

    const proj: StoredProject = {
      id,
      name: "mobile-shorts-intro",
      displayName: "Mobile Shorts (9:16)",
      dir,
      entry: "index.tsx",
      createdAt: now,
      modifiedAt: now,
      manifest: { version: 1, folders: [], assets: [] },
      config: { duration: 10, fps: 30 },
    };

    this.projects.set(dir, proj);
    this.setFile(`${dir}/index.tsx`, STARTER_PORTRAIT_TSX);
    this.setFile(`${dir}/package.json`, JSON.stringify({ projectId: id, displayName: proj.displayName, main: "index.tsx" }, null, 2));
    this.saveToStorage();
  }

  public onChange(listener: (dir: string, path: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(dir: string, path: string): void {
    if (this.watchers.has(dir)) {
      for (const cb of this.changeListeners) {
        cb(dir, path);
      }
    }
  }

  public defaultRoot(): string {
    return DEFAULT_MOBILE_ROOT;
  }

  public scanProjects(root: string): ProjectInfo[] {
    return Array.from(this.projects.values()).filter((p) => p.dir.startsWith(root) || root === DEFAULT_MOBILE_ROOT);
  }

  public getProject(dir: string): ProjectInfo | null {
    return this.projects.get(dir) || null;
  }

  public initProject(dir: string): ProjectInfo {
    let existing = this.projects.get(dir);
    if (existing) return existing;

    const parts = dir.replace(/\\/g, "/").split("/");
    const name = parts[parts.length - 1] || "project";
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    existing = {
      id,
      name,
      displayName: name,
      dir,
      entry: "index.tsx",
      createdAt: now,
      modifiedAt: now,
    };

    this.projects.set(dir, existing);
    if (!this.getFile(`${dir}/index.tsx`)) {
      this.setFile(`${dir}/index.tsx`, STARTER_PORTRAIT_TSX);
    }
    this.saveToStorage();
    return existing;
  }

  public resolveProject(dir: string): ProjectInfo | null {
    return this.initProject(dir);
  }

  public createProject(root: string, displayName: string): ProjectInfo {
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 64) || "project";

    let folder = slug;
    let counter = 1;
    while (this.projects.has(`${root}/${folder}`)) {
      counter++;
      folder = `${slug}-${counter}`;
    }

    const dir = `${root}/${folder}`;
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const starterCode = `export default function Project() {
  return (
    <stage background="#121212" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="${displayName}" width={1080} height={1920} fill="#18181b" active>
        <rect width={1080} height={1920} fill="#18181b" start={0} end={10} />
        <text y={960} width={1080} textAlign="center" fontFamily="Inter" fontSize={64} fill="#ffffff" start={0} end={10}>
          ${displayName}
        </text>
      </scene>
    </stage>
  );
}
`;

    const project: StoredProject = {
      id,
      name: folder,
      displayName,
      dir,
      entry: "index.tsx",
      createdAt: now,
      modifiedAt: now,
      manifest: { version: 1, folders: [], assets: [] },
      config: { duration: 10, fps: 30 },
    };

    this.projects.set(dir, project);
    this.setFile(`${dir}/index.tsx`, starterCode);
    this.setFile(`${dir}/package.json`, JSON.stringify({ projectId: id, displayName, main: "index.tsx" }, null, 2));
    this.saveToStorage();

    return project;
  }

  public renameProject(dir: string, displayName: string): ProjectInfo {
    const existing = this.projects.get(dir);
    if (!existing) throw new Error("Project not found");

    existing.displayName = displayName;
    existing.modifiedAt = new Date().toISOString();
    this.saveToStorage();
    return existing;
  }

  public duplicateProject(dir: string): ProjectInfo {
    const existing = this.projects.get(dir);
    if (!existing) throw new Error("Project not found");

    const newDisplayName = `${existing.displayName} (Copy)`;
    const newProject = this.createProject(DEFAULT_MOBILE_ROOT, newDisplayName);

    const sourceCode = this.getFile(`${dir}/${existing.entry}`) || STARTER_PORTRAIT_TSX;
    this.setFile(`${newProject.dir}/${newProject.entry}`, sourceCode);
    const stored = this.projects.get(newProject.dir);
    if (stored) {
      stored.manifest = existing.manifest;
      stored.config = existing.config;
    }
    this.saveToStorage();

    return newProject;
  }

  public deleteProject(dir: string): void {
    this.projects.delete(dir);
    this.watchers.delete(dir);
    this.removeFile(`${dir}/index.tsx`);
    this.removeFile(`${dir}/package.json`);
    this.removeFile(`${dir}/assets.yml`);
    this.saveToStorage();
  }

  public compileProject(dir: string): CompileResult {
    const existing = this.projects.get(dir);
    const entry = existing?.entry || "index.tsx";
    const source = this.getFile(`${dir}/${entry}`) || STARTER_PORTRAIT_TSX;

    return compileProjectSource(source, entry);
  }

  public writeProject(dir: string, edits: SourceEdit[]): WriteResult {
    const existing = this.projects.get(dir);
    const entry = existing?.entry || "index.tsx";
    const path = `${dir}/${entry}`;
    const source = this.getFile(path) || STARTER_PORTRAIT_TSX;

    const { source: newSource, result } = applyEditsToSource(source, edits);
    this.setFile(path, newSource);

    if (existing) {
      existing.modifiedAt = new Date().toISOString();
      this.saveToStorage();
    }

    this.notifyChange(dir, entry);
    return result;
  }

  public watchProject(dir: string): void {
    this.watchers.add(dir);
  }

  public unwatchProject(dir: string): void {
    this.watchers.delete(dir);
  }

  public readManifest(dir: string): unknown {
    const p = this.projects.get(dir);
    return p?.manifest ?? { version: 1, folders: [], assets: [] };
  }

  public writeManifest(dir: string, manifest: unknown): void {
    const p = this.projects.get(dir);
    if (p) {
      p.manifest = manifest;
      this.saveToStorage();
      this.notifyChange(dir, "assets.yml");
    }
  }

  public readConfig(dir: string): unknown {
    const p = this.projects.get(dir);
    return p?.config ?? null;
  }

  public writeConfig(dir: string, config: unknown): void {
    const p = this.projects.get(dir);
    if (p) {
      p.config = config;
      this.saveToStorage();
      this.notifyChange(dir, "package.json");
    }
  }

  public listEntries(dir: string, _source: string): FsEntry[] {
    const entries: FsEntry[] = [];
    const entryFile = this.projects.get(dir)?.entry || "index.tsx";
    entries.push({
      name: entryFile,
      kind: "file",
      size: (this.getFile(`${dir}/${entryFile}`) || "").length,
      mtime: Date.now(),
    });
    return entries;
  }

  public statEntry(dir: string, source: string): FsStat | null {
    const content = this.getFile(`${dir}/${source}`);
    if (content !== null) {
      return { size: content.length, mtime: Date.now() };
    }
    return null;
  }

  public removeEntry(dir: string, path: string): void {
    this.removeFile(`${dir}/${path}`);
    this.notifyChange(dir, path);
  }
}

export const mobileProjectsEngine = new MobileProjectsEngine();
