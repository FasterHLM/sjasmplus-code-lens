import * as vscode from 'vscode';
import {Occurrence, Project, SymbolDef, SymbolKind} from './sjasm/project';


/** A vscode location for a definition, reference or occurrence. */
export function toLocation(item: {file: string, line: number, start: number, end: number}): vscode.Location {
	return new vscode.Location(vscode.Uri.file(item.file), new vscode.Range(item.line, item.start, item.line, item.end));
}


/** The length of the prefix characters of a written symbol ('@', '!', '.', '@.'). */
export function prefixLength(written: string): number {
	return /^(@\.|[@!.])?/.exec(written)![0].length;
}


/** The name parts of a written symbol with their column offsets (relative to the written text). */
export function segments(written: string): {text: string, offset: number}[] {
	const result: {text: string, offset: number}[] = [];
	let offset = prefixLength(written);
	for (const text of written.substring(offset).split('.')) {
		result.push({text, offset});
		offset += text.length + 1;
	}
	return result;
}


/** The full name of a symbol key (without the name space prefix). */
export function keyName(key: string): string {
	return key.substring(key.indexOf(':') + 1);
}


/**
 * Returns the symbol keys at a position.
 * If the position is on a leading part of a dotted name (e.g. on "vdp" of
 * "vdp.Cls") the key of that part (label, struct or module) is returned.
 */
export function keysAt(project: Project, filePath: string, position: vscode.Position): {occurrence: Occurrence, keys: string[]}[] {
	const result: {occurrence: Occurrence, keys: string[]}[] = [];
	for (const occ of project.occurrencesAt(filePath, position.line, position.character)) {
		if (!occ.key) {
			result.push({occurrence: occ, keys: []});
			continue;
		}
		const keys = [occ.key];
		if (occ.key.startsWith('L:')) {
			const segs = segments(occ.written);
			const col = position.character - occ.start;
			const index = segs.findIndex(s => col >= s.offset && col <= s.offset + s.text.length);
			if (index >= 0 && index < segs.length - 1) {
				const full = keyName(occ.key).split('.');
				const targetIndex = full.length - segs.length + index;
				if (targetIndex >= 0) {
					const prefix = full.slice(0, targetIndex + 1).join('.');
					const candidates = ['L:' + prefix, 'M:' + prefix].filter(k => project.getDefinitions(k).length > 0);
					if (candidates.length > 0)
						keys.splice(0, 1, ...candidates);
				}
			}
		}
		result.push({occurrence: occ, keys});
	}
	return result;
}


/**
 * Best effort for unresolved references (e.g. inside macros or with
 * missing context): definitions whose full name ends with the written name.
 */
export function guessDefinitions(project: Project, written: string): SymbolDef[] {
	const name = written.replace(/^(@\.|[@!])/, '');
	return project.getAllDefinitions().filter(d =>
		(d.key.startsWith('L:') || d.key.startsWith('X:') || d.key.startsWith('D:'))
		&& (d.name === name || d.name.endsWith(name.startsWith('.') ? name : '.' + name)));
}


const kindTexts: {[k in SymbolKind]: string} = {
	label: 'label',
	data: 'data label',
	equ: 'constant (EQU)',
	defl: 'variable (DEFL)',
	struct: 'struct',
	field: 'struct field',
	macro: 'macro',
	module: 'module',
	define: 'define',
	temp: 'temporary label',
	macrolocal: 'macro local label'
};

export function kindText(kind: SymbolKind): string {
	return kindTexts[kind];
}


export function isLocal(def: SymbolDef): boolean {
	return def.written.startsWith('.') || def.written.startsWith('@.');
}


export function symbolKind(def: SymbolDef): vscode.SymbolKind {
	switch (def.kind) {
		case 'data': return vscode.SymbolKind.Variable;
		case 'equ': return vscode.SymbolKind.Constant;
		case 'defl': return vscode.SymbolKind.Variable;
		case 'struct': return vscode.SymbolKind.Struct;
		case 'field': return vscode.SymbolKind.Field;
		case 'macro': return vscode.SymbolKind.Interface;
		case 'module': return vscode.SymbolKind.Module;
		case 'define': return vscode.SymbolKind.Constant;
		default: return vscode.SymbolKind.Function;
	}
}


export function completionKind(def: SymbolDef): vscode.CompletionItemKind {
	switch (def.kind) {
		case 'data': return vscode.CompletionItemKind.Variable;
		case 'equ': return vscode.CompletionItemKind.Constant;
		case 'defl': return vscode.CompletionItemKind.Variable;
		case 'struct': return vscode.CompletionItemKind.Struct;
		case 'field': return vscode.CompletionItemKind.Field;
		case 'macro': return vscode.CompletionItemKind.Method;
		case 'module': return vscode.CompletionItemKind.Module;
		case 'define': return vscode.CompletionItemKind.Constant;
		default: return vscode.CompletionItemKind.Function;
	}
}
