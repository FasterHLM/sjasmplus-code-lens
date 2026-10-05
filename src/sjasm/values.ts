import {evaluateExpression} from './expression';
import {scanLine, TokenKind} from './lexer';


/**
 * The forms of a number for the hover: decimal, hex (two digits for a byte, four for a
 * 16-bit value, eight otherwise or if negative, with the given prefix) and binary (a byte
 * and a 16-bit value only).
 */
export function describeValue(value: number, hexPrefix = '0x'): string {
	const v = value | 0;
	const u = v >>> 0;
	const byte = v >= 0 && v <= 0xff;
	const word = v >= 0 && v <= 0xffff;
	const forms = [hexPrefix + u.toString(16).toUpperCase().padStart(byte ? 2 : word ? 4 : 8, '0')];
	if (word)
		forms.push('%' + u.toString(2).padStart(byte ? 8 : 16, '0'));
	return `${v} (${forms.join(', ')})`;
}


/**
 * The number written in a line of the source under character: where it is and its value. Not the
 * first word of the line (a temporary label), not 1B or 2F (a reference to one), not in a string or
 * a comment (the scan of the line stops there).
 */
export function numberAt(line: string, character: number): {start: number, end: number, value: number} | undefined {
	const token = scanLine(line).tokens.find(t => t.kind === TokenKind.Number && t.start > 0 && t.start <= character && character <= t.end);
	if (!token || /^[0-9]+[bf]$/i.test(token.text))
		return undefined;
	const value = evaluateExpression([token], {define: () => undefined, constant: () => undefined});
	return value === undefined ? undefined : {start: token.start, end: token.end, value};
}
