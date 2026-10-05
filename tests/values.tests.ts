import * as assert from 'assert';
import {describeValue, numberAt} from '../src/sjasm/values';


suite('the forms of a value for the hover', () => {
	test('a 16-bit value: decimal, hex of four digits, binary of sixteen', () => {
		assert.equal(describeValue(0x5800), '22528 (0x5800, %0101100000000000)');
		assert.equal(describeValue(0), '0 (0x00, %00000000)');
		assert.equal(describeValue(0xffff), '65535 (0xFFFF, %1111111111111111)');
		assert.equal(describeValue(0x100), '256 (0x0100, %0000000100000000)');
	});

	test('a byte: two hex digits, eight binary digits', () => {
		assert.equal(describeValue(255), '255 (0xFF, %11111111)');
		assert.equal(describeValue(5), '5 (0x05, %00000101)');
	});

	test('a value that is more than 16 bits, or negative: decimal and hex of 32 bits', () => {
		assert.equal(describeValue(0x12345678), '305419896 (0x12345678)');
		assert.equal(describeValue(0x10000), '65536 (0x00010000)');
		assert.equal(describeValue(-1), '-1 (0xFFFFFFFF)');
		assert.equal(describeValue(-2147483648), '-2147483648 (0x80000000)');
	});

	test('the prefix of hex numbers is the one of the setting', () => {
		assert.equal(describeValue(0x4000, '#'), '16384 (#4000, %0100000000000000)');
		assert.equal(describeValue(0x4000, '$'), '16384 ($4000, %0100000000000000)');
	});
});


suite('the number under the cursor', () => {
	const at = (line: string, needle: string, offset = 0) => numberAt(line, line.indexOf(needle) + offset);

	test('a number in code: where it is and its value', () => {
		assert.deepEqual(at('\tld hl,#4000', '#4000', 2), {start: 7, end: 12, value: 0x4000});
		assert.deepEqual(at('\tld a,%1010', '%1010'), {start: 6, end: 11, value: 10});
		assert.deepEqual(at('\tdb 1, 255', '255', 1), {start: 7, end: 10, value: 255});
		assert.equal(at('\tld a,12', '12', 2)?.value, 12, 'also at the end of the number');
	});

	test('not a number: a symbol, a string, a comment', () => {
		assert.equal(at('\tld a,SIZE', 'SIZE'), undefined);
		assert.equal(at('\tld a,"7"', '7'), undefined, 'in a string');
		assert.equal(at('\tnop ; about 99 bytes', '99'), undefined, 'in a comment');
		assert.equal(at('\tnop /* 99 */', '99'), undefined, 'in a block comment on the line');
	});

	test('a temporary label, and a reference to one, is not a number', () => {
		assert.equal(at('1\tdjnz 1B', '1\t', 0), undefined, 'the label at the beginning of the line');
		assert.equal(at('\tdjnz 1B', '1B'), undefined);
		assert.equal(at('\tjr 2f', '2f'), undefined);
		assert.equal(at('\tjr nz,12B', '12B'), undefined);
	});

	test('not at a number: between the words', () => {
		assert.equal(numberAt('\tld a,5', 3), undefined);
		assert.equal(numberAt('\tld a,5', 0), undefined);
	});
});
