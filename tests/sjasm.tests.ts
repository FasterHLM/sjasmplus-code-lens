import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {scanLine, TokenKind} from '../src/sjasm/lexer';
import {parseLine, parseText} from '../src/sjasm/parser';
import {Project} from '../src/sjasm/project';


/** Creates a project from in-memory files. The first file is 'main.asm'. */
function makeProject(files: {[name: string]: string}, includePaths: string[] = []): Project {
	const root = path.resolve('/prj');
	const project = new Project({includePaths: includePaths.map(p => path.join(root, p))});
	for (const [name, text] of Object.entries(files))
		project.setFile(path.join(root, name), text);
	return project;
}

function filePath(name: string): string {
	return path.join(path.resolve('/prj'), name);
}

/** Full names of all label definitions. */
function labelNames(project: Project): string[] {
	return project.getAllDefinitions().filter(d => d.key.startsWith('L:')).map(d => d.name).sort();
}

/** The key a reference at 'line'/'text' resolves to (the n-th occurrence of text on the line). */
function refKey(project: Project, file: string, line: number, text: string, nth = 0): string | undefined {
	const lines = project.getLines(filePath(file))!;
	let col = -1;
	for (let i = 0; i <= nth; i++)
		col = lines[line].indexOf(text, col + 1);
	assert.ok(col >= 0, `'${text}' not found on line ${line}`);
	const occ = project.occurrencesAt(filePath(file), line, col).filter(o => !o.isDef && o.written === text);
	assert.ok(occ.length > 0, `no reference '${text}' at line ${line}`);
	return occ[0].key;
}


suite('sjasm lexer', () => {

	function kinds(line: string) {
		return scanLine(line).tokens.map(t => [t.kind, t.text]);
	}

	test('numbers', () => {
		for (const n of ['12', '12d', '0xc', '$c', '#c', '0ch', '0b1100', '%1100', '1100b', '0q14', '14q', '14o', "12'345", '1_3_7q', '$', '$$'])
			assert.deepEqual(kinds(' ld a,' + n), [[TokenKind.Ident, 'ld'], [TokenKind.Ident, 'a'], [TokenKind.Punct, ','], [TokenKind.Number, n]], n);
	});

	test('modulo vs binary', () => {
		assert.deepEqual(kinds(' db 7%10').map(k => k[1]), ['db', '7', '%', '10']);
		assert.deepEqual(kinds(' db %10').map(k => k[1]), ['db', '%10']);
	});

	test('af\' and strings', () => {
		assert.deepEqual(kinds(" ex af,af'"), [[TokenKind.Ident, 'ex'], [TokenKind.Ident, 'af'], [TokenKind.Punct, ','], [TokenKind.Ident, "af'"]]);
		assert.deepEqual(kinds(' db "a\\"b;c", \'\'\'\', "x"Z').map(k => k[1]), ['db', '"a\\"b;c"', ',', "''''", ',', '"x"Z']);
	});

	test('comments', () => {
		const r = scanLine(' ld a,1 ; comment');
		assert.equal(r.lineCommentStart, 8);
		assert.deepEqual(scanLine(' ld /* c */ a,80').tokens.map(t => t.text), ['ld', 'a', ',', '80']);
		assert.deepEqual(scanLine(' nop // c').tokens.map(t => t.text), ['nop']);
		// Nested block comment spanning lines
		const r1 = scanLine(' nop /* a /* b */');
		assert.equal(r1.blockDepth, 1);
		const r2 = scanLine(' still */ inc a', r1.blockDepth);
		assert.equal(r2.blockDepth, 0);
		assert.deepEqual(r2.tokens.map(t => t.text), ['inc', 'a']);
	});

	test('separators, labels and prefixes', () => {
		assert.deepEqual(kinds(' ld a,b:inc hl :: rld :.: nop').filter(k => k[0] === TokenKind.Separator).map(k => k[1]), [':', '::', ':.:']);
		assert.deepEqual(kinds(' ld hl,$$label + @glob + .loc + $$$other').filter(k => k[0] === TokenKind.Ident).map(k => k[1]), ['ld', 'hl', 'label', '@glob', '.loc', 'other']);
		assert.deepEqual(kinds(' .4 nop')[0], [TokenKind.Number, '.4']);
		assert.deepEqual(kinds(' db "a".."b"').map(k => k[1]), ['db', '"a"', '..', '"b"']);
	});
});


suite('sjasm parser', () => {

	function label(line: string) {
		return parseLine(line).parsed.label?.text;
	}

	test('label field', () => {
		assert.equal(label('label: nop'), 'label');
		assert.equal(label('label nop'), 'label');
		assert.equal(label('.loop djnz .loop'), '.loop');
		assert.equal(label('@Glob:'), '@Glob');
		assert.equal(label('!Keep:'), '!Keep');
		assert.equal(label('@.kip1'), '@.kip1');
		assert.equal(label('1       LD E,A'), '1');
		assert.equal(label('1:      djnz 1B'), '1');
		assert.equal(label('   >Indented: ld b,1'), 'Indented');
		assert.equal(label('answer+1:   ld a,13'), 'answer');
		assert.equal(label('answer+*:   ld a,13'), 'answer');
		assert.equal(label('CNT=0'), 'CNT');
		assert.equal(label('Kip@@ nop'), 'Kip@@');
		assert.equal(label('MAIN.loop? nop'), 'MAIN.loop?');
		assert.equal(label(' nop'), undefined);
		assert.equal(label('; comment'), undefined);
		assert.equal(label('/* c */ nop'), undefined);
	});

	test('statements', () => {
		const p = parseLine('label: ld e,c,d,b:inc hl,de ; c').parsed;
		assert.deepEqual(p.statements.map(s => s.opLower), ['ld', 'inc']);
		assert.deepEqual(p.statements[0].operands.map(t => t.text), ['e', ',', 'c', ',', 'd', ',', 'b']);
		const q = parseLine(' @djnz 1B').parsed.statements[0];
		assert.equal(q.inhibit, true);
		assert.equal(q.opLower, 'djnz');
		assert.equal(parseLine(' .db 1').parsed.statements[0].opLower, 'db');
		assert.equal(parseLine(' .4 nop').parsed.statements[0].opLower, 'nop');
		assert.equal(parseLine('CNT=CNT+1').parsed.statements[0].opLower, '=');
	});

	test('dirbol', () => {
		assert.equal(parseLine('org #8000', 0, 0, false).parsed.label?.text, 'org');
		const p = parseLine('org #8000', 0, 0, true).parsed;
		assert.equal(p.label, undefined);
		assert.equal(p.statements[0].opLower, 'org');
		assert.equal(parseLine('start nop', 0, 0, true).parsed.label?.text, 'start');
	});

	test('lua block and listing', () => {
		const t = parseText(' lua\n x = 5 ; not asm\n endlua\n nop');
		assert.equal(t.parsed[1].lua, true);
		assert.equal(t.parsed[2].statements[0].opLower, 'endlua');
		assert.equal(t.parsed[3].statements[0].opLower, 'nop');

		const lst = parseText([
			'# file opened: src/main.asm',
			'   1  0000              main:  ld a,5',
			'   2+ 8000 3E 05        \t\tret'
		].join('\n'), {listing: true});
		assert.equal(lst.parsed[0].statements.length, 0);
		assert.equal(lst.parsed[1].label?.text, 'main');
		assert.equal(lst.parsed[1].label?.start, 24);
		assert.equal(lst.parsed[2].statements[0].opLower, 'ret');
	});
});


suite('sjasm project', () => {

	test('local labels and modules (docs example 4.1)', () => {
		const p = makeProject({
			'main.asm': [
				'    MODULE main',				// 0
				'Main:',						// 1
				'        CALL SetScreen',		// 2
				'        CALL vdp.Cls',			// 3
				'.loop:',						// 4
				'        LD A,(.event)',		// 5
				'        CALL ProcessEvent',	// 6
				'        DJNZ .loop',			// 7
				'        MODULE vdp',			// 8
				'@SetScreen:',					// 9
				'.loop:',						// 10
				'            RET',				// 11
				'Cls:',							// 12
				'!KeepClsForLocal:',			// 13
				'.loop:      DJNZ .loop',		// 14
				'            RET',				// 15
				'        ENDMODULE',			// 16
				'Main.event DB 0',				// 17
				'    ENDMODULE'					// 18
			].join('\n')
		});
		assert.deepEqual(labelNames(p), ['SetScreen', 'SetScreen.loop', 'main.Main', 'main.Main.event', 'main.Main.loop', 'main.vdp.Cls', 'main.vdp.Cls.loop', 'main.vdp.KeepClsForLocal'].sort());
		assert.equal(refKey(p, 'main.asm', 2, 'SetScreen'), 'L:SetScreen');
		assert.equal(refKey(p, 'main.asm', 3, 'vdp.Cls'), 'L:main.vdp.Cls');
		assert.equal(refKey(p, 'main.asm', 5, '.event'), 'L:main.Main.event');
		assert.equal(refKey(p, 'main.asm', 6, 'ProcessEvent'), undefined);
		assert.equal(refKey(p, 'main.asm', 7, '.loop'), 'L:main.Main.loop');
		assert.equal(refKey(p, 'main.asm', 14, '.loop', 1), 'L:main.vdp.Cls.loop');
		assert.deepEqual(p.getDefinitions('M:main.vdp').map(d => d.line), [8]);
	});

	test('module lookup (docs example 6.37)', () => {
		const p = makeProject({
			'main.asm': [
				'    MODULE xxx',				// 0
				'Kip:',							// 1
				'    ld  hl,@Kip',				// 2
				'    ld  hl,@Kop',				// 3
				'    ld  hl,Kop',				// 4
				'Kop:',							// 5
				'    ld  hl,Kip',				// 6
				'    ld  hl,yyy.Kip',			// 7
				'    ld  hl,nested.Kip',		// 8
				'        MODULE nested',		// 9
				'Kip:        ret',				// 10
				'        ENDMODULE',			// 11
				'    ENDMODULE',				// 12
				'    MODULE yyy',				// 13
				'Kip:    ret',					// 14
				'@Kop:   ret',					// 15
				'    ENDMODULE',				// 16
				'Kip     ret'					// 17
			].join('\n')
		});
		assert.equal(refKey(p, 'main.asm', 2, '@Kip'), 'L:Kip');
		assert.equal(refKey(p, 'main.asm', 3, '@Kop'), 'L:Kop');
		assert.equal(refKey(p, 'main.asm', 4, 'Kop'), 'L:xxx.Kop');
		assert.equal(refKey(p, 'main.asm', 6, 'Kip'), 'L:xxx.Kip');
		assert.equal(refKey(p, 'main.asm', 7, 'yyy.Kip'), 'L:yyy.Kip');
		assert.equal(refKey(p, 'main.asm', 8, 'nested.Kip'), 'L:xxx.nested.Kip');
		assert.deepEqual(p.getReferences('L:xxx.Kip').map(r => r.line), [6]);
	});

	test('no lookup in parent modules', () => {
		const p = makeProject({
			'main.asm': [
				'    module outer',
				'Parent: nop',
				'    module inner',
				'Child: call Parent',
				'    endmodule',
				'    endmodule'
			].join('\n')
		});
		assert.equal(refKey(p, 'main.asm', 3, 'Parent'), undefined);
	});

	test('@ labels and last label resets (docs 4.3, 6.37)', () => {
		const p = makeProject({
			'main.asm': [
				'    MODULE xxx',
				'Label',
				'.Local',
				'@Label',
				'.Local',
				'@yyy.Local',
				'yyy.Local',
				'    ENDMODULE',
				'Kep:',
				'    MODULE zzz',
				'.local:',
				'Kup:',
				'.local',
				'    ENDMODULE',
				'.local:'
			].join('\n')
		});
		assert.deepEqual(labelNames(p), ['Kep', 'Label', 'Label.Local', '_.local', 'xxx.Label', 'xxx.Label.Local', 'xxx.yyy.Local', 'yyy.Local', 'zzz.Kup', 'zzz.Kup.local', 'zzz._.local'].sort());
	});

	test('equ, defl, struct and instances', () => {
		const p = makeProject({
			'main.asm': [
				'Start:  nop',					// 0
				'X EQU 5',						// 1
				'.a:     nop',					// 2
				'Y = 3',						// 3
				'.b:     nop',					// 4
				'    STRUCT SCOLOR',			// 5
				'RED     BYTE 4',				// 6
				'GREEN   BYTE 5',				// 7
				'    ENDS',						// 8
				'.c:     nop',					// 9
				'    STRUCT SDOT',				// 10
				'X       BYTE',					// 11
				'C       SCOLOR 0,0,0',			// 12
				'    ENDS',						// 13
				'COLOR   SCOLOR',				// 14
				'.d:     nop',					// 15
				'DOT1    SDOT',					// 16
				'    ld a,(COLOR.GREEN)',		// 17
				'    ld b,(ix+SCOLOR.GREEN)',	// 18
				'    ld c,(DOT1.C.GREEN)',		// 19
				'    module q',					// 20
				'    STRUCT T',					// 21
				'g       BYTE 0',				// 22
				'    ENDS',						// 23
				'qi      T',					// 24
				'    endmodule',				// 25
				'gi      q.T'					// 26
			].join('\n')
		});
		const names = labelNames(p);
		for (const n of ['X', 'X.a', 'Y', 'Y.b', 'SCOLOR', 'SCOLOR.RED', 'SCOLOR.GREEN', 'SCOLOR.c', 'SDOT', 'SDOT.X', 'SDOT.C', 'COLOR', 'COLOR.d', 'DOT1', 'q.T', 'q.T.g', 'q.qi', 'gi'])
			assert.ok(names.includes(n), n + ' missing in ' + names.join(','));
		// Synthetic instance fields
		assert.equal(p.getDefinitions('L:COLOR.GREEN')[0].derivedFrom, 'L:SCOLOR.GREEN');
		assert.equal(p.getDefinitions('L:DOT1.C.GREEN')[0].derivedFrom, 'L:SCOLOR.GREEN');
		assert.equal(p.getDefinitions('L:gi.g')[0].derivedFrom, 'L:q.T.g');
		assert.equal(p.getDefinitions('L:q.qi.g').length, 1);
		// References of the struct field include the instance fields
		assert.deepEqual(p.getReferences('L:SCOLOR.GREEN').map(r => r.line).sort(), [17, 18, 19]);
		assert.equal(p.getDefinitions('L:X')[0].kind, 'equ');
		assert.equal(p.getDefinitions('L:Y')[0].kind, 'defl');
		assert.equal(p.getDefinitions('L:SCOLOR')[0].kind, 'struct');
		assert.equal(refKey(p, 'main.asm', 14, 'SCOLOR'), 'L:SCOLOR');
	});

	test('macros', () => {
		const p = makeProject({
			'main.asm': [
				'    MACRO mm arg',				// 0
				'.ml     nop',					// 1
				'@.al    nop',					// 2
				'Inm     ld a,arg',				// 3
				'        djnz .ml',				// 4
				'    ENDM',						// 5
				'M2:     mm 5',					// 6
				'.e      nop',					// 7
				'Other   MACRO',				// 8
				'        call M2',				// 9
				'        ENDM',					// 10
				'    module m',					// 11
				'        Other',				// 12
				'    endmodule'					// 13
			].join('\n')
		});
		const names = labelNames(p);
		for (const n of ['M2', 'M2.al', 'Inm', 'Inm.e'])
			assert.ok(names.includes(n), n + ' missing in ' + names.join(','));
		assert.equal(refKey(p, 'main.asm', 4, '.ml'), 'ML:mm>.ml');
		assert.equal(refKey(p, 'main.asm', 6, 'mm'), 'X:mm');
		assert.equal(refKey(p, 'main.asm', 12, 'Other'), 'X:Other');
		// 'arg' is a macro parameter, not a reference
		const lines = p.getLines(filePath('main.asm'))!;
		assert.equal(p.occurrencesAt(filePath('main.asm'), 3, lines[3].indexOf('arg')).length, 0);
		// Body reference resolved in the context of the invocation (module m): M2 is global
		assert.equal(refKey(p, 'main.asm', 9, 'M2'), 'L:M2');
		assert.deepEqual(p.getDefinitions('X:Other').map(d => d.line), [8]);
	});

	test('temporary labels', () => {
		const p = makeProject({
			'main.asm': [
				'        JR NC,1_F',			// 0
				'        INC D',				// 1
				'1       LD E,A',				// 2
				'2       LD B,4',				// 3
				'        DJNZ 2_B',				// 4
				'        jr 1B',				// 5
				'        ld hl,1B',				// 6
				'1:      djnz 1B'				// 7
			].join('\n')
		});
		const def1 = p.occurrencesAt(filePath('main.asm'), 2, 0)[0].key;
		const def2 = p.occurrencesAt(filePath('main.asm'), 3, 0)[0].key;
		const def3 = p.occurrencesAt(filePath('main.asm'), 7, 0)[0].key;
		assert.equal(refKey(p, 'main.asm', 0, '1_F'), def1);
		assert.equal(refKey(p, 'main.asm', 4, '2_B'), def2);
		assert.equal(refKey(p, 'main.asm', 5, '1B'), def1);
		assert.equal(p.occurrencesAt(filePath('main.asm'), 6, 12).length, 0);	// binary 1, not a label
		assert.equal(refKey(p, 'main.asm', 7, '1B'), def3);
	});

	test('includes carry the module and the last label', () => {
		const p = makeProject({
			'main.asm': [
				'    module game',
				'    include "lib/util.asm"',
				'    include <inc.asm>',
				'    endmodule',
				'    call game.util_fn'
			].join('\n'),
			'lib/util.asm': [
				'util_fn: ret',
				'.loc: jr .loc'
			].join('\n'),
			'include/inc.asm': 'from_inc: nop'
		}, ['include']);
		assert.deepEqual(labelNames(p), ['game.from_inc', 'game.util_fn', 'game.util_fn.loc']);
		assert.equal(refKey(p, 'main.asm', 4, 'game.util_fn'), 'L:game.util_fn');
		const lines = p.getLines(filePath('main.asm'))!;
		assert.equal(p.includeAt(filePath('main.asm'), 1, lines[1].indexOf('lib'))?.target, filePath('lib/util.asm'));
		assert.equal(p.includeAt(filePath('main.asm'), 2, lines[2].indexOf('inc.asm'))?.target, filePath('include/inc.asm'));
	});

	test('defines, conditions and registers', () => {
		const p = makeProject({
			'main.asm': [
				'    DEFINE DEBUG 1',			// 0
				'    IFDEF DEBUG',				// 1
				'    ld a,DEBUG',				// 2
				'    ENDIF',					// 3
				'z_lbl: jp z,z_lbl',			// 4
				'    call z_lbl, z,z_lbl',		// 5
				'    ld a,(ix+5)',				// 6
				'    UNDEFINE DEBUG',			// 7
				'    ld a,DEBUG'				// 8
			].join('\n')
		});
		assert.equal(refKey(p, 'main.asm', 1, 'DEBUG'), 'D:DEBUG');
		assert.equal(refKey(p, 'main.asm', 2, 'DEBUG'), 'D:DEBUG');
		assert.equal(refKey(p, 'main.asm', 7, 'DEBUG'), 'D:DEBUG');
		// After UNDEFINE it is a label reference (unresolved)
		assert.equal(refKey(p, 'main.asm', 8, 'DEBUG'), undefined);
		assert.deepEqual(p.getReferences('L:z_lbl').map(r => r.line), [4, 5, 5]);
		assert.equal(p.getUnresolved().length, 1);
	});

	test('listing file (tests/data/sample.list)', () => {
		const file = path.join(__dirname, '../../tests/data/sample.list');
		const p = new Project();
		p.setFile(file, fs.readFileSync(file, 'utf8'), true);
		const clear = p.getDefinitions('L:clear_screen');
		assert.equal(clear.length, 1);
		assert.equal(clear[0].start, 24);
		assert.deepEqual(p.getReferences('L:clear_screen').map(r => r.line + 1), [592, 972]);
		assert.deepEqual(p.getReferences('L:fill_backg').map(r => r.line + 1), [213, 640]);
	});

	test('modules and structs (tests/data/modulesstruct.asm)', () => {
		const file = path.join(__dirname, '../../tests/data/modulesstruct.asm');
		const p = new Project();
		p.setFile(file, fs.readFileSync(file, 'utf8'));
		const names = labelNames(p);
		for (const n of ['TestSuite_ClearScreen.UT_clear_screen', 'TestSuite_Fill.FILL_MEMORY_SIZE', 'mlbl4.local'])
			assert.ok(names.includes(n), n);
	});

	test('data directives and CSpect instructions are not references', () => {
		const p = makeProject({
			'main.asm': [
				'val     WORD 5',
				'        break',
				'        exd',
				'        ld hl,val'
			].join('\n')
		});
		assert.equal(p.getDefinitions('L:val')[0].kind, 'data');
		assert.equal(p.getUnresolved().length, 0);
		assert.equal(p.getReferences('L:val').length, 1);
	});

	test('conditional assembly: inactive blocks', () => {
		const p = makeProject({
			'main.asm': [
				'    DEVICE ZXSPECTRUM48',	// 0
				'    IFDEF DEBUG',			// 1
				'    call missing1',		// 2: inactive
				'    DEFINE INNER',			// 3: inactive, does not define
				'    ELSE',					// 4
				'    call missing2',		// 5: active
				'    ENDIF',				// 6
				'    IFDEF INNER',			// 7
				'    call missing3',		// 8: inactive
				'    ELSEIF 1',				// 9
				'    call missing4',		// 10: unknown
				'    ELSE',					// 11
				'    call missing5',		// 12: unknown
				'    ENDIF',				// 13
				'    IFDEF CMDLINE',		// 14
				'    call missing6',		// 15: active, defined on the command line
				'    ENDIF',				// 16
				'    IFNDEF DEBUG',			// 17
				'    nop',					// 18: active
				'    ELSEIF 1',				// 19
				'    call missing7',		// 20: inactive (a branch was taken)
				'    ELSE',					// 21
				'    call missing8',		// 22: inactive
				'    ENDIF'					// 23
			].join('\n')
		});
		p.setOptions({defines: ['CMDLINE']});
		const reported = p.getReportableUnresolved().map(r => r.written).sort();
		assert.deepEqual(reported, ['missing2', 'missing4', 'missing5', 'missing6']);
		assert.deepEqual(p.getInactiveLines(filePath('main.asm')), [2, 3, 8, 20, 22]);
	});

	test('soft references: macro arguments, define values, IFDEF, ASSERT, SAVETAP, Lua', () => {
		const p = makeProject({
			'main.asm': [
				'    DEVICE ZXSPECTRUM48',
				'    MACRO m arg',
				'    ld a,arg',
				'    ENDM',
				'    m some_text',
				'    DEFINE NAME game.trd',
				'    IFDEF UNKNOWN_DEFINE',
				'    ENDIF',
				'    ASSERT 1, this is a message',
				'    SAVETAP "x.tap", CODE, "name", 0, 1',
				'    LUA',
				'    sj.insert_define("FROM_LUA", 5)',
				'    ENDLUA',
				'    ld a,FROM_LUA'
			].join('\n')
		});
		assert.deepEqual(p.getReportableUnresolved().map(r => r.written), []);
		assert.equal(p.getDefinitions('D:FROM_LUA').length, 1);
		assert.equal(refKey(p, 'main.asm', 13, 'FROM_LUA'), 'D:FROM_LUA');
	});

	test('fragments not included by a program are not reported', () => {
		const p = makeProject({
			'main.asm': '    DEVICE ZXSPECTRUM48\n    include "used.asm"\n    call missing_in_main',
			'used.asm': '    call missing_in_used',
			'fragment.asm': '    call missing_in_fragment'
		});
		assert.deepEqual(p.getReportableUnresolved().map(r => r.written).sort(), ['missing_in_main', 'missing_in_used']);
		// Without any program everything is reported
		const q = makeProject({'a.asm': '    call missing_a'});
		assert.deepEqual(q.getReportableUnresolved().map(r => r.written), ['missing_a']);
	});

	test('update after change', () => {
		const p = makeProject({'main.asm': 'lbl: nop\n jp lbl'});
		assert.equal(p.getReferences('L:lbl').length, 1);
		p.setFile(filePath('main.asm'), 'lbl: nop\n jp lbl\n jp lbl');
		assert.equal(p.getReferences('L:lbl').length, 2);
		p.removeFile(filePath('main.asm'));
		assert.equal(p.getReferences('L:lbl').length, 0);
	});
});
