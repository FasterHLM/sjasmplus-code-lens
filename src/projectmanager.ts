import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {Project, ProjectOptions} from './sjasm/project';
import {LanguageId} from './languageId';
import {PackageInfo} from './packageinfo';


export const SOURCE_LANGUAGE = 'sjasmplus';
export const LISTING_LANGUAGE = 'sjasmplus-list';


interface FolderProject {
	project: Project;
	/** Resolves when all files of the folder have been read. */
	loading?: Promise<void>;
}


/**
 * Owns the sjasmplus projects:
 * - one project per workspace folder with all sjasmplus sources of the folder,
 * - one project per listing file and per source file outside of any workspace folder.
 * Keeps them in sync with the editor and the file system.
 */
export class ProjectManager implements vscode.Disposable {
	protected folders = new Map<string, FolderProject>();
	protected singles = new Map<string, Project>();
	protected disposables: vscode.Disposable[] = [];
	protected changeEmitter = new vscode.EventEmitter<void>();
	protected changeTimer: NodeJS.Timeout | undefined;

	/** Fired (debounced) when any project content changed. */
	public readonly onDidChange = this.changeEmitter.event;


	constructor() {
		this.disposables.push(
			this.changeEmitter,
			vscode.workspace.onDidChangeTextDocument(e => this.documentChanged(e.document)),
			vscode.workspace.onDidOpenTextDocument(doc => this.documentChanged(doc)),
			vscode.workspace.onDidCloseTextDocument(doc => this.documentClosed(doc)),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.reset()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(PackageInfo.extension.packageJSON.name) || e.affectsConfiguration('files.associations') || e.affectsConfiguration('files.encoding'))
					this.reset();
			})
		);
		this.createWatcher();
	}


	public dispose() {
		clearTimeout(this.changeTimer);
		this.watcher?.dispose();
		for (const d of this.disposables)
			d.dispose();
	}


	protected watcher: vscode.FileSystemWatcher | undefined;

	protected createWatcher() {
		this.watcher?.dispose();
		const glob = LanguageId.getGlobalIncludeForLanguageId(SOURCE_LANGUAGE);
		this.watcher = vscode.workspace.createFileSystemWatcher(glob);
		// New or deleted files: the folder is read again on the next request
		this.watcher.onDidCreate(uri => this.invalidateFolder(uri));
		this.watcher.onDidDelete(uri => this.invalidateFolder(uri));
		this.watcher.onDidChange(uri => this.fileChangedOnDisk(uri));
	}


	/** Drops all projects (e.g. after a settings change). */
	public reset() {
		this.folders.clear();
		this.singles.clear();
		this.createWatcher();
		this.fireChange();
	}


	/**
	 * Returns the up-to-date project for a document (loads the workspace folder on first use).
	 * The document itself is always part of the returned project.
	 */
	public async getProject(doc: vscode.TextDocument): Promise<Project | undefined> {
		if (doc.languageId !== SOURCE_LANGUAGE && doc.languageId !== LISTING_LANGUAGE)
			return undefined;
		let project: Project;
		const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
		if (doc.languageId === SOURCE_LANGUAGE && folder) {
			const fp = this.getFolderProject(folder);
			await fp.loading;
			project = fp.project;
			if (!project.hasFile(doc.fileName))
				project.setFile(doc.fileName, doc.getText());
		}
		else {
			project = this.getSingleProject(doc);
		}
		project.update();
		return project;
	}


	/** Returns the projects of all workspace folders (loaded). */
	public async getFolderProjects(): Promise<Project[]> {
		const projects: Project[] = [];
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const fp = this.getFolderProject(folder);
			await fp.loading;
			fp.project.update();
			projects.push(fp.project);
		}
		return projects;
	}


	protected getFolderProject(folder: vscode.WorkspaceFolder): FolderProject {
		const key = folder.uri.toString();
		let fp = this.folders.get(key);
		if (!fp) {
			const project = new Project(this.projectOptions(folder));
			fp = {project};
			fp.loading = this.loadFolder(folder, project);
			this.folders.set(key, fp);
		}
		return fp;
	}


	protected getSingleProject(doc: vscode.TextDocument): Project {
		const key = doc.uri.toString();
		let project = this.singles.get(key);
		if (!project) {
			project = new Project(this.projectOptions(vscode.workspace.getWorkspaceFolder(doc.uri), path.dirname(doc.fileName)));
			this.singles.set(key, project);
		}
		project.setFile(doc.fileName, doc.getText(), doc.languageId === LISTING_LANGUAGE);
		return project;
	}


	/** Include paths (setting, relative to the folder) plus the folder itself, and the dirbol setting. */
	protected projectOptions(folder: vscode.WorkspaceFolder | undefined, fallbackDir?: string): ProjectOptions {
		const settings = PackageInfo.getConfiguration(folder);
		const baseDir = folder?.uri.fsPath ?? fallbackDir ?? '';
		const configured = settings.get<string[]>('includePaths') ?? [];
		const includePaths = configured.map(p => {
			const replaced = p.replace(/\$\{workspaceFolder\}/g, baseDir);
			return path.resolve(baseDir, replaced);
		});
		if (baseDir)
			includePaths.push(baseDir);
		return {
			includePaths,
			dirbol: settings.get<boolean>('dirbol') ?? false,
			readFile: filePath => this.readFileSync(filePath)
		};
	}


	protected async loadFolder(folder: vscode.WorkspaceFolder, project: Project) {
		const settings = PackageInfo.getConfiguration(folder);
		const exclude = settings.get<string>('excludeFiles') || undefined;
		const glob = LanguageId.getGlobalIncludeForLanguageId(SOURCE_LANGUAGE);
		const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), exclude);
		const openDocs = new Map(vscode.workspace.textDocuments.map(d => [d.uri.toString(), d]));
		await Promise.all(uris.map(async uri => {
			const doc = openDocs.get(uri.toString());
			if (doc && doc.languageId === SOURCE_LANGUAGE) {
				project.setFile(uri.fsPath, doc.getText());
				return;
			}
			const text = await this.readFile(uri.fsPath);
			if (text !== undefined)
				project.setFile(uri.fsPath, text);
		}));
	}


	/**
	 * Decodes a file the way the editor would, as far as columns are concerned:
	 * UTF-8, or one character per byte for single byte encodings (e.g. cp1251).
	 */
	protected decode(buffer: Buffer, filePath: string): string {
		const encoding = vscode.workspace.getConfiguration('files', vscode.Uri.file(filePath)).get<string>('encoding') ?? 'utf8';
		if (encoding === 'utf8' || encoding === 'utf8bom')
			return buffer.toString('utf8');
		return buffer.toString('latin1');
	}


	protected async readFile(filePath: string): Promise<string | undefined> {
		try {
			return this.decode(await fs.promises.readFile(filePath), filePath);
		}
		catch {
			return undefined;
		}
	}


	protected readFileSync(filePath: string): string | undefined {
		// An open document has precedence (may be unsaved)
		const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
		if (doc)
			return doc.getText();
		try {
			return this.decode(fs.readFileSync(filePath), filePath);
		}
		catch {
			return undefined;
		}
	}


	protected documentChanged(doc: vscode.TextDocument) {
		if (doc.uri.scheme !== 'file')
			return;
		const single = this.singles.get(doc.uri.toString());
		if (single) {
			single.setFile(doc.fileName, doc.getText(), doc.languageId === LISTING_LANGUAGE);
			this.fireChange();
			return;
		}
		if (doc.languageId !== SOURCE_LANGUAGE)
			return;
		const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
		const fp = folder && this.folders.get(folder.uri.toString());
		if (fp) {
			fp.project.setFile(doc.fileName, doc.getText());
			this.fireChange();
		}
		// Files included from outside the folder
		for (const other of this.folders.values())
			if (other !== fp)
				other.project.invalidateExternal(doc.fileName);
	}


	protected documentClosed(doc: vscode.TextDocument) {
		if (doc.uri.scheme !== 'file')
			return;
		this.singles.delete(doc.uri.toString());
		// Unsaved changes are discarded: use the file on disk again
		this.fileChangedOnDisk(doc.uri);
	}


	protected fileChangedOnDisk(uri: vscode.Uri) {
		// The open document is authoritative
		if (vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString()))
			return;
		for (const fp of this.folders.values()) {
			if (fp.project.hasFile(uri.fsPath)) {
				const text = this.readFileSync(uri.fsPath);
				if (text === undefined)
					fp.project.removeFile(uri.fsPath);
				else
					fp.project.setFile(uri.fsPath, text);
			}
			else
				fp.project.invalidateExternal(uri.fsPath);
		}
		this.fireChange();
	}


	protected invalidateFolder(uri: vscode.Uri) {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (folder)
			this.folders.delete(folder.uri.toString());
		for (const fp of this.folders.values())
			fp.project.invalidateExternal(uri.fsPath);
		this.fireChange();
	}


	protected fireChange() {
		clearTimeout(this.changeTimer);
		this.changeTimer = setTimeout(() => this.changeEmitter.fire(), 500);
	}
}
