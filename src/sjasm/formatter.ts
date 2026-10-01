/**
 * Formatter for sjasmplus sources.
 * Only whitespace (and optionally the case of keywords) is changed:
 * - the first statement of a line is moved to the instruction (or directive) column,
 * - commas and the space between mnemonic and operands are normalized,
 * - trailing comments are aligned to a column,
 * - trailing whitespace is removed.
 * Labels stay at the beginning of the line. Lines that can't be handled
 * safely (block comments, Lua, struct initializer continuations, ...) are
 * only trimmed.
 */
import {scanLine, Token, TokenKind} from './lexer';
import {parseText} from './parser';
import {CONDITIONS, DATA_DIRECTIVES, DIRECTIVES, MNEMONICS, NON_EXPRESSION_DIRECTIVES, REGISTERS, WORD_OPERATORS} from './keywords';


export interface FormatOptions {
	/** Width of a tab. */
	tabSize: number;
	/** True to indent with spaces, false with tabs. */
	insertSpaces: boolean;
	/** 'align' moves statements to the instruction/directive columns, 'keep' leaves the indentation. */
	indentation?: 'align' | 'keep';
	/** Column of the instructions, 0 = the most frequent column in the file. */
	instructionColumn?: number;
	/** Column of directives left of the instructions, 0 = the most frequent such column in the file. */
	directiveColumn?: number;
	/** Case of mnemonics, directives, registers, conditions and operator words. */
	case?: 'keep' | 'lower' | 'upper';
	/** Whitespace after commas between operands. */
	commaSpace?: 'keep' | 'none' | 'space';
	/** Whitespace between the mnemonic and the first operand. */
	operandSpacing?: 'keep' | 'space' | 'tab';
	/** Alignment of comments after code. */
	trailingComments?: 'align' | 'keep';
	/** Column of trailing comments, 0 = aligned within each group of consecutive lines. */
	commentColumn?: number;
	/** Like sjasmplus --dirbol. */
	dirbol?: boolean;
}


export interface LineEdit {
	line: number;
	text: string;
}


/** Visual width of a text (tabs expanded). */
function width(text: string, tabSize: number, startCol = 0): number {
	let col = startCol;
	for (const ch of text)
		col = ch === '\t' ? (Math.floor(col / tabSize) + 1) * tabSize : col + 1;
	return col;
}


/** Whitespace from visual column 'from' to 'to'. */
function pad(from: number, to: number, options: FormatOptions): string {
	if (options.insertSpaces)
		return ' '.repeat(to - from);
	let s = '';
	let col = from;
	while ((Math.floor(col / options.tabSize) + 1) * options.tabSize <= to) {
		s += '\t';
		col = (Math.floor(col / options.tabSize) + 1) * options.tabSize;
	}
	return s + ' '.repeat(to - col);
}


/** The most frequent value (smallest on a tie), or undefined. */
function mostFrequent(values: number[]): number | undefined {
	const counts = new Map<number, number>();
	for (const v of values)
		counts.set(v, (counts.get(v) ?? 0) + 1);
	let best: number | undefined;
	let bestCount = 0;
	for (const [v, c] of counts) {
		if (c > bestCount || (c === bestCount && v < best!)) {
			best = v;
			bestCount = c;
		}
	}
	return best;
}


interface LineInfo {
	/** Text before the first code token (the label with ':'), trimmed. */
	head: string;
	tokens: Token[];
	/** Start column of a ';' or '//' comment. */
	commentStart?: number;
	/** False if the line must not be changed (except trailing whitespace). */
	formattable: boolean;
}


/**
 * Splits a line into label field, code tokens and comment.
 * @param labelFieldEnd Column after the label field (label, SMC offset, colon), undefined without label.
 */
function analyzeLine(line: string, inBlockComment: boolean, lua: boolean, labelFieldEnd: number | undefined): LineInfo {
	const unchanged = {head: '', tokens: [], formattable: false};
	const hasLabel = labelFieldEnd !== undefined;
	if (inBlockComment || lua || line.includes('/*') || line.includes('*/') || /\\\s*$/.test(line))
		return unchanged;
	// Only indented lines and lines with a label at the beginning
	if (!hasLabel && line.length > 0 && !/^\s/.test(line))
		return unchanged;
	if (/^\s*>/.test(line))
		return unchanged;	// Indented label
	const scan = scanLine(line, 0, labelFieldEnd ?? 0);
	const tokens = scan.tokens;
	const head = hasLabel ? line.substring(0, labelFieldEnd) : '';
	// The first statement must start with an operator (or a dot repeater), not e.g. '{' or ','
	if (tokens.length > 0) {
		const t = tokens[0];
		const ok = t.kind === TokenKind.Ident || (t.kind === TokenKind.Number && t.text.startsWith('.')) || (t.kind === TokenKind.Punct && t.text === '=' && hasLabel);
		if (!ok)
			return unchanged;
	}
	return {head, tokens, commentStart: scan.lineCommentStart, formattable: true};
}


/** True if the token is a keyword whose case may be changed. */
function isKeyword(t: Token, index: number, opLower: string): boolean {
	if (t.kind !== TokenKind.Ident)
		return false;
	const lower = t.text.toLowerCase();
	if (index === 0) {
		const bare = lower.replace(/^[.@]/, '');
		return MNEMONICS.has(bare) || DIRECTIVES.has(bare);
	}
	if (NON_EXPRESSION_DIRECTIVES.has(opLower))
		return false;
	return REGISTERS.has(lower) || CONDITIONS.has(lower) || WORD_OPERATORS.has(lower);
}


/** Rebuilds the code part of a line (from the first token to the last) with the token options applied. */
function formatCode(line: string, tokens: Token[], options: FormatOptions): string {
	let out = '';
	let statementIndex = 0;	// Index of the token inside its statement
	let opLower = '';
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t.kind === TokenKind.Separator)
			statementIndex = -1;
		if (statementIndex === 0)
			opLower = t.text.toLowerCase().replace(/^[.@]/, '');
		let text = t.text;
		if (options.case && options.case !== 'keep' && isKeyword(t, statementIndex, opLower))
			text = options.case === 'lower' ? text.toLowerCase() : text.toUpperCase();
		out += text;

		const next = tokens[i + 1];
		if (!next)
			break;
		let gap = line.substring(t.end, next.start);
		const pureWhitespace = /^\s*$/.test(gap);
		if (pureWhitespace) {
			if (next.kind === TokenKind.Punct && next.text === ',' && options.commaSpace && options.commaSpace !== 'keep')
				gap = '';	// No whitespace before a comma
			else if (t.kind === TokenKind.Punct && t.text === ',' && options.commaSpace && options.commaSpace !== 'keep')
				gap = options.commaSpace === 'space' ? ' ' : '';
			else if (statementIndex === 0 && gap.length > 0 && t.kind === TokenKind.Ident && next.kind !== TokenKind.Separator && options.operandSpacing && options.operandSpacing !== 'keep')
				gap = options.operandSpacing === 'tab' ? '\t' : ' ';
		}
		out += gap;
		statementIndex++;
	}
	return out;
}



/** True if the line's first statement is a directive (not data, not an instruction or macro). */
function isDirectiveLine(info: LineInfo): boolean {
	const t = info.tokens[0];
	if (!t || t.kind !== TokenKind.Ident)
		return false;
	const op = t.text.toLowerCase().replace(/^\./, '');
	return DIRECTIVES.has(op) && !DATA_DIRECTIVES.has(op);
}


/**
 * The column of a trailing comment for a group of lines: the most frequent
 * one. Comments that don't fit go behind their code, which changes the
 * frequencies, so the column is searched until it is stable (formatting a
 * formatted text again must not change anything).
 */
function groupCommentColumn(lines: {codeWidth: number, col: number}[], separatorWidth: (codeWidth: number) => number): number {
	const placed = (c: number, codeWidth: number) => codeWidth < c ? c : separatorWidth(codeWidth);
	let col = mostFrequent(lines.map(l => l.col)) ?? 0;
	for (let n = 0; n < 10; n++) {
		const next = mostFrequent(lines.map(l => placed(col, l.codeWidth)))!;
		if (next === col)
			break;
		col = next;
	}
	return col;
}


/**
 * Formats a text.
 * Indentation: the instruction column is the most frequent one of the file
 * (or set). Lines indented deeper are nested code and keep their offset.
 * Lines indented less move to the instruction column, except directives,
 * which move to the column where the outdented directives of the file are.
 * @param text The document text.
 * @param options The format options.
 * @param fromLine First line to format (inclusive).
 * @param toLine Last line to format (inclusive).
 * @returns The changed lines.
 */
export function formatText(text: string, options: FormatOptions, fromLine = 0, toLine = Number.MAX_SAFE_INTEGER): LineEdit[] {
	const parsed = parseText(text, {dirbol: options.dirbol});
	const lines = parsed.lines;
	const infos = lines.map((line, i) => analyzeLine(line, !!parsed.parsed[i].inBlockComment, !!parsed.parsed[i].lua, parsed.parsed[i].labelFieldEnd));
	const tabSize = options.tabSize;
	const separator = options.insertSpaces ? ' ' : '\t';
	const keepIndentation = options.indentation === 'keep';

	// Original column of the first statement of each line
	const cols = infos.map((info, i) => info.formattable && info.tokens.length > 0 ? width(lines[i].substring(0, info.tokens[0].start), tabSize) : -1);
	const unlabeled = (i: number) => cols[i] >= 0 && !infos[i].head;

	// Instruction column of the file, and where it should be
	const detectedInstr = mostFrequent(cols.filter((c, i) => unlabeled(i) && !isDirectiveLine(infos[i])))
		?? mostFrequent(cols.filter((c, i) => unlabeled(i)))
		?? mostFrequent(cols.filter(c => c >= 0))	// Only lines with labels, e.g. a table of EQUs
		?? ((options.instructionColumn ?? 0) > 0 ? options.instructionColumn! : tabSize);
	const instrCol = (options.instructionColumn ?? 0) > 0 ? options.instructionColumn! : detectedInstr;
	const shift = instrCol - detectedInstr;
	// Column of directives that are outdented
	const detectedDir = mostFrequent(cols.filter((c, i) => unlabeled(i) && isDirectiveLine(infos[i]) && c < detectedInstr));
	let dirCol = options.directiveColumn ?? 0;
	if (dirCol <= 0)
		dirCol = detectedDir === undefined ? instrCol : Math.max(0, detectedDir + shift);

	// Label and code of all lines (without the comment)
	const codeParts = lines.map((line, i) => {
		const info = infos[i];
		if (!info.formattable)
			return undefined;
		if (info.tokens.length === 0)
			return info.head;
		const lastToken = info.tokens[info.tokens.length - 1];
		let code = formatCode(line, info.tokens, options);
		// Keep anything between the last token and the comment that is not whitespace
		const rest = line.substring(lastToken.end, info.commentStart ?? line.length);
		if (rest.trim())
			code += rest.trimEnd();
		if (keepIndentation)
			return line.substring(0, info.tokens[0].start) + code;
		// Nested code keeps its offset to the instruction column
		const col = cols[i];
		let target: number;
		if (col >= detectedInstr)
			target = Math.max(0, col + shift);
		else
			target = !info.head && isDirectiveLine(info) ? dirCol : instrCol;
		const headWidth = width(info.head, tabSize);
		return info.head + (headWidth < target ? pad(headWidth, target, options) : (info.head ? separator : '')) + code;
	});

	// Trailing comments: aligned per group of consecutive lines (or to a fixed column)
	const alignComments = (options.trailingComments ?? 'align') === 'align';
	const commentCols = new Map<number, number>();
	if (alignComments) {
		const hasTrailing = (i: number) => infos[i].formattable && infos[i].commentStart !== undefined && !!codeParts[i];
		const separatorWidth = (codeWidth: number) => width(separator, tabSize, codeWidth);
		for (let i = 0; i < lines.length; i++) {
			if (!hasTrailing(i))
				continue;
			let j = i;
			while (j + 1 < lines.length && hasTrailing(j + 1))
				j++;
			const group: number[] = [];
			for (let k = i; k <= j; k++)
				group.push(k);
			const col = (options.commentColumn ?? 0) > 0 ? options.commentColumn! : groupCommentColumn(
				group.map(k => ({codeWidth: width(codeParts[k]!, tabSize), col: width(lines[k].substring(0, infos[k].commentStart), tabSize)})),
				separatorWidth);
			for (const k of group)
				commentCols.set(k, col);
			i = j;
		}
	}

	const edits: LineEdit[] = [];
	const last = Math.min(toLine, lines.length - 1);
	for (let i = Math.max(0, fromLine); i <= last; i++) {
		const line = lines[i];
		const info = infos[i];
		let result = codeParts[i];
		if (result === undefined) {
			result = line.trimEnd();
		}
		else if (info.commentStart !== undefined) {
			const comment = line.substring(info.commentStart).trimEnd();
			const commentCol = commentCols.get(i);
			if (!result) {
				// Whole-line comment: keep its indentation
				result = line.substring(0, info.commentStart) + comment;
			}
			else if (commentCol !== undefined) {
				const codeWidth = width(result, tabSize);
				result += (codeWidth < commentCol ? pad(codeWidth, commentCol, options) : separator) + comment;
			}
			else {
				// Keep the original whitespace before the comment
				const before = line.substring(0, info.commentStart);
				const ws = /\s*$/.exec(before)![0];
				result += (ws || ' ') + comment;
			}
		}
		result = result.trimEnd();
		if (result !== line)
			edits.push({line: i, text: result});
	}
	return edits;
}
