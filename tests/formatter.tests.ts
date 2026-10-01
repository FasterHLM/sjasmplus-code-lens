import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {FormatOptions, formatText} from '../src/sjasm/formatter';


const TABS: FormatOptions = {tabSize: 8, insertSpaces: false};

/** Formats the lines and returns the resulting lines. */
function format(lines: string[], options: Partial<FormatOptions> = {}, from?: number, to?: number): string[] {
	const result = [...lines];
	for (const e of formatText(lines.join('\n'), {...TABS, ...options}, from, to))
		result[e.line] = e.text;
	return result;
}


suite('formatter', () => {

	test('instructions move to the most frequent column, labels stay', () => {
		assert.deepEqual(format([
			'start:\tnop',
			'\t\t\tld a,b',
			'\t\t\tinc a',
			'    push bc',
			'longlabelname:\tret'
		]), [
			'start:\t\t\tnop',
			'\t\t\tld a,b',
			'\t\t\tinc a',
			'\t\t\tpush bc',
			'longlabelname:\t\tret'
		]);
		// A label wider than the column: one separator
		assert.deepEqual(format(['\tnop', 'a_very_long_label_name: ret']), ['\tnop', 'a_very_long_label_name:\tret']);
	});

	test('nested code keeps its offset, outdented directives their column', () => {
		const lines = [
			'\t\tmodule game',
			'\t\tifdef DEBUG',
			'\t\t\tld a,1',
			'\t\t\tifdef TRACE',
			'\t\t\t\tout (#fe),a',
			'\t\t\tendif',
			'\t\tendif',
			'\t\t\tret',
			'\t\tendmodule'
		];
		assert.deepEqual(format(lines), lines);
		// A fixed column shifts everything, nesting included
		assert.deepEqual(format(lines, {instructionColumn: 16}), [
			'\tmodule game',
			'\tifdef DEBUG',
			'\t\tld a,1',
			'\t\tifdef TRACE',
			'\t\t\tout (#fe),a',
			'\t\tendif',
			'\tendif',
			'\t\tret',
			'\tendmodule'
		]);
		assert.deepEqual(format(['\t   ld a,1', '  ret'], {indentation: 'keep'}), ['\t   ld a,1', '  ret']);
	});

	test('spaces', () => {
		assert.deepEqual(format(['\tld a,b', 'x: ret'], {insertSpaces: true, tabSize: 4, instructionColumn: 8}), ['        ld a,b', 'x:      ret']);
	});

	test('commas, operand spacing and case', () => {
		assert.deepEqual(format(['\tld a , b', '\tld e,c,,d,b', '\tdb 1,2, 3'], {commaSpace: 'space'}), ['\tld a, b', '\tld e, c,, d, b', '\tdb 1, 2, 3']);
		assert.deepEqual(format(['\tld a, b'], {commaSpace: 'none'}), ['\tld a,b']);
		assert.deepEqual(format(['\tld   a,b : nop', '\tret'], {operandSpacing: 'space'}), ['\tld a,b : nop', '\tret']);
		assert.deepEqual(format(['\tld a,b'], {operandSpacing: 'tab'}), ['\tld\ta,b']);
		// Keywords change, labels, macros, strings and DEVICE ids don't
		assert.deepEqual(format(['Loop:\tLD A,(IX+Ofs)', '\tEX AF,AF\'', '\tJP NZ,Loop', '\tDB "Text",High Loop', '\tMyMacro A', '\tDEVICE ZXSPECTRUM128', '\t.DB 1'], {case: 'lower'}),
			['Loop:\tld a,(ix+Ofs)', '\tex af,af\'', '\tjp nz,Loop', '\tdb "Text",high Loop', '\tMyMacro a', '\tdevice ZXSPECTRUM128', '\t.db 1']);
		assert.deepEqual(format(['\tld hl,label', '\tdjnz .loop'], {case: 'upper'}), ['\tLD HL,label', '\tDJNZ .loop']);
	});

	test('trailing comments are aligned per group', () => {
		assert.deepEqual(format([
			'A\tequ 1\t\t; one',
			'BB\tequ 2\t; two',
			'CCC\tequ 3\t\t; three',
			'',
			'\tld a,b\t; load',
			'\tld a,(very_long_label_name)\t; does not fit',
			'\tret\t; return',
			'; whole line comments stay',
			'\t\t; also indented ones'
		]), [
			'A\tequ 1\t\t; one',
			'BB\tequ 2\t\t; two',
			'CCC\tequ 3\t\t; three',
			'',
			'\tld a,b\t; load',
			'\tld a,(very_long_label_name)\t; does not fit',
			'\tret\t; return',
			'; whole line comments stay',
			'\t\t; also indented ones'
		]);
		assert.deepEqual(format(['\tnop ; c', '\tret\t\t\t; d'], {commentColumn: 16}), ['\tnop\t; c', '\tret\t; d']);
		assert.deepEqual(format(['\tnop ; c'], {trailingComments: 'keep'}), ['\tnop ; c']);
	});

	test('untouched lines', () => {
		const lines = [
			'\tSTRUCT S',
			'x\tBYTE 0',
			'\tENDS',
			'inst\tS {',
			'   1, 2',
			'}',
			' lua',
			'   x = 5   ',
			' endlua',
			'  ld /* c */ a,1',
			'/* block',
			'   comment */',
			'#line 5',
			'   >Indented:  nop'
		];
		const result = format(lines);
		// Struct initializer continuation, Lua, block comments, #line and '>' labels unchanged (except trailing whitespace)
		for (const i of [4, 5, 7, 9, 10, 11, 12, 13])
			assert.equal(result[i], lines[i].trimEnd(), lines[i]);
	});

	test('range formatting changes only the lines in the range', () => {
		assert.deepEqual(format(['\tnop', '\tnop', '  nop', '  nop', '\tnop'], {}, 2, 2), ['\tnop', '\tnop', '\tnop', '  nop', '\tnop']);
	});

	test('formatting is idempotent and keeps the code (tests/data)', () => {
		for (const name of ['sample.asm', 'modulesstruct.asm']) {
			const text = fs.readFileSync(path.join(__dirname, '../../tests/data', name), 'utf8');
			for (const options of [TABS, {...TABS, case: 'upper', commaSpace: 'space', operandSpacing: 'tab'} as FormatOptions, {tabSize: 4, insertSpaces: true, instructionColumn: 12}]) {
				const once = format(text.split(/\r?\n/), options);
				const twice = format(once, options);
				assert.deepEqual(twice, once, name);
				const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();
				assert.equal(squash(once.join('\n')), squash(text), name);
			}
		}
	});
});
