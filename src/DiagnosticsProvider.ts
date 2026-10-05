import * as vscode from 'vscode';
import {PackageInfo} from './packageinfo';
import {ProjectManager, SOURCE_LANGUAGE} from './projectmanager';


/** The source and the start of the message of the diagnostics of references to labels that are not found (the quick fixes look for them). */
export const DIAGNOSTIC_SOURCE = 'sjasmplus Code Lens';
export const UNRESOLVED_LABEL = 'Label not found: ';


const SEVERITIES: {[name: string]: vscode.DiagnosticSeverity} = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	information: vscode.DiagnosticSeverity.Information,
	hint: vscode.DiagnosticSeverity.Hint
};


/**
 * Reports references to labels that are not defined anywhere ("Label not
 * found", like sjasmplus). Skipped: blocks that are not assembled, macros,
 * defines, and files no program includes.
 * Also dims the lines of conditional blocks that are not assembled.
 */
export class DiagnosticsProvider implements vscode.Disposable {
	protected collection = vscode.languages.createDiagnosticCollection('sjasmplus');
	protected dimDecoration = vscode.window.createTextEditorDecorationType({opacity: '0.5'});
	protected disposables: vscode.Disposable[] = [];


	constructor(protected projects: ProjectManager) {
		this.disposables.push(
			this.collection,
			this.dimDecoration,
			projects.onDidChange(() => this.update()),
			vscode.window.onDidChangeVisibleTextEditors(() => this.updateDecorations()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(PackageInfo.extension.packageJSON.name))
					this.update();
			})
		);
		this.update();
	}


	public dispose() {
		for (const d of this.disposables)
			d.dispose();
	}


	protected async update() {
		await this.updateDiagnostics();
		await this.updateDecorations();
	}


	protected async updateDiagnostics() {
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const {folder, project} of await this.projects.getFolderProjectsWithFolders()) {
			const settings = PackageInfo.getConfiguration(folder);
			const severity = SEVERITIES[settings.get<string>('diagnostics.unresolvedLabels') ?? 'warning'];
			if (severity === undefined)
				continue;	// off
			for (const ref of project.getReportableUnresolved()) {
				const diagnostic = new vscode.Diagnostic(new vscode.Range(ref.line, ref.start, ref.line, ref.end), UNRESOLVED_LABEL + ref.written, severity);
				diagnostic.source = DIAGNOSTIC_SOURCE;
				let list = byFile.get(ref.file);
				if (!list)
					byFile.set(ref.file, list = []);
				list.push(diagnostic);
			}
		}
		this.collection.clear();
		for (const [file, diagnostics] of byFile)
			this.collection.set(vscode.Uri.file(file), diagnostics);
	}


	protected async updateDecorations() {
		for (const editor of vscode.window.visibleTextEditors) {
			const doc = editor.document;
			if (doc.languageId !== SOURCE_LANGUAGE)
				continue;
			const enabled = PackageInfo.getConfiguration(vscode.workspace.getWorkspaceFolder(doc.uri)).get<boolean>('dimInactiveBlocks') ?? true;
			const project = enabled ? this.projects.getLoadedProject(doc) : undefined;
			const ranges = (project?.getInactiveLines(doc.fileName) ?? [])
				.filter(line => line < doc.lineCount)
				.map(line => doc.lineAt(line).range);
			editor.setDecorations(this.dimDecoration, ranges);
		}
	}
}
