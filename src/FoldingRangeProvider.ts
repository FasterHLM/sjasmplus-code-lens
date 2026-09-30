import * as vscode from 'vscode';
import {Config} from './config';
import {parseText, ParsedLine} from './sjasm/parser';



/** Block directives and their end directives. */
const BLOCK_ENDS: {[start: string]: string[]} = {
	module: ['endmodule', 'endmod'],
	struct: ['ends'],
	macro: ['endm'],
	dup: ['edup', 'endr'],
	rept: ['edup', 'endr'],
	while: ['endw'],
	if: ['endif'],
	ifn: ['endif'],
	ifdef: ['endif'],
	ifndef: ['endif'],
	ifused: ['endif'],
	ifnused: ['endif'],
	lua: ['endlua']
};

/** Directives that end the region of a label. */
const LABEL_REGION_BREAKS = new Set(['module', 'endmodule', 'endmod', 'struct', 'ends', 'macro', 'endm']);


/** The folding Provider.
 * Only for asm files not for list files.
 */
export class FoldingProvider implements vscode.FoldingRangeProvider {

	/** Returns a list of folding ranges:
	 * - blocks (MODULE, STRUCT, MACRO, DUP, IF..., LUA),
	 * - labels up to the next label,
	 * - comment blocks.
	 * @param document The document in which the command was invoked.
	 * @param context Additional context information (for future use)
	 * @param token A cancellation token.
	 */
	provideFoldingRanges(document: vscode.TextDocument, _context: vscode.FoldingContext, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
		const config = Config.getConfigForDoc(document);
		if (!config.enableFolding)
			return [];

		const {lines, parsed} = parseText(document.getText());
		const ranges: vscode.FoldingRange[] = [];
		const add = (start: number, end: number, kind?: vscode.FoldingRangeKind) => {
			if (end > start)
				ranges.push(new vscode.FoldingRange(start, end, kind));
		};

		// Blocks
		const stack: {op: string, line: number}[] = [];
		parsed.forEach((pl, line) => {
			for (const st of pl.statements) {
				const op = st.opLower;
				if (BLOCK_ENDS[op])
					stack.push({op, line});
				else {
					const i = findLastIndex(stack, b => BLOCK_ENDS[b.op].includes(op));
					if (i >= 0) {
						add(stack[i].line, line, vscode.FoldingRangeKind.Region);
						stack.splice(i);
					}
				}
			}
		});

		// Labels: a non-local label up to the next non-local label, a local label up to the next label
		const isBlank = (pl: ParsedLine) => !pl.label && pl.statements.length === 0;
		const endBefore = (from: number, to: number) => {
			let end = to - 1;
			while (end > from && isBlank(parsed[end]))
				end--;
			return end;
		};
		let mainStart = -1;
		let localStart = -1;
		const closeLocal = (line: number) => {
			if (localStart >= 0)
				add(localStart, endBefore(localStart, line));
			localStart = -1;
		};
		const closeMain = (line: number) => {
			closeLocal(line);
			if (mainStart >= 0)
				add(mainStart, endBefore(mainStart, line));
			mainStart = -1;
		};
		parsed.forEach((pl, line) => {
			if (pl.statements.some(s => LABEL_REGION_BREAKS.has(s.opLower))) {
				closeMain(line);
				return;
			}
			const label = pl.label?.text;
			if (!label || /^\d/.test(label))
				return;
			if (label.startsWith('.') || label.startsWith('@.')) {
				closeLocal(line);
				localStart = line;
			}
			else {
				closeMain(line);
				mainStart = line;
			}
		});
		closeMain(parsed.length);

		// Comments: consecutive comment-only lines and block comments
		let commentStart = -1;
		parsed.forEach((pl, line) => {
			const commentOnly = pl.inBlockComment || (isBlank(pl) && (pl.commentStart !== undefined || /^\s*\/\*/.test(lines[line])));
			if (commentOnly) {
				if (commentStart < 0)
					commentStart = line;
			}
			else if (commentStart >= 0) {
				add(commentStart, line - 1, vscode.FoldingRangeKind.Comment);
				commentStart = -1;
			}
		});
		if (commentStart >= 0)
			add(commentStart, parsed.length - 1, vscode.FoldingRangeKind.Comment);

		return ranges;
	}
}


function findLastIndex<T>(list: T[], predicate: (t: T) => boolean): number {
	for (let i = list.length - 1; i >= 0; i--)
		if (predicate(list[i]))
			return i;
	return -1;
}
