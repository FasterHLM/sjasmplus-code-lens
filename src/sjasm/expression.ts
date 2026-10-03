/**
 * Evaluation of the conditions of IF/IFN/ELSEIF with the rules of sjasmplus (checked against sjasmplus 1.24.0,
 * see tests/data/conditions.json): numbers are 32-bit signed and wrap around, "true" is -1, a string is
 * the number made of its (last four) characters, the text of a DEFINE is put into the expression as text.
 *
 * What cannot be known here (a label that is not a constant, a value that depends on the pass or the address,
 * a form that is not followed) makes the value "unknown" (undefined), never a guess.
 */
import {scanLine, Token, TokenKind} from './lexer';


/** The value of an expression: a 32-bit signed integer, or undefined if it cannot be known here. */
export type Value = number | undefined;


export interface EvalEnv {
	/** The text a DEFINE stands for; null: a define whose value is not known; undefined: not a define. */
	define(name: string): string | null | undefined;
	/** The value of a constant label (EQU, DEFL) defined before; null: the label exists, its value is not known; undefined: no such label. */
	constant(name: string): number | null | undefined;
	/**
	 * A define is also put into the parts of a name between underscores ("tag_x" with tag defined), unless
	 * OPT --syntax=s: then such a name is not known (it is something else than the label it is written as).
	 */
	subwords?: boolean;
}


const MAX_EXPANSION_DEPTH = 16;
const MAX_TOKENS = 400;
const INT_MIN = -2147483648;

/** A token and whether white space came before it (needed to read "==" or "<<" from single characters). */
interface Tok {
	kind: TokenKind;
	text: string;
	space: boolean;
}

/** Binary operators by precedence, the lowest first (sjasmplus and C: || && | ^ & equality comparison shift + - * / %). */
const LEVELS: string[][] = [
	['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>', '>>>'], ['+', '-'], ['*', '/', '%']
];
/** Operators written as words, as the symbols they stand for. */
const WORD_OPERATORS: {[word: string]: string} = {and: '&', or: '|', xor: '^', mod: '%', shl: '<<', shr: '>>'};
/** Operators written with punctuation, the longest first. */
const SYMBOL_OPERATORS = ['>>>', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^'];
const UNARY_WORDS = new Set(['not', 'low', 'high', 'abs']);


function toToks(tokens: Token[]): Tok[] {
	return tokens.map((t, i) => ({kind: t.kind, text: t.text, space: i > 0 && t.start > tokens[i - 1].end}));
}


/**
 * Puts the text of the defines in place of their names, as sjasmplus does it before the expression is
 * read. Undefined if a define is not known or cannot be followed.
 */
function expand(toks: Tok[], env: EvalEnv, depth: number): Tok[] | undefined {
	if (depth > MAX_EXPANSION_DEPTH)
		return undefined;
	const out: Tok[] = [];
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i];
		if (t.kind === TokenKind.Ident) {
			// "!", "?", "#" and "@" are characters of a name for sjasmplus: "name!=1" is the name "name!", not "name != 1"
			const next = toks[i + 1];
			if (next && next.kind === TokenKind.Punct && !next.space && '!?#@'.includes(next.text))
				return undefined;
			const text = env.define(t.text);
			if (text === null)
				return undefined;
			if (text !== undefined) {
				const inner = expand(toToks(scanLine(text).tokens), env, depth + 1);
				if (!inner || inner.length === 0)	// an empty define in an expression is an error of sjasmplus
					return undefined;
				inner[0] = {...inner[0], space: t.space};
				out.push(...inner);
				if (out.length > MAX_TOKENS)
					return undefined;
				continue;
			}
			if (env.subwords && t.text.includes('_') && t.text.split('_').some(part => part !== '' && env.define(part) !== undefined))
				return undefined;
		}
		out.push(t);
	}
	return out;
}


/** The value of a number as written in the source, undefined for the forms that are not followed. */
function numberValue(text: string): Value {
	if (/['_]/.test(text))
		return undefined;
	let m: RegExpExecArray | null;
	const wrap = (digits: string, base: number, max: number): Value => {
		if (digits.length > max)
			return undefined;
		return parseInt(digits, base) | 0;
	};
	if ((m = /^#([0-9a-f]{1,8})$/i.exec(text)) || (m = /^\$([0-9a-f]{1,8})$/i.exec(text)) || (m = /^0x([0-9a-f]{1,8})$/i.exec(text)))
		return wrap(m[1], 16, 8);
	if ((m = /^([0-9][0-9a-f]{0,7})h$/i.exec(text)))
		return wrap(m[1], 16, 8);
	if ((m = /^%([01]{1,32})$/.exec(text)) || (m = /^0b([01]{1,32})$/i.exec(text)) || (m = /^([01]{1,32})b$/i.exec(text)))
		return wrap(m[1], 2, 32);
	if ((m = /^0q([0-7]{1,11})$/i.exec(text)) || (m = /^([0-7]{1,11})[qo]$/i.exec(text)))
		return parseInt(m[1], 8) > 0xffffffff ? undefined : parseInt(m[1], 8) | 0;
	if ((m = /^([0-9]{1,10})d?$/i.exec(text)))
		return parseInt(m[1], 10) > 0xffffffff ? undefined : parseInt(m[1], 10) | 0;
	return undefined;
}


/**
 * The value of a string: its characters as one number, the first one in the highest byte, so only the
 * last four count ("banana" is "nana"). Escapes and characters above 127 are not followed.
 */
function stringValue(text: string): Value {
	if (text.length < 2 || text.includes('\\'))
		return undefined;
	const quote = text[0];
	if ((quote !== '"' && quote !== "'") || text[text.length - 1] !== quote)
		return undefined;
	const inner = text.slice(1, -1);
	if (quote === "'")
		return inner.length === 1 && inner.charCodeAt(0) < 128 ? inner.charCodeAt(0) : undefined;
	let value = 0;
	for (let i = 0; i < inner.length; i++) {
		const code = inner.charCodeAt(i);
		if (code > 127)
			return undefined;
		value = ((value << 8) | code) | 0;
	}
	return value;
}


class Parser {
	pos = 0;
	/** A syntax error, or something that is not an expression: the answer is unknown whatever else was found. */
	bad = false;

	constructor(protected toks: Tok[], protected env: EvalEnv) {
	}

	/** The binary operator at the current position, written with symbols or as a word. */
	protected peekBinary(): {name: string, len: number} | undefined {
		const t = this.toks[this.pos];
		if (!t)
			return undefined;
		if (t.kind === TokenKind.Ident) {
			const word = WORD_OPERATORS[t.text.toLowerCase()];
			return word ? {name: word, len: 1} : undefined;
		}
		if (t.kind !== TokenKind.Punct)
			return undefined;
		for (const op of SYMBOL_OPERATORS) {
			let ok = true;
			for (let i = 0; i < op.length && ok; i++) {
				const p = this.toks[this.pos + i];
				ok = p !== undefined && p.kind === TokenKind.Punct && p.text === op[i] && (i === 0 || !p.space);
			}
			if (ok)
				return {name: op === '=' ? '==' : op, len: op.length};
		}
		return undefined;
	}

	parseBinary(level: number): Value {
		if (level >= LEVELS.length)
			return this.parseUnary();
		let left = this.parseBinary(level + 1);
		for (;;) {
			const op = this.peekBinary();
			if (!op || !LEVELS[level].includes(op.name))
				return left;
			this.pos += op.len;
			const right = this.parseBinary(level + 1);
			left = this.apply(op.name, left, right);
		}
	}

	protected apply(op: string, l: Value, r: Value): Value {
		// One side can decide without the other (the other side is not an error in a program that assembles)
		if (op === '||') {
			if ((l !== undefined && l !== 0) || (r !== undefined && r !== 0))
				return -1;
			return l === 0 && r === 0 ? 0 : undefined;
		}
		if (op === '&&') {
			if (l === 0 || r === 0)
				return 0;
			return l !== undefined && r !== undefined ? -1 : undefined;
		}
		// A division by zero is an error of sjasmplus whatever the left side is
		if ((op === '/' || op === '%') && r === 0) {
			this.bad = true;
			return undefined;
		}
		if (l === undefined || r === undefined)
			return undefined;
		switch (op) {
			case '|': return l | r;
			case '^': return l ^ r;
			case '&': return l & r;
			case '==': return l === r ? -1 : 0;
			case '!=': return l !== r ? -1 : 0;
			case '<': return l < r ? -1 : 0;
			case '<=': return l <= r ? -1 : 0;
			case '>': return l > r ? -1 : 0;
			case '>=': return l >= r ? -1 : 0;
			case '<<': return r >= 0 && r <= 31 ? l << r : undefined;
			case '>>': return r >= 0 && r <= 31 ? l >> r : undefined;
			case '+': return (l + r) | 0;
			case '-': return (l - r) | 0;
			case '*': return Math.imul(l, r);
			case '/':
			case '%':
				// sjasmplus reports an error for a division by zero, also on the side that does not decide: no answer then
				if (r === 0 || (l === INT_MIN && r === -1)) {
					this.bad = true;
					return undefined;
				}
				return op === '/' ? Math.trunc(l / r) | 0 : l % r | 0;
		}
		return undefined;	// ">>>": not followed
	}

	protected parseUnary(): Value {
		const t = this.toks[this.pos];
		if (!t) {
			this.bad = true;
			return undefined;
		}
		if (t.kind === TokenKind.Punct && (t.text === '-' || t.text === '+' || t.text === '~' || t.text === '!')) {
			this.pos++;
			const v = this.parseUnary();
			if (v === undefined)
				return undefined;
			switch (t.text) {
				case '-': return (-v) | 0;
				case '~': return ~v;
				case '!': return v === 0 ? -1 : 0;
			}
			return v;
		}
		if (t.kind === TokenKind.Ident && UNARY_WORDS.has(t.text.toLowerCase()) && this.toks[this.pos + 1] !== undefined) {
			this.pos++;
			const v = this.parseUnary();
			if (v === undefined)
				return undefined;
			switch (t.text.toLowerCase()) {
				case 'not': return v === 0 ? -1 : 0;
				case 'low': return v >= 0 && v <= 0xffff ? v & 0xff : undefined;
				case 'high': return v >= 0 && v <= 0xffff ? (v >> 8) & 0xff : undefined;
				case 'abs': return v === INT_MIN ? undefined : Math.abs(v);
			}
		}
		return this.parsePrimary();
	}

	protected parsePrimary(): Value {
		const t = this.toks[this.pos];
		if (!t) {
			this.bad = true;
			return undefined;
		}
		this.pos++;
		switch (t.kind) {
			case TokenKind.Number:
				return numberValue(t.text);
			case TokenKind.String:
				return stringValue(t.text);
			case TokenKind.Ident: {
				const value = this.env.constant(t.text);
				return typeof value === 'number' ? value : undefined;
			}
			case TokenKind.Punct:
				if (t.text === '(') {
					const v = this.parseBinary(0);
					const close = this.toks[this.pos];
					if (close && close.kind === TokenKind.Punct && close.text === ')')
						this.pos++;
					else
						this.bad = true;
					return v;
				}
		}
		this.bad = true;
		return undefined;
	}
}


/** The value of an expression, undefined if it is not known here. */
export function evaluateExpression(tokens: Token[], env: EvalEnv): Value {
	const toks = expand(toToks(tokens), env, 0);
	if (!toks || toks.length === 0)
		return undefined;
	const parser = new Parser(toks, env);
	const value = parser.parseBinary(0);
	// What is left after a complete expression ("IF 1 2" is taken by sjasmplus) is not guessed
	return parser.bad || parser.pos < toks.length ? undefined : value;
}


/** True or false if the condition is known, undefined if it cannot be known here. */
export function evaluateCondition(tokens: Token[], env: EvalEnv): boolean | undefined {
	const value = evaluateExpression(tokens, env);
	return value === undefined ? undefined : value !== 0;
}
