import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {SymbolKind} from './sjasm/project';
import {keyName, segments} from './symbols';


const TOKEN_TYPES = ['namespace', 'struct', 'property', 'macro', 'function', 'variable'];
const TOKEN_MODIFIERS = ['declaration', 'readonly'];
export const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);


/** Token type and readonly modifier for a kind of symbol. */
function tokenType(kind: SymbolKind): {type: string, readonly?: boolean} | undefined {
	switch (kind) {
		case 'module': return {type: 'namespace'};
		case 'struct': return {type: 'struct'};
		case 'field': return {type: 'property'};
		case 'macro': return {type: 'macro'};
		case 'define': return {type: 'macro', readonly: true};
		case 'label': case 'macrolocal': return {type: 'function'};
		case 'data': case 'defl': return {type: 'variable'};
		case 'equ': return {type: 'variable', readonly: true};
		default: return undefined;	// Temporary labels keep the grammar colors
	}
}


/**
 * Semantic highlighting from the symbol index: labels of code, data,
 * constants, structs, fields, macros, defines and modules get their own
 * token types, also for each part of dotted names (module.label.local).
 */
export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	public onDidChangeSemanticTokens: vscode.Event<void>;

	constructor(protected projects: ProjectManager) {
		// Kinds and resolution change with edits in other files
		this.onDidChangeSemanticTokens = projects.onDidChange;
	}


	public async provideDocumentSemanticTokens(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.SemanticTokens | undefined> {
		const config = Config.getConfigForDoc(document);
		if (!config.enableSemanticHighlighting)
			return undefined;
		const project = await this.projects.getProject(document);
		if (!project)
			return undefined;

		const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
		const occurrences = [...project.occurrencesInFile(document.fileName)].sort((a, b) => a.line - b.line || a.start - b.start);
		let lastLine = -1;
		let lastEnd = -1;
		for (const occ of occurrences) {
			if (!occ.key || occ.line >= document.lineCount)
				continue;
			if (occ.line === lastLine && occ.start < lastEnd)
				continue;	// Same position reached twice (e.g. different contexts)
			const segs = segments(occ.written);
			const full = keyName(occ.key).split('.');
			const ns = occ.key.substring(0, occ.key.indexOf(':') + 1);
			segs.forEach((seg, i) => {
				// The key of this part of the name
				let kind: SymbolKind | undefined;
				if (i === segs.length - 1)
					kind = project.getKind(occ.key!);
				else if (ns === 'L:' || ns === 'M:') {
					const index = full.length - segs.length + i;
					if (index >= 0) {
						const prefix = full.slice(0, index + 1).join('.');
						kind = project.getKind('L:' + prefix) ?? project.getKind('M:' + prefix);
					}
				}
				const type = kind && tokenType(kind);
				if (!type || seg.text.length === 0)
					return;
				const start = occ.start + (i === 0 ? 0 : seg.offset);
				const end = occ.start + seg.offset + seg.text.length;
				let modifiers = 0;
				if (occ.isDef && i === segs.length - 1)
					modifiers |= 1 << TOKEN_MODIFIERS.indexOf('declaration');
				if (type.readonly)
					modifiers |= 1 << TOKEN_MODIFIERS.indexOf('readonly');
				builder.push(occ.line, start, end - start, TOKEN_TYPES.indexOf(type.type), modifiers);
			});
			lastLine = occ.line;
			lastEnd = occ.end;
		}
		return builder.build();
	}
}
