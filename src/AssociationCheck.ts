import * as vscode from 'vscode';
import {PackageInfo} from './packageinfo';
import {ConflictingAssociation, findConflictingAssociations} from './fileassociations';


const DONT_ASK_KEY = 'associations.dontAsk';


/** The "files.associations" entries that send the assembler files to another language. */
async function getConflicts(): Promise<ConflictingAssociation[]> {
	const languages: {id: string, extensions?: string[]}[] = PackageInfo.extension.packageJSON.contributes.languages;
	const extensionsOf = (id: string) => languages.find(l => l.id === id)?.extensions ?? [];
	const associations = vscode.workspace.getConfiguration('files').get<{[pattern: string]: string}>('associations') ?? {};
	return findConflictingAssociations(associations, extensionsOf('sjasmplus'), extensionsOf('sjasmplus-list'), await vscode.languages.getLanguages());
}


/**
 * Offers to associate the assembler files with sjasmplus if
 * "files.associations" sends them to another language, e.g. to
 * "asm-collection" of ASM Code Lens 2.
 * @param always Ask even if the user chose "Don't ask again" (command).
 */
export async function checkFileAssociations(context: vscode.ExtensionContext, always = false) {
	if (!always && context.globalState.get<boolean>(DONT_ASK_KEY))
		return;
	const conflicts = await getConflicts();
	if (conflicts.length === 0) {
		if (always)
			await vscode.window.showInformationMessage('sjasmplus Code Lens: the file associations are fine.');
		return;
	}

	const list = conflicts.map(c => `"${c.pattern}": "${c.language}"${c.missing ? ' (not installed)' : ''}`).join(', ');
	const workspace = 'Use sjasmplus in this workspace';
	const everywhere = 'Use sjasmplus everywhere';
	const never = "Don't ask again";
	const buttons = vscode.workspace.workspaceFolders ? [workspace, everywhere, never] : [everywhere, never];
	const answer = await vscode.window.showInformationMessage(
		`sjasmplus Code Lens: the setting "files.associations" has ${list}, so these files are not opened as sjasmplus.`,
		...buttons);
	if (answer === never)
		await context.globalState.update(DONT_ASK_KEY, true);
	else if (answer === workspace)
		await fixFileAssociations('workspace');
	else if (answer === everywhere)
		await fixFileAssociations('everywhere');
}


/**
 * Associates the assembler files with sjasmplus.
 * @param scope 'workspace': in the workspace settings (overrides the user settings),
 * 'everywhere': where the conflicting entries are defined (user and workspace settings).
 */
export async function fixFileAssociations(scope: 'workspace' | 'everywhere') {
	const conflicts = await getConflicts();
	const files = vscode.workspace.getConfiguration('files');
	const inspected = files.inspect<{[pattern: string]: string}>('associations');
	const targets: {target: vscode.ConfigurationTarget, value: {[pattern: string]: string} | undefined}[] = scope === 'workspace'
		? [{target: vscode.ConfigurationTarget.Workspace, value: inspected?.workspaceValue}]
		: [{target: vscode.ConfigurationTarget.Global, value: inspected?.globalValue}, {target: vscode.ConfigurationTarget.Workspace, value: inspected?.workspaceValue}];
	for (const {target, value} of targets) {
		if (target === vscode.ConfigurationTarget.Workspace && !vscode.workspace.workspaceFolders)
			continue;
		const updated = {...(value ?? {})};
		let changed = false;
		for (const c of conflicts) {
			if (scope === 'workspace' || (value && c.pattern in value)) {
				updated[c.pattern] = c.target;
				changed = true;
			}
		}
		if (changed)
			await files.update('associations', updated, target);
	}
}
