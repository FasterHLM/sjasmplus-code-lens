import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {scanLine} from '../src/sjasm/lexer';
import {EvalEnv, evaluateCondition, evaluateExpression} from '../src/sjasm/expression';


/** One condition and what sjasmplus 1.24.0 itself made of it (tests/data/conditions.json, made by running sjasmplus). */
interface Entry {
	expr: string;
	/** The lines before the condition: DEFINE, UNDEFINE, "name: EQU value", "name: DEFL value". */
	defines: string[];
	/** T: the block was assembled, F: it was not, E: sjasmplus reported an error. */
	sjasmplus: 'T' | 'F' | 'E';
	/** The value depends on the pass, the address...: unknown is fine. */
	unknownOk?: boolean;
	/** A form this evaluator does not follow (whatever sjasmplus does): it has to stay unknown. */
	mustBeUnknown?: boolean;
}

const entries: Entry[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/data/conditions.json'), 'utf8'));


function tokensOf(text: string) {
	return scanLine(text).tokens;
}


/** An environment made of lines like the ones before a condition in the source. */
function envOf(lines: string[]): EvalEnv {
	const defines = new Map<string, string>();
	const constants = new Map<string, number | null>();
	const env: EvalEnv = {
		define: name => defines.get(name),
		constant: name => constants.get(name)
	};
	for (const line of lines) {
		let m: RegExpExecArray | null;
		if ((m = /^DEFINE\s+(\w+)\s*(.*?)\s*(?:;.*)?$/i.exec(line)))
			defines.set(m[1], m[2]);
		else if ((m = /^UNDEFINE\s+(\w+)/i.exec(line)))
			defines.delete(m[1]);
		else if ((m = /^(\w+):\s*(?:EQU|DEFL)\s+(.*)$/i.exec(line)))
			constants.set(m[1], evaluateExpression(tokensOf(m[2]), env) ?? null);
		else
			assert.fail('unknown line in the preamble: ' + line);
	}
	return env;
}


suite('sjasm conditions (IF)', () => {

	test(`the ${entries.length} conditions of tests/data/conditions.json give what sjasmplus gives, or stay unknown`, () => {
		const wrong: string[] = [];
		for (const e of entries) {
			const got = evaluateCondition(tokensOf(e.expr), envOf(e.defines));
			const where = `${e.expr}${e.defines.length ? '   [' + e.defines.join(' | ') + ']' : ''}`;
			const expected = e.sjasmplus === 'T' ? true : (e.sjasmplus === 'F' ? false : undefined);
			if (e.mustBeUnknown || e.sjasmplus === 'E') {
				// An error of sjasmplus, or a form we do not follow: no answer is better than a wrong one
				if (got !== undefined)
					wrong.push(`${where}: has to stay unknown, got ${got}`);
			}
			else if (e.unknownOk) {
				if (got !== undefined && got !== expected)
					wrong.push(`${where}: sjasmplus ${expected}, got ${got}`);
			}
			else if (got !== expected)
				wrong.push(`${where}: sjasmplus ${expected}, got ${got}`);
		}
		assert.deepEqual(wrong, []);
	});

	test('an unknown name makes the answer unknown, except where the other side decides', () => {
		const env = envOf([]);
		const eval_ = (text: string) => evaluateCondition(tokensOf(text), env);
		assert.equal(eval_('unknown_label'), undefined);
		assert.equal(eval_('unknown_label == 1'), undefined);
		assert.equal(eval_('0 && unknown_label'), false);
		assert.equal(eval_('unknown_label && 0'), false);
		assert.equal(eval_('1 || unknown_label'), true);
		assert.equal(eval_('unknown_label || 1'), true);
		assert.equal(eval_('1 && unknown_label'), undefined);
		assert.equal(eval_('0 || unknown_label'), undefined);
		assert.equal(eval_('(unknown_label == 1) && (2 == 3)'), false);
	});

	test('a define of an unknown value, and a constant of an unknown value, make the answer unknown', () => {
		const env: EvalEnv = {
			define: name => name === 'FROM_LUA' ? null : (name === 'KNOWN' ? '7' : undefined),
			constant: name => name === 'LATER' ? null : (name === 'EIGHT' ? 8 : undefined)
		};
		const eval_ = (text: string) => evaluateCondition(tokensOf(text), env);
		assert.equal(eval_('FROM_LUA == 1'), undefined);
		assert.equal(eval_('LATER == 1'), undefined);
		assert.equal(eval_('KNOWN == 7'), true);
		assert.equal(eval_('EIGHT == KNOWN+1'), true);
		// The text of a define is put into the expression, so with an unknown text even the structure is unknown
		// (FROM_LUA = "1 || 5" would make "1 || 5 && 0" true): not an atomic value like a constant
		assert.equal(eval_('FROM_LUA && 0'), undefined);
		assert.equal(eval_('LATER && 0'), false);
	});

	test('a division by zero is an error whatever the other side says', () => {
		const eval_ = (text: string) => evaluateCondition(tokensOf(text), envOf([]));
		assert.equal(eval_('0 && (1/0)'), undefined);
		assert.equal(eval_('1 || (1%0)'), undefined);
		assert.equal(eval_('(-2147483647-1)/-1 == 0'), undefined);
	});

	test('a define that refers to itself does not loop', () => {
		const env: EvalEnv = {define: name => name === 'A' ? 'A+1' : (name === 'P' ? 'Q' : (name === 'Q' ? 'P' : undefined)), constant: () => undefined};
		assert.equal(evaluateCondition(tokensOf('A == 1'), env), undefined);
		assert.equal(evaluateCondition(tokensOf('P == 1'), env), undefined);
	});

	test('what stays after a complete expression makes it unknown', () => {
		// sjasmplus ignores the rest ("IF 1 2" is taken), we do not guess
		assert.equal(evaluateCondition(tokensOf('1 2'), envOf([])), undefined);
		assert.equal(evaluateCondition(tokensOf('1 == 1 garbage'), envOf([])), undefined);
		assert.equal(evaluateCondition([], envOf([])), undefined);
	});
});
