/**
 * Line lexer for sjasmplus sources.
 * Splits the code part of a line into tokens and finds the comments.
 * Block comments nest (as in sjasmplus) and may span lines, so the
 * nesting depth is carried from one line to the next.
 */
import {isKnownOperator, WORD_OPERATORS} from './keywords';

export const enum TokenKind {
	/** Symbol-like word: labels, mnemonics, directives, registers ... */
	Ident,
	Number,
	String,
	/** A single punctuation character (or '..'). */
	Punct,
	/** ':' '::' or ':.:' separating statements on one line. */
	Separator
}


export interface Token {
	kind: TokenKind;
	text: string;
	/** Column of the first character. */
	start: number;
	/** Column after the last character. */
	end: number;
}


export interface ScannedLine {
	tokens: Token[];
	/** Column where a ';' or '//' comment starts (undefined if none). */
	lineCommentStart?: number;
	/** Block comment nesting depth at the end of the line. */
	blockDepth: number;
}


const isIdentStart = (ch: string) => /[A-Za-z_]/.test(ch);
const isIdentChar = (ch: string) => /[\w.!?#@]/.test(ch);
const isHexDigit = (ch: string) => /[0-9A-Fa-f]/.test(ch);


/**
 * Skips a (possibly nested) block comment.
 * @param line The text.
 * @param pos Position inside the comment (after the opening '/*').
 * @param depth The current nesting depth (>0).
 * @returns The position after the comment and the remaining depth (0 if closed on this line).
 */
function skipBlockComment(line: string, pos: number, depth: number): {pos: number, depth: number} {
	const len = line.length;
	while (pos < len) {
		if (line.startsWith('/*', pos)) {
			depth++;
			pos += 2;
		}
		else if (line.startsWith('*/', pos)) {
			depth--;
			pos += 2;
			if (depth === 0)
				return {pos, depth};
		}
		else
			pos++;
	}
	return {pos, depth};
}


/**
 * Scans an identifier starting at 'pos'.
 * A trailing '!' is not taken if it starts the '!=' operator.
 */
function scanIdent(line: string, pos: number): number {
	const len = line.length;
	while (pos < len && isIdentChar(line[pos])) {
		if (line[pos] === '!' && line[pos + 1] === '=')
			break;
		if (line[pos] === '.' && line[pos + 1] === '.')
			break;	// '..' string concatenation
		pos++;
	}
	return pos;
}


/**
 * Returns true if the previous token ends a value, i.e. a following
 * '%' is the modulo operator and not the start of a binary number.
 */
function previousIsValue(tokens: Token[]): boolean {
	const prev = tokens[tokens.length - 1];
	if (!prev)
		return false;
	if (prev.kind === TokenKind.Ident) {
		const lower = prev.text.toLowerCase();
		return !isKnownOperator(lower) && !WORD_OPERATORS.has(lower);
	}
	if (prev.kind === TokenKind.Number || prev.kind === TokenKind.String)
		return true;
	return prev.kind === TokenKind.Punct && (prev.text === ')' || prev.text === ']' || prev.text === '}');
}


/**
 * Tokenizes one line.
 * @param line The line text (without line break).
 * @param blockDepth Block comment nesting depth at the start of the line.
 * @param startCol Column to start scanning at (e.g. after an already parsed label).
 */
export function scanLine(line: string, blockDepth = 0, startCol = 0): ScannedLine {
	const tokens: Token[] = [];
	const len = line.length;
	let pos = startCol;

	if (blockDepth > 0) {
		const r = skipBlockComment(line, pos, blockDepth);
		pos = r.pos;
		blockDepth = r.depth;
		if (blockDepth > 0)
			return {tokens, blockDepth};
	}

	const push = (kind: TokenKind, start: number, end: number) => {
		tokens.push({kind, text: line.substring(start, end), start, end});
	};

	while (pos < len) {
		const ch = line[pos];

		// Whitespace
		if (ch === ' ' || ch === '\t' || ch === '\r') {
			pos++;
			continue;
		}

		// Comments
		if (ch === ';' || line.startsWith('//', pos)) {
			return {tokens, lineCommentStart: pos, blockDepth};
		}
		if (line.startsWith('/*', pos)) {
			const r = skipBlockComment(line, pos + 2, 1);
			pos = r.pos;
			blockDepth = r.depth;
			if (blockDepth > 0)
				return {tokens, blockDepth};
			continue;
		}

		const start = pos;

		// Statement separators ':' '::' ':.:'
		if (ch === ':') {
			if (line.startsWith(':.:', pos))
				pos += 3;
			else if (line[pos + 1] === ':')
				pos += 2;
			else
				pos++;
			push(TokenKind.Separator, start, pos);
			continue;
		}

		// Identifiers (also with '.', '@' or '@.' prefix)
		if (isIdentStart(ch)
			|| (ch === '.' && isIdentStart(line[pos + 1] ?? ''))
			|| (ch === '@' && (isIdentStart(line[pos + 1] ?? '') || (line[pos + 1] === '.' && isIdentStart(line[pos + 2] ?? ''))))) {
			pos = scanIdent(line, pos + 1);
			// af'
			if (line[pos] === "'" && line.substring(start, pos).toLowerCase() === 'af')
				pos++;
			push(TokenKind.Ident, start, pos);
			continue;
		}

		// Dot repeater, e.g. ".4 nop"
		if (ch === '.' && /\d/.test(line[pos + 1] ?? '')) {
			pos++;
			while (pos < len && /\w/.test(line[pos]))
				pos++;
			push(TokenKind.Number, start, pos);
			continue;
		}

		// Numbers starting with a digit (incl. separators ' and _ and suffixes)
		if (/\d/.test(ch)) {
			pos++;
			while (pos < len) {
				const c = line[pos];
				if (/\w/.test(c))
					pos++;
				else if (c === "'" && /[0-9A-Za-z]/.test(line[pos + 1] ?? ''))
					pos++;
				else
					break;
			}
			push(TokenKind.Number, start, pos);
			continue;
		}

		// '$' current address, '$$' etc., '$hex', and '$$label' / '$$$label'
		if (ch === '$') {
			let n = 0;
			while (line[pos + n] === '$')
				n++;
			if (n === 1 && isHexDigit(line[pos + 1] ?? '')) {
				pos++;
				while (pos < len && /[0-9A-Fa-f_']/.test(line[pos]))
					pos++;
				push(TokenKind.Number, start, pos);
				continue;
			}
			pos += n;
			if (n >= 2 && pos < len && (isIdentStart(line[pos]) || line[pos] === '.' || line[pos] === '@')) {
				// Page/physical address of a label: the label is the reference
				const identStart = pos;
				pos = scanIdent(line, pos + 1);
				push(TokenKind.Ident, identStart, pos);
				continue;
			}
			push(TokenKind.Number, start, pos);
			continue;
		}

		// '#hex'
		if (ch === '#' && isHexDigit(line[pos + 1] ?? '')) {
			pos++;
			while (pos < len && /[0-9A-Fa-f_']/.test(line[pos]))
				pos++;
			push(TokenKind.Number, start, pos);
			continue;
		}

		// '%binary' (only where a value is expected, otherwise modulo)
		if (ch === '%' && /[01]/.test(line[pos + 1] ?? '') && !previousIsValue(tokens)) {
			pos++;
			while (pos < len && /[01_']/.test(line[pos]))
				pos++;
			push(TokenKind.Number, start, pos);
			continue;
		}

		// Strings "..." with escapes
		if (ch === '"') {
			pos++;
			while (pos < len && line[pos] !== '"') {
				if (line[pos] === '\\')
					pos++;
				pos++;
			}
			pos = Math.min(pos + 1, len);
			if (/[ZzCc]/.test(line[pos] ?? '') && !isIdentChar(line[pos + 1] ?? ''))
				pos++;
			push(TokenKind.String, start, pos);
			continue;
		}

		// Character constants '...' ('' is an escaped apostrophe)
		if (ch === "'") {
			pos++;
			while (pos < len) {
				if (line[pos] === "'") {
					if (line[pos + 1] === "'") {
						pos += 2;
						continue;
					}
					break;
				}
				pos++;
			}
			pos = Math.min(pos + 1, len);
			if (/[ZzCc]/.test(line[pos] ?? '') && !isIdentChar(line[pos + 1] ?? ''))
				pos++;
			push(TokenKind.String, start, pos);
			continue;
		}

		// String concatenation
		if (line.startsWith('..', pos)) {
			pos += 2;
			push(TokenKind.Punct, start, pos);
			continue;
		}

		// Any other character
		pos++;
		push(TokenKind.Punct, start, pos);
	}

	return {tokens, blockDepth};
}
