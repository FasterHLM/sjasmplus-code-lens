import * as assert from 'assert';
import {editDistance, maxTypos} from '../src/sjasm/suggest';


suite('typos of a name', () => {
	test('edit distance: a substitution, an insertion, a deletion and a swap of two neighbours are one change', () => {
		assert.equal(editDistance('start', 'start'), 0);
		assert.equal(editDistance('abc', 'abd'), 1);
		assert.equal(editDistance('abc', 'abcd'), 1);
		assert.equal(editDistance('abcd', 'abc'), 1);
		assert.equal(editDistance('strat', 'start'), 1);
		assert.equal(editDistance('ab', 'ba'), 1);
		assert.equal(editDistance('abc', ''), 3);
		assert.equal(editDistance('', 'abc'), 3);
		assert.equal(editDistance('kitten', 'sitting'), 3);
		assert.equal(editDistance('clear_screen', 'clear_scren'), 1);
	});

	test('a short name has no typos (too many names are alike), a longer one may differ in one or two characters', () => {
		assert.deepEqual([0, 1, 2, 3].map(maxTypos), [0, 0, 0, 0]);
		assert.deepEqual([4, 5].map(maxTypos), [1, 1]);
		assert.deepEqual([6, 7, 12, 30].map(maxTypos), [2, 2, 2, 2]);
	});
});
