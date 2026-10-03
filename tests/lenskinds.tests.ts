import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {LENS_KIND_GROUPS, lensKinds} from '../src/lensKinds';


const ALL = ['data', 'define', 'defl', 'equ', 'field', 'label', 'macro', 'struct'];
const kinds = (groups: unknown) => [...lensKinds(groups)].sort();


suite('code lens kinds', () => {
	test('not set, or not a list: all kinds, as before the setting existed', () => {
		assert.deepEqual(kinds(undefined), ALL);
		assert.deepEqual(kinds('labels'), ALL);
		assert.deepEqual(kinds(5), ALL);
		assert.deepEqual(kinds(null), ALL);
	});

	test('groups: labels, constants, structs, macros, defines', () => {
		assert.deepEqual(kinds(['labels']), ['data', 'label']);
		assert.deepEqual(kinds(['constants']), ['defl', 'equ']);
		assert.deepEqual(kinds(['structs']), ['field', 'struct']);
		assert.deepEqual(kinds(['macros']), ['macro']);
		assert.deepEqual(kinds(['defines']), ['define']);
		assert.deepEqual(kinds(['constants', 'macros']), ['defl', 'equ', 'macro']);
		assert.deepEqual(kinds(['labels', 'constants', 'structs', 'macros', 'defines']), ALL);
		assert.deepEqual(kinds(['macros', 'macros']), ['macro'], 'a group twice');
	});

	test('an empty list: no code lens at all', () => {
		assert.deepEqual(kinds([]), []);
	});

	test('names that are not groups are ignored', () => {
		assert.deepEqual(kinds(['labels', 'nonsense', 3]), ['data', 'label']);
		assert.deepEqual(kinds(['nonsense']), []);
		assert.deepEqual(kinds(['Labels']), [], 'the names are lower case');
		assert.deepEqual(kinds(['constructor', 'toString', '__proto__']), [], 'not the properties of every object');
	});

	test('the groups are the ones the manifest offers', () => {
		const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
		const setting = manifest.contributes.configuration.properties['sjasmplus-code-lens.codeLensKinds'];
		assert.ok(setting, 'the setting is in package.json');
		assert.deepEqual([...setting.items.enum].sort(), Object.keys(LENS_KIND_GROUPS).sort());
		assert.deepEqual(setting.default, setting.items.enum, 'all groups by default');
		assert.equal(setting.items.enumDescriptions.length, setting.items.enum.length, 'every group is described');
	});
});
