/**
 * Line parser for sjasmplus sources.
 * Turns each text line into an optional label field and the statements
 * (operator + operands) that follow it. No semantics here: modules,
 * structs, macros etc. are interpreted by the project walk.
 */
import {scanLine, Token, TokenKind} from './lexer';
import {DIRECTIVES} from './keywords';


export interface ParseOptions {
	/** True for sjasmplus listing files (address/bytes prefix is skipped). */
	listing?: boolean;
	/** Like sjasmplus --dirbol: directives are recognized at the beginning of a line. */
	dirbol?: boolean;
}


/** The label at the beginning of a line, as written. */
export interface LabelField {
	/** E.g. "Main", ".loop", "@Global", "!Keep", "@.local", "1" (temporary label). */
	text: string;
	start: number;
	end: number;
}


export interface Statement {
	/** The operator token: mnemonic, directive, macro or struct name, or '='. */
	op?: Token;
	/** The operator as written, without a leading '@'. */
	opText: string;
	/** Lower case of opText, for keyword comparison. */
	opLower: string;
	/** True if written as '@op' (inhibits macro expansion). */
	inhibit: boolean;
	operands: Token[];
}


export interface ParsedLine {
	label?: LabelField;
	/** Column after the label field (label, SMC offset and colon). */
	labelFieldEnd?: number;
	statements: Statement[];
	/** Column of a ';' or '//' comment on the line. */
	commentStart?: number;
	/** True for lines inside a LUA ... ENDLUA block. */
	lua?: boolean;
	/** True if the line starts inside a block comment. */
	inBlockComment?: boolean;
}


export interface ParsedText {
	/** The raw text lines. */
	lines: string[];
	/** Parse result per line (same indices as 'lines'). */
	parsed: ParsedLine[];
}


/** Width of the address/bytes prefix in sjasmplus listing files. */
export const LISTING_PREFIX_WIDTH = 24;

const regexLabelField = /^(\s*>)?([!@]?\.?[A-Za-z_][\w.!?#@]*|\d+)(\+(?:\d|\*))?(:(?![:.]))?/;
const regexLuaEnd = /(^|[\s:])endlua\b/i;
const regexLuaStart = /(^|[\s:])lua\b/i;


/**
 * Parses one line.
 * @param line The line text.
 * @param blockDepth Block comment nesting at line start.
 * @param baseCol Column where the source text starts (non zero for listing files).
 * @param dirbol True to recognize directives at the beginning of the line.
 */
export function parseLine(line: string, blockDepth = 0, baseCol = 0, dirbol = false): {parsed: ParsedLine, blockDepth: number} {
	let col = baseCol;
	let label: LabelField | undefined;

	if (blockDepth === 0) {
		const rest = line.substring(baseCol);
		const m = regexLabelField.exec(rest);
		if (m && !(dirbol && !m[1] && !m[4] && DIRECTIVES.has(m[2].toLowerCase()))) {
			// The label must be followed by a delimiter
			const next = rest[m[0].length] ?? '';
			if (next === '' || /[\s;=/]/.test(next) || m[4]) {
				const start = baseCol + (m[1]?.length ?? 0);
				label = {text: m[2], start, end: start + m[2].length};
				col = baseCol + m[0].length;
			}
		}
	}

	const scan = scanLine(line, blockDepth, col);
	const statements: Statement[] = [];
	let current: Token[] = [];
	const flush = () => {
		if (current.length > 0)
			statements.push(makeStatement(current));
		current = [];
	};
	for (const token of scan.tokens) {
		if (token.kind === TokenKind.Separator)
			flush();
		else
			current.push(token);
	}
	flush();

	return {
		parsed: {label, labelFieldEnd: label ? col : undefined, statements, commentStart: scan.lineCommentStart},
		blockDepth: scan.blockDepth
	};
}


function makeStatement(tokens: Token[]): Statement {
	let i = 0;
	// Skip dot repeater ".4" or ".(expr)"
	if (tokens[0].kind === TokenKind.Number && tokens[0].text.startsWith('.'))
		i = 1;
	else if (tokens[0].kind === TokenKind.Punct && tokens[0].text === '.' && tokens[1]?.text === '(') {
		let depth = 0;
		for (i = 1; i < tokens.length; i++) {
			if (tokens[i].text === '(')
				depth++;
			else if (tokens[i].text === ')' && --depth === 0) {
				i++;
				break;
			}
		}
	}
	const op = tokens[i];
	if (!op)
		return {opText: '', opLower: '', inhibit: false, operands: []};
	let opText = op.text;
	let inhibit = false;
	if (op.kind === TokenKind.Ident && opText.startsWith('@') && opText.length > 1 && opText[1] !== '.') {
		inhibit = true;
		opText = opText.substring(1);
	}
	// Directives may be written with a leading dot, e.g. ".db"
	if (op.kind === TokenKind.Ident && opText.startsWith('.') && DIRECTIVES.has(opText.substring(1).toLowerCase()))
		opText = opText.substring(1);
	// DEFINE+ and DEFARRAY+ (redefine): the '+' belongs to the directive
	let operandStart = i + 1;
	const plus = tokens[operandStart];
	if (op.kind === TokenKind.Ident && /^(define|defarray)$/i.test(opText) && plus?.kind === TokenKind.Punct && plus.text === '+' && plus.start === op.end) {
		opText += '+';
		operandStart++;
	}
	return {op, opText, opLower: opText.toLowerCase(), inhibit, operands: tokens.slice(operandStart)};
}


/**
 * Parses a complete text.
 * @param text The file contents.
 * @param options Listing mode and --dirbol.
 */
export function parseText(text: string, options: ParseOptions = {}): ParsedText {
	const {listing = false, dirbol = false} = options;
	const lines = text.split(/\r?\n/);
	const parsed: ParsedLine[] = new Array(lines.length);
	let blockDepth = 0;
	let inLua = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let baseCol = 0;
		if (listing) {
			if (line.startsWith('#') || line.length <= LISTING_PREFIX_WIDTH) {
				parsed[i] = {statements: []};
				continue;
			}
			baseCol = LISTING_PREFIX_WIDTH;
		}
		if (inLua) {
			if (!regexLuaEnd.test(line.substring(baseCol))) {
				parsed[i] = {statements: [], lua: true};
				continue;
			}
			inLua = false;
		}
		const r = parseLine(line, blockDepth, baseCol, dirbol);
		parsed[i] = r.parsed;
		if (blockDepth > 0)
			r.parsed.inBlockComment = true;
		blockDepth = r.blockDepth;
		// LUA block start (the block ends with ENDLUA)
		const lastLua = r.parsed.statements.some(s => s.opLower === 'lua');
		const endsLua = r.parsed.statements.some(s => s.opLower === 'endlua');
		if (lastLua && !endsLua && regexLuaStart.test(line.substring(baseCol)))
			inLua = true;
	}
	return {lines, parsed};
}


/**
 * Returns the file name of an INCLUDE-like statement and whether it was
 * written with angle brackets.
 * @param line The line text.
 * @param st The statement.
 */
export function getFileOperand(line: string, st: Statement): {path: string, angle: boolean, start: number, end: number} | undefined {
	if (st.operands.length === 0)
		return undefined;
	const first = st.operands[0];
	// Quoted
	if (first.kind === TokenKind.String) {
		const path = first.text.substring(1, first.text.lastIndexOf(first.text[0]) > 0 ? first.text.lastIndexOf(first.text[0]) : undefined);
		return {path, angle: false, start: first.start, end: first.end};
	}
	// Angle brackets
	if (first.text === '<') {
		const close = line.indexOf('>', first.end);
		if (close < 0)
			return undefined;
		return {path: line.substring(first.end, close).trim(), angle: true, start: first.start, end: close + 1};
	}
	// Bare file name up to the first whitespace, comma or comment
	const m = /^[^\s,;]+/.exec(line.substring(first.start));
	if (!m)
		return undefined;
	return {path: m[0], angle: false, start: first.start, end: first.start + m[0].length};
}
