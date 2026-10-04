/**
 * Folding ranges of an sjasmplus source: blocks, labels and comments.
 * Without vscode imports, so it can be unit tested.
 */
import {parseText, ParsedLine} from './parser';


export interface FoldRange {
	start: number;
	end: number;
	kind?: 'region' | 'comment';
}


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


/**
 * The folding ranges of a source:
 * - blocks (MODULE, STRUCT, MACRO, DUP, IF..., LUA),
 * - labels up to the next label, inside the blocks they are in,
 * - comment blocks.
 * The ranges are nested or apart: VS Code drops one of two ranges that overlap otherwise.
 */
export function getFoldingRanges(text: string): FoldRange[] {
	const {lines, parsed} = parseText(text);
	const ranges: FoldRange[] = [];
	const add = (start: number, end: number, kind?: 'region' | 'comment') => {
		if (end > start)
			ranges.push(kind ? {start, end, kind} : {start, end});
	};

	// Blocks
	const blocks: {start: number, end: number}[] = [];
	const stack: {op: string, line: number}[] = [];
	parsed.forEach((pl, line) => {
		for (const st of pl.statements) {
			const op = st.opLower;
			if (BLOCK_ENDS[op])
				stack.push({op, line});
			else {
				const i = findLastIndex(stack, b => BLOCK_ENDS[b.op].includes(op));
				if (i >= 0) {
					add(stack[i].line, line, 'region');
					if (line > stack[i].line)
						blocks.push({start: stack[i].line, end: line});
					stack.splice(i);
				}
			}
		}
	});

	// Labels: a non-local label up to the next non-local label, a local label up to the next label.
	// A label in a block ends before the end of the block; a label before a block that it would
	// not contain completely ends before the block ("if" and a label right below it). A label on
	// the line of a block ("init IFDEF X") leaves the line to the block: one range per line.
	const isBlank = (pl: ParsedLine) => !pl.label && pl.statements.length === 0;
	const addLabel = (from: number, to: number) => {
		if (blocks.some(b => b.start === from))
			return;
		let end = to - 1;
		for (const b of blocks) {
			if (b.start < from && from <= b.end)
				end = Math.min(end, b.end - 1);
		}
		for (let changed = true; changed;) {
			changed = false;
			for (const b of blocks) {
				if (b.start > from && b.start <= end && b.end > end) {
					end = b.start - 1;
					changed = true;
				}
			}
		}
		while (end > from && isBlank(parsed[end]))
			end--;
		add(from, end);
	};
	let mainStart = -1;
	let localStart = -1;
	const closeLocal = (line: number) => {
		if (localStart >= 0)
			addLabel(localStart, line);
		localStart = -1;
	};
	const closeMain = (line: number) => {
		closeLocal(line);
		if (mainStart >= 0)
			addLabel(mainStart, line);
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
			add(commentStart, line - 1, 'comment');
			commentStart = -1;
		}
	});
	if (commentStart >= 0)
		add(commentStart, parsed.length - 1, 'comment');

	return ranges;
}


function findLastIndex<T>(list: T[], predicate: (t: T) => boolean): number {
	for (let i = list.length - 1; i >= 0; i--)
		if (predicate(list[i]))
			return i;
	return -1;
}
