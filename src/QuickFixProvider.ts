import * as vscode from 'vscode';
import {DIAGNOSTIC_SOURCE, UNRESOLVED_LABEL} from './DiagnosticsProvider';
import {ProjectManager} from './projectmanager';


/**
 * Quick fixes for "Label not found": the labels that the reference may have meant, written the way
 * they resolve at that place (with the module, with @ if a name of the module hides a global label).
 */
export class QuickFixProvider implements vscode.CodeActionProvider {
	public static readonly kinds = [vscode.CodeActionKind.QuickFix];


	constructor(protected projects: ProjectManager) {
	}


	public async provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[] | undefined> {
		const unresolved = context.diagnostics.filter(d => d.source === DIAGNOSTIC_SOURCE && d.message.startsWith(UNRESOLVED_LABEL));
		if (unresolved.length === 0)
			return undefined;
		const project = await this.projects.getProject(document);
		if (!project)
			return undefined;
		const actions: vscode.CodeAction[] = [];
		for (const diagnostic of unresolved) {
			// A warning that is older than the text (the name was edited since) is not fixed
			const written = document.getText(diagnostic.range);
			if (written !== diagnostic.message.substring(UNRESOLVED_LABEL.length))
				continue;
			const suggestions = project.suggestLabels(document.fileName, diagnostic.range.start.line, written);
			suggestions.forEach(text => {
				const action = new vscode.CodeAction(`Change to '${text}'`, vscode.CodeActionKind.QuickFix);
				action.edit = new vscode.WorkspaceEdit();
				action.edit.replace(document.uri, diagnostic.range, text);
				action.diagnostics = [diagnostic];
				// With a single suggestion there is nothing to choose from
				action.isPreferred = suggestions.length === 1;
				actions.push(action);
			});
		}
		return actions;
	}
}
