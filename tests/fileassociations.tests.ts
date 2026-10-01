import * as assert from 'assert';
import {findCompetingLanguages, findConflictingAssociations} from '../src/fileassociations';


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

	const macroasm = {extensionId: 'mborik.z80-macroasm', extensionName: 'Z80 Macro-Assembler', language: 'z80-macroasm', extensions: ['.a80', '.ASM', '.inc', '.s']};
	const imanolea = {extensionId: 'Imanolea.z80-asm', extensionName: 'Z80 Assembly', language: 'z80-asm', extensions: ['.asm', '.s', '.z80', '.$C', '.mac']};
	const lister = {extensionId: 'some.lister', extensionName: 'Lister', language: 'listing', extensions: ['.lst', '.lst']};

	test('finds other extensions for our file types', () => {
		const result = findCompetingLanguages([macroasm, imanolea, lister], {}, sources, listings);
		assert.deepEqual(result.map(c => [c.extensionId, c.language, c.pattern, c.target]), [
			['mborik.z80-macroasm', 'z80-macroasm', '*.a80', 'sjasmplus'],
			['mborik.z80-macroasm', 'z80-macroasm', '*.asm', 'sjasmplus'],
			['mborik.z80-macroasm', 'z80-macroasm', '*.inc', 'sjasmplus'],
			['Imanolea.z80-asm', 'z80-asm', '*.asm', 'sjasmplus'],
			['Imanolea.z80-asm', 'z80-asm', '*.z80', 'sjasmplus'],
			['some.lister', 'listing', '*.lst', 'sjasmplus-list']
		]);
		assert.equal(result[1].extension, '.asm');
	});

	test('file types decided by files.associations are no competition', () => {
		// "*.inc" chosen by the user for another language: that is reported by findConflictingAssociations
		const result = findCompetingLanguages([macroasm], {'*.asm': 'sjasmplus', '**/*.A80': 'sjasmplus', '*.inc': 'z80-macroasm', 'src/*.s': 'z80-macroasm'}, sources, listings);
		assert.deepEqual(result, []);
		assert.deepEqual(findCompetingLanguages([], {}, sources, listings), []);
	});
});
