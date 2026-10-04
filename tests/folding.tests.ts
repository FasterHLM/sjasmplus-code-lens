import * as assert from 'assert';
import {FoldRange, getFoldingRanges} from '../src/sjasm/folding';


/** The ranges as "start-end" (with "b" for blocks and "c" for comments), sorted. */
function rangesOf(lines: string[]): string[] {
	return getFoldingRanges(lines.join('\n'))
		.sort((a, b) => a.start - b.start || b.end - a.end)
		.map(r => `${r.start}-${r.end}${r.kind === 'region' ? 'b' : (r.kind === 'comment' ? 'c' : '')}`);
}


/** Fails if two ranges overlap without one containing the other, or start on the same line. */
function assertNestedOrApart(ranges: FoldRange[]) {
	for (const a of ranges) {
		for (const b of ranges) {
			if (a === b)
				continue;
			assert.notEqual(a.start, b.start, `same start: ${a.start}-${a.end} and ${b.start}-${b.end}`);
			const apart = a.end < b.start || b.end < a.start;
			const nested = (a.start < b.start && b.end <= a.end) || (b.start < a.start && a.end <= b.end);
			assert.ok(apart || nested, `overlapping: ${a.start}-${a.end} and ${b.start}-${b.end}`);
		}
	}
}


suite('folding', () => {
	test('blocks, labels up to the next label, local labels, comments', () => {
		assert.deepEqual(rangesOf([
			'; comment 1',		// 0
			'; comment 2',		// 1
			'main',				// 2
			'    ld a,1',		// 3
			'.loop',			// 4
			'    djnz .loop',	// 5
			'',					// 6
			'next',				// 7
			'    STRUCT pt',	// 8
			'x   BYTE',			// 9
			'    ENDS',			// 10
			'    ret'			// 11
		]), ['0-1c', '2-5', '4-5', '8-10b']);
	});

	test('a label right below IF: the IF block folds, the labels stay inside or before it', () => {
		const lines = [
			'showChssbrd equ 0',			// 0
			'Main',							// 1
			'    ld a,1',					// 2
			'    if (showChssbrd == 1)',	// 3
			'Chessboard',					// 4
			'    ld hl,0',					// 5
			'    ld de,1',					// 6
			'    endif',					// 7
			'    ret',						// 8
			'Next',							// 9
			'    ret'						// 10
		];
		// Before: Main 1-3 ended on the IF line and Chessboard 4-8 went past ENDIF, VS Code dropped the IF block
		assert.deepEqual(rangesOf(lines), ['1-2', '3-7b', '4-6', '9-10']);
		assertNestedOrApart(getFoldingRanges(lines.join('\n')));
	});

	test('a label in a block ends before the end of the block, a block it contains completely stays in it', () => {
		const lines = [
			'start',				// 0
			'    DUP 4',			// 1
			'.inner',				// 2
			'    IFDEF X',			// 3
			'    nop',				// 4
			'    ENDIF',			// 5
			'    nop',				// 6
			'    EDUP',				// 7
			'    ret',				// 8
			'.after',				// 9
			'    ret'				// 10
		];
		assert.deepEqual(rangesOf(lines), ['0-10', '1-7b', '2-6', '3-5b', '9-10']);
		assertNestedOrApart(getFoldingRanges(lines.join('\n')));
	});

	test('a label before a block that it would not contain: ends before the block, also behind comments', () => {
		const lines = [
			'first',				// 0
			'    nop',				// 1
			'; about the block',	// 2
			'    IF 1',				// 3
			'    nop',				// 4
			'second',				// 5
			'    nop',				// 6
			'    ENDIF',			// 7
			'    nop'				// 8
		];
		assert.deepEqual(rangesOf(lines), ['0-1', '3-7b', '5-6']);
		assertNestedOrApart(getFoldingRanges(lines.join('\n')));
	});

	test('a label on the line of a block: the line folds the block', () => {
		const lines = [
			'init    IFDEF LOOP',		// 0
			'    nop',					// 1
			'    ENDIF',				// 2
			'    ret',					// 3
			'.big    DUP 8',			// 4
			'    nop',					// 5
			'    EDUP',					// 6
			'    ret'					// 7
		];
		assert.deepEqual(rangesOf(lines), ['0-2b', '4-6b']);
		assertNestedOrApart(getFoldingRanges(lines.join('\n')));
	});

	test('nested blocks with labels in all of them', () => {
		const lines = [
			'a1',					// 0
			'    MODULE m',			// 1
			'b1',					// 2
			'    IF 1',				// 3
			'c1',					// 4
			'    IFDEF Y',			// 5
			'd1',					// 6
			'    nop',				// 7
			'    ELSE',				// 8
			'd2',					// 9
			'    nop',				// 10
			'    ENDIF',			// 11
			'c2',					// 12
			'    ENDIF',			// 13
			'b2',					// 14
			'    ENDMODULE',		// 15
			'a2',					// 16
			'    nop'				// 17
		];
		assertNestedOrApart(getFoldingRanges(lines.join('\n')));
		assert.ok(rangesOf(lines).includes('3-13b'));
		assert.ok(rangesOf(lines).includes('5-11b'));
	});
});
