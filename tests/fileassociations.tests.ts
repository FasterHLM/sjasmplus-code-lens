import * as assert from 'assert';
import {findConflictingAssociations} from '../src/fileassociations';


suite('file associations', () => {

	const sources = ['.asm', '.a80', '.z80', '.inc'];
	const listings = ['.lst', '.list', '.lis'];

	test('finds associations of our file types with other languages', () => {
		const result = findConflictingAssociations({
			'*.asm': 'asm-collection',
			'**/*.A80': 'asm-collection',
			'*.z80': 'z80-macroasm',
			'*.lst': 'asm-list-file',
			'*.inc': 'sjasmplus',
			'*.css': 'css',
			'src/*.asm': 'asm-collection',
			'*.{asm,inc}': 'other'
		}, sources, listings, ['z80-macroasm', 'css', 'sjasmplus']);
		assert.deepEqual(result, [
			{pattern: '*.asm', language: 'asm-collection', target: 'sjasmplus', missing: true},
			{pattern: '**/*.A80', language: 'asm-collection', target: 'sjasmplus', missing: true},
			{pattern: '*.z80', language: 'z80-macroasm', target: 'sjasmplus', missing: false},
			{pattern: '*.lst', language: 'asm-list-file', target: 'sjasmplus-list', missing: true}
		]);
	});

	test('nothing to do', () => {
		assert.deepEqual(findConflictingAssociations({'*.asm': 'sjasmplus', '*.lst': 'sjasmplus-list'}, sources, listings, []), []);
		assert.deepEqual(findConflictingAssociations({}, sources, listings, []), []);
	});
});
