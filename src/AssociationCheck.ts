import * as vscode from 'vscode';
import * as path from 'path';
import {PackageInfo} from './packageinfo';
import {CompetingLanguage, ConflictingAssociation, ContributedLanguage, findCompetingLanguages, findConflictingAssociations} from './fileassociations';


const DONT_ASK_KEY = 'associations.dontAsk';


/** What sends the assembler files to other languages. */
interface Conflicts {
	/** "files.associations" entries with other languages. */
	settings: ConflictingAssociation[];
	/** Languages of other extensions for the same file types. */
	extensions: CompetingLanguage[];
}


/** The file extensions of a language of this extension, e.g. [".asm", ".inc"]. */
function extensionsOf(id: string): string[] {
	const languages: {id: string, extensions?: string[]}[] = PackageInfo.extension.packageJSON.contributes.languages;
	return languages.find(l => l.id === id)?.extensions ?? [];
}


/** The languages contributed by the other enabled extensions. */
function otherLanguages(): ContributedLanguage[] {
	const result: ContributedLanguage[] = [];
	for (const ext of vscode.extensions.all) {
		if (ext.id === PackageInfo.extension.id)
			continue;
		const name: string | undefined = ext.packageJSON.displayName;
		const extensionName = name && !name.startsWith('%') ? name : ext.id;
		for (const l of ext.packageJSON.contributes?.languages ?? []) {
			if (typeof l?.id === 'string' && Array.isArray(l.extensions))
				result.push({extensionId: ext.id, extensionName, language: l.id, extensions: l.extensions});
		}
	}
	return result;
}


async function getConflicts(): Promise<Conflicts> {
	const associations = vscode.workspace.getConfiguration('files').get<{[pattern: string]: string}>('associations') ?? {};
	const sources = extensionsOf('sjasmplus');
	const listings = extensionsOf('sjasmplus-list');
	return {
		settings: findConflictingAssociations(associations, sources, listings, await vscode.languages.getLanguages()),
		extensions: findCompetingLanguages(otherLanguages(), associations, sources, listings)
	};
}


/** The globs a fix associates with sjasmplus, e.g. ["*.asm", "*.inc"]. */
function patternsOf(conflicts: Conflicts): string[] {
	return [...new Set([...conflicts.settings.map(c => c.pattern), ...conflicts.extensions.map(c => c.pattern)])];
}


/** E.g. '"Z80 Macro-Assembler" (mborik.z80-macroasm) also opens .asm, .inc'. */
function describeExtensions(competing: CompetingLanguage[]): string[] {
	const byExtension = new Map<string, CompetingLanguage[]>();
	for (const c of competing)
		byExtension.set(c.extensionId, [...(byExtension.get(c.extensionId) ?? []), c]);
	return [...byExtension.values()].map(list => `"${list[0].extensionName}" (${list[0].extensionId}) also opens ${[...new Set(list.map(c => c.extension))].join(', ')}`);
}


/** True while a question is shown or after it was answered in this session. */
let asked = false;


/**
 * Asks to associate the assembler files with sjasmplus.
 * @param reason Why, e.g. 'the setting "files.associations" has ...'.
 */
async function offerFix(context: vscode.ExtensionContext, conflicts: Conflicts, reason: string) {
	asked = true;
	const workspace = 'In this workspace';
	const everywhere = 'Everywhere';
	const never = "Don't ask again";
	const buttons = vscode.workspace.workspaceFolders ? [workspace, everywhere, never] : [everywhere, never];
	const answer = await vscode.window.showInformationMessage(
		`sjasmplus Code Lens: ${reason}. Associate ${patternsOf(conflicts).join(', ')} with sjasmplus?`,
		...buttons);
	if (answer === never)
		await context.globalState.update(DONT_ASK_KEY, true);
	else if (answer === workspace)
		await fixFileAssociations('workspace');
	else if (answer === everywhere)
		await fixFileAssociations('everywhere');
}


/**
 * Offers to associate the assembler files with sjasmplus if
 * "files.associations" sends them to another language, e.g. to
 * "asm-collection" of ASM Code Lens 2.
 * @param always Command: ask even if the user chose "Don't ask again", and
 * also about other extensions that contribute the same file types.
 */
export async function checkFileAssociations(context: vscode.ExtensionContext, always = false) {
	if (!always && (asked || context.globalState.get<boolean>(DONT_ASK_KEY)))
		return;
	const conflicts = await getConflicts();
	if (!always)
		conflicts.extensions = [];	// Only reported when a file really opens in another language
	const reasons: string[] = [];
	if (conflicts.settings.length > 0)
		reasons.push(`the setting "files.associations" has ${conflicts.settings.map(c => `"${c.pattern}": "${c.language}"${c.missing ? ' (not installed)' : ''}`).join(', ')}`);
	reasons.push(...describeExtensions(conflicts.extensions));
	if (reasons.length === 0) {
		if (always)
			await vscode.window.showInformationMessage('sjasmplus Code Lens: the file associations are fine.');
		return;
	}
	await offerFix(context, conflicts, reasons.join('; '));
}


/**
 * Offers to associate the assembler files with sjasmplus if the
 * document is an assembler file that another extension took.
 */
async function checkDocument(context: vscode.ExtensionContext, doc: vscode.TextDocument) {
	if (asked || doc.uri.scheme !== 'file' || doc.languageId === 'sjasmplus' || doc.languageId === 'sjasmplus-list')
		return;
	const ext = path.extname(doc.fileName).toLowerCase();
	if (![...extensionsOf('sjasmplus'), ...extensionsOf('sjasmplus-list')].some(e => e.toLowerCase() === ext))
		return;
	if (context.globalState.get<boolean>(DONT_ASK_KEY))
		return;
	const conflicts = await getConflicts();
	// Not when the user chose the language for this file or in "files.associations"
	const taker = conflicts.extensions.find(c => c.extension === ext && c.language === doc.languageId);
	if (!taker || asked)
		return;
	await offerFix(context, conflicts, `${path.basename(doc.fileName)} is opened as "${doc.languageId}" of the extension "${taker.extensionName}", so this extension does not work on it`);
}


/**
 * Checks "files.associations" now and every opened document, see
 * checkFileAssociations() and checkDocument().
 */
export function watchFileAssociations(context: vscode.ExtensionContext) {
	const check = (doc: vscode.TextDocument) => checkDocument(context, doc).catch(e => console.log(e));
	checkFileAssociations(context).then(() => vscode.workspace.textDocuments.forEach(check)).catch(e => console.log(e));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(check));
}


/**
 * Associates the assembler files with sjasmplus.
 * @param scope 'workspace': in the workspace settings (overrides the user settings),
 * 'everywhere': where the conflicting entries are defined (user and workspace
 * settings), file types of other extensions in the user settings.
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
		for (const c of conflicts.settings) {
			if (scope === 'workspace' || (value && c.pattern in value)) {
				updated[c.pattern] = c.target;
				changed = true;
			}
		}
		if (scope === 'workspace' || target === vscode.ConfigurationTarget.Global) {
			for (const c of conflicts.extensions) {
				updated[c.pattern] = c.target;
				changed = true;
			}
		}
		if (changed)
			await files.update('associations', updated, target);
	}
}
