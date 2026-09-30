import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';


/** An expected token: its text and its innermost scope (without the '.sjasmplus' suffix). */
type Expected = [string, string];


suite('TextMate grammar', () => {

    let asmGrammar: vsctm.IGrammar;
    let listGrammar: vsctm.IGrammar;

    suiteSetup(async () => {
        const wasm = fs.readFileSync(path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm'));
        await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
        const grammarFiles: {[scopeName: string]: string} = {
            'source.sjasmplus': './grammar/asm.json',
            'source.sjasmplus.list': './grammar/asm_list.json'
        };
        const registry = new vsctm.Registry({
            onigLib: Promise.resolve({
                createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
                createOnigString: (str: string) => new oniguruma.OnigString(str)
            }),
            // source.lua (embedded in LUA blocks) is intentionally not available here
            loadGrammar: async (scopeName: string) => {
                const file = grammarFiles[scopeName];
                if (!file)
                    return null;
                return vsctm.parseRawGrammar(fs.readFileSync(file).toString(), file);
            }
        });
        asmGrammar = (await registry.loadGrammar('source.sjasmplus'))!;
        listGrammar = (await registry.loadGrammar('source.sjasmplus.list'))!;
    });


    /** Tokenizes the lines and returns the tokens of the last line. */
    function tokenizeLast(grammar: vsctm.IGrammar, lines: string[]): {text: string, scopes: string[]}[] {
        let state = vsctm.INITIAL;
        let tokens: vsctm.IToken[] = [];
        let line = '';
        for (line of lines) {
            const result = grammar.tokenizeLine(line, state);
            state = result.ruleStack;
            tokens = result.tokens;
        }
        return tokens.map(t => ({text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes}));
    }

    /** Checks that the expected tokens appear in the last line in the given order,
     * each with the given innermost scope. */
    function check(grammar: vsctm.IGrammar, lines: string | string[], expected: Expected[]) {
        if (typeof lines === 'string')
            lines = [lines];
        const tokens = tokenizeLast(grammar, lines);
        const lastLine = lines[lines.length - 1];
        let k = 0;
        for (const [text, scope] of expected) {
            while (k < tokens.length && tokens[k].text !== text)
                k++;
            assert.ok(k < tokens.length, `Token '${text}' not found in '${lastLine}'`);
            const inner = tokens[k].scopes[tokens[k].scopes.length - 1];
            const full = scope.startsWith('meta.embedded.') ? scope : scope + '.sjasmplus';
            assert.equal(inner, full, `Scope of '${text}' in '${lastLine}'`);
            k++;
        }
    }

    const checkAsm = (lines: string | string[], expected: Expected[]) => check(asmGrammar, lines, expected);

    const HEX = 'constant.numeric.integer.hexadecimal';
    const BIN = 'constant.numeric.integer.binary';
    const OCT = 'constant.numeric.integer.octal';
    const DEC = 'constant.numeric.integer.decimal';
    const INSTR = 'keyword.other.instruction.z80';
    const REG = 'support.type.register.z80';
    const DIR = 'keyword.control.directive';
    const COND = 'keyword.control.conditional';
    const LABEL = 'entity.name.function.label';
    const LABEL_REF = 'variable.other.label';


    suite('numbers', () => {

        test('hexadecimal', () => {
            checkAsm('\tld a,$FF : ld b,#ff : ld c,0xFF : ld d,0FFh : ld e,0ch : ld hl,$40_DD : ld hl,#12\'34', [
                ['$FF', HEX], ['#ff', HEX], ['0xFF', HEX], ['0FFh', HEX], ['0ch', HEX], ['$40_DD', HEX], ['#12\'34', HEX]
            ]);
            // must start with a digit, otherwise it is a label
            checkAsm('\tld a,FFh', [['FFh', LABEL_REF]]);
            // "0b800h" is hexadecimal, not binary
            checkAsm('\tld hl,0b800h', [['0b800h', HEX]]);
        });

        test('binary', () => {
            checkAsm('\tld a,%1010 : ld b,0b1010 : ld c,1010b : ld d,%11\'01\'11\'00 : ld hl,1B', [
                ['%1010', BIN], ['0b1010', BIN], ['1010b', BIN], ['%11\'01\'11\'00', BIN], ['1B', BIN]
            ]);
            // '%' after an operand is modulo
            checkAsm('\tdb x%10', [['x', LABEL_REF], ['%', 'keyword.operator.arithmetic'], ['10', DEC]]);
        });

        test('octal and decimal', () => {
            checkAsm('\tdb 0q14, 14q, 14o, 12, 12d, 12\'345, 1_3_7q, 12.5', [
                ['0q14', OCT], ['14q', OCT], ['14o', OCT], ['12', DEC], ['12d', DEC], ['12\'345', DEC], ['1_3_7q', OCT], ['12.5', DEC]
            ]);
        });

        test('invalid numbers', () => {
            checkAsm('\tld a,2B', [['2B', 'invalid.illegal.numeric']]);
        });

        test('location counter', () => {
            checkAsm('\tjr $ : dw $$, $$$, $$$$, $$label, $$$label', [
                ['$', 'variable.language.location-counter'],
                ['$$', 'variable.language.location-counter'],
                ['$$$', 'variable.language.location-counter'],
                ['$$$$', 'variable.language.location-counter'],
                ['$$', 'keyword.operator.label-memory'], ['label', LABEL_REF],
                ['$$$', 'keyword.operator.label-memory'], ['label', LABEL_REF]
            ]);
        });
    });


    suite('labels', () => {

        test('definitions', () => {
            checkAsm('main:', [['main', LABEL], [':', 'punctuation.separator.label']]);
            checkAsm('main\tnop', [['main', LABEL], ['nop', INSTR]]);
            checkAsm('.loop\tdjnz .loop', [['.loop', LABEL + '.local'], ['djnz', INSTR], ['.loop', LABEL_REF + '.local']]);
            checkAsm('@global:', [['@global', LABEL]]);
            checkAsm('@.kip1', [['@.kip1', LABEL + '.local']]);
            checkAsm('!KeepClsForLocal:', [['!KeepClsForLocal', LABEL]]);
            checkAsm('module.label equ 5', [['module.label', LABEL]]);
            checkAsm('MAIN.loop?', [['MAIN.loop?', LABEL]]);
            checkAsm('1\tld e,a', [['1', LABEL + '.temporary'], ['ld', INSTR]]);
            checkAsm('1:\tdjnz 1B', [['1', LABEL + '.temporary'], ['djnz', INSTR], ['1B', LABEL_REF + '.temporary']]);
        });

        test('SMC offset and indentation', () => {
            checkAsm('answer+1:\tld a,13', [['answer', LABEL], ['+', 'keyword.operator.smc-offset'], ['1', DEC], ['ld', INSTR]]);
            checkAsm('answer+*:\tld a,13', [['answer', LABEL], ['*', 'keyword.operator.smc-offset']]);
            checkAsm('   >Indented: ld b,123', [['>', 'punctuation.definition.label.indent'], ['Indented', LABEL], ['ld', INSTR]]);
            checkAsm('       >.loop:  djnz .loop', [['.loop', LABEL + '.local'], ['djnz', INSTR]]);
        });

        test('only at the beginning of line', () => {
            // keywords at the beginning of line are labels
            checkAsm('ld\tnop', [['ld', LABEL], ['nop', INSTR]]);
            // but these block terminators are recognized
            checkAsm('ENDIF', [['ENDIF', COND]]);
            checkAsm('endm', [['endm', DIR + '.macro']]);
        });

        test('references', () => {
            checkAsm('\tld hl,@Kip : ld hl,yyy.Kip : call vdp.Cls', [
                ['@Kip', LABEL_REF], ['yyy.Kip', LABEL_REF], ['vdp.Cls', LABEL_REF]
            ]);
            checkAsm('\tjr nz,.loop', [['jr', INSTR], ['nz', 'constant.language.condition.z80'], ['.loop', LABEL_REF + '.local']]);
            checkAsm('\tjp 1B', [['jp', INSTR], ['1B', LABEL_REF + '.temporary']]);
            checkAsm('\tjr c,1F', [['c', 'constant.language.condition.z80'], ['1F', LABEL_REF + '.temporary']]);
            checkAsm('\tld hl,1_B*3', [['1_B', LABEL_REF + '.temporary']]);
            checkAsm('\tld a,(ix+SCOLOR.RED)', [['SCOLOR.RED', LABEL_REF]]);
        });
    });


    suite('instructions', () => {

        test('registers', () => {
            checkAsm('\tld a,(ix+5)', [
                ['ld', INSTR], ['a', REG], [',', 'punctuation.separator.comma'], ['(', 'punctuation.section.parens.begin'],
                ['ix', REG], ['+', 'keyword.operator.arithmetic'], ['5', DEC], [')', 'punctuation.section.parens.end']
            ]);
            checkAsm('\tex af,af\'', [['ex', INSTR], ['af', REG], ['af\'', REG]]);
            checkAsm('\tLD A,[HL]', [['LD', INSTR], ['A', REG], ['[', 'punctuation.section.brackets.begin'], ['HL', REG]]);
            checkAsm('\tld a,i : ld r,a', [['i', REG], ['r', REG]]);
        });

        test('condition c vs. register c', () => {
            checkAsm('\tjp c,label', [['c', 'constant.language.condition.z80']]);
            checkAsm('\tret c', [['c', 'constant.language.condition.z80']]);
            checkAsm('\tcall pe,x : ret m : jp po,x', [['pe', 'constant.language.condition.z80'], ['m', 'constant.language.condition.z80'], ['po', 'constant.language.condition.z80']]);
            checkAsm('\tld c,5', [['c', REG]]);
            checkAsm('\tjp (c)', [['c', REG]]);
            checkAsm('\tout (c),a', [['c', REG]]);
        });

        test('undocumented Z80', () => {
            checkAsm('\tsll a : sli b : out (c),0 : in f,(c) : inf', [
                ['sll', INSTR + '.undocumented'], ['sli', INSTR + '.undocumented'], ['out', INSTR], ['0', DEC],
                ['in', INSTR], ['f', REG], ['inf', INSTR]
            ]);
            checkAsm('\tld ixh,a : ld yl,b : ld lx,c : ld HX,d', [
                ['ixh', REG + '.undocumented'], ['yl', REG + '.undocumented'], ['lx', REG + '.undocumented'], ['HX', REG + '.undocumented']
            ]);
            checkAsm('\trrc (iy),a : set 4,(ix+4),c', [['rrc', INSTR], ['iy', REG], ['set', INSTR], ['c', REG]]);
        });

        test('Z80N', () => {
            checkAsm('\tnextreg $44,123 : mul d,e : swapnib : ldirx : pixelad : bsla de,b : test 5', [
                ['nextreg', 'keyword.other.instruction.z80n'], ['$44', HEX], ['mul', 'keyword.other.instruction.z80n'],
                ['swapnib', 'keyword.other.instruction.z80n'], ['ldirx', 'keyword.other.instruction.z80n'],
                ['pixelad', 'keyword.other.instruction.z80n'], ['bsla', 'keyword.other.instruction.z80n'],
                ['test', 'keyword.other.instruction.z80n']
            ]);
            checkAsm('\tbreak : exit', [['break', 'keyword.other.instruction.z80n.cspect'], ['exit', 'keyword.other.instruction.z80n.cspect']]);
        });

        test('fake instructions and multi-arguments', () => {
            checkAsm('\tld hl,de : ldi a,(hl) : sub hl,bc : sla de', [
                ['ld', INSTR], ['hl', REG], ['de', REG], ['ldi', INSTR], ['sub', INSTR], ['sla', INSTR]
            ]);
            checkAsm('\tpush af,bc : ld e,c,,d,b', [
                ['push', INSTR], ['af', REG], [',', 'punctuation.separator.comma'], ['bc', REG],
                ['ld', INSTR], [',,', 'punctuation.separator.multi-argument']
            ]);
            checkAsm('\texa : ex af', [['exa', INSTR], ['ex', INSTR], ['af', REG]]);
        });

        test('statements separated by colon', () => {
            checkAsm('\tORG 100h:LD A,10:LD B,10:SUB B:RET:IFDEF AA:nop:ENDIF', [
                ['ORG', DIR], ['100h', HEX], [':', 'punctuation.separator.statement'], ['LD', INSTR], ['A', REG],
                ['LD', INSTR], ['SUB', INSTR], ['RET', INSTR], ['IFDEF', COND], ['AA', 'variable.other.constant.define'],
                ['nop', INSTR], ['ENDIF', COND]
            ]);
            checkAsm('label:nop', [['label', LABEL], ['nop', INSTR]]);
            checkAsm('.local: ds 10 :.: rld ::', [['ds', DIR + '.data'], [':.:', 'punctuation.separator.statement'], ['rld', INSTR], ['::', 'punctuation.separator.statement']]);
        });

        test('case', () => {
            // keywords are either lowercase or uppercase
            checkAsm('\tLd a,b', [['Ld', 'entity.name.function.macro.call']]);
            checkAsm('\tInclude "a.asm"', [['Include', 'entity.name.function.macro.call']]);
        });

        test('dot repeat and macro inhibition', () => {
            checkAsm('\t.3 inc a', [['.', DIR + '.repeat'], ['3', DEC], ['inc', INSTR]]);
            checkAsm('\t.(12-len) BYTE 0', [['.', DIR + '.repeat'], ['len', LABEL_REF], ['BYTE', DIR + '.data']]);
            checkAsm('\t@djnz 1B', [['@', 'keyword.operator.macro-inhibit'], ['djnz', INSTR]]);
        });
    });


    suite('directives', () => {

        test('data and symbols', () => {
            checkAsm('Kip\tEQU 0x23*256 + low $', [['Kip', LABEL], ['EQU', DIR + '.symbol'], ['low', 'keyword.operator.word']]);
            checkAsm('cnt = cnt + 1', [['cnt', LABEL], ['=', 'keyword.operator.assignment'], ['cnt', LABEL_REF]]);
            checkAsm('\tdefb 1 : DW 2 : d24 3 : dz "x" : abytec 0 "KIP" : block 10', [
                ['defb', DIR + '.data'], ['DW', DIR + '.data'], ['d24', DIR + '.data'], ['dz', DIR + '.data'],
                ['abytec', DIR + '.data'], ['block', DIR + '.data']
            ]);
            checkAsm('\tDG ...# #... .##.', [['DG', DIR + '.data'], ['...#', 'string.unquoted.bitmap']]);
            checkAsm('\tdh 00 1F', [['dh', DIR + '.data'], ['00', HEX], ['1F', HEX]]);
        });

        test('leading dot', () => {
            checkAsm('\t.org #8000 : .DB 1', [['.org', DIR], ['#8000', HEX], ['.DB', DIR + '.data']]);
        });

        test('files and devices', () => {
            checkAsm('\tinclude "lib/file.asm"', [['include', DIR + '.file'], ['lib/file.asm', 'string.quoted.double']]);
            checkAsm('\tINCLUDE <VDP.I>', [['VDP.I', 'string.quoted.other.lt-gt.include']]);
            checkAsm('\tincbin gfx.scc ,,7', [['incbin', DIR + '.file'], ['gfx.scc', 'string.unquoted.filename'], ['7', DEC]]);
            checkAsm('\tdevice zxspectrum128 : savesna "a.sna", start', [
                ['device', DIR + '.device'], ['zxspectrum128', 'support.constant.device'], ['savesna', DIR + '.file'], ['start', LABEL_REF]
            ]);
            checkAsm('\tSAVENEX SCREEN L2 0, 0', [['SAVENEX', DIR + '.file'], ['SCREEN', 'support.constant.savenex'], ['L2', 'support.constant.savenex']]);
            checkAsm('\tSAVETAP "o.tap",CODE,"name",start,100', [['CODE', 'support.constant.tape-block-type']]);
            checkAsm('\tOPT push reset --syntax=abf -Wno-rdlow', [
                ['OPT', DIR], ['push', 'support.constant.option'], ['--syntax=abf', 'support.constant.option'], ['-Wno-rdlow', 'support.constant.option']
            ]);
            checkAsm('\tDISPLAY /A, value, {b $800F}', [
                ['/A', 'support.constant.display-format'], ['{', 'punctuation.section.braces.begin'], ['b', 'keyword.operator.memory-read-byte']
            ]);
        });

        test('conditional assembly', () => {
            checkAsm('\tIF (aaa == 0) || x', [['IF', COND], ['==', 'keyword.operator.comparison'], ['||', 'keyword.operator.logical']]);
            checkAsm('\tifndef DEBUG', [['ifndef', COND], ['DEBUG', 'variable.other.constant.define']]);
            checkAsm('\tIFUSED label : ELSEIF 1 : ELSE : ENDIF', [['IFUSED', COND], ['ELSEIF', COND], ['ELSE', COND], ['ENDIF', COND]]);
        });

        test('macros', () => {
            checkAsm('\tMACRO WAVEOUT reg, data', [
                ['MACRO', DIR + '.macro'], ['WAVEOUT', 'entity.name.function.macro'], ['reg', 'variable.parameter.macro'], ['data', 'variable.parameter.macro']
            ]);
            checkAsm('LabelAsMacroName\tMACRO arg1?, arg2?', [
                ['LabelAsMacroName', 'entity.name.function.macro'], ['MACRO', DIR + '.macro'], ['arg1?', 'variable.parameter.macro']
            ]);
            checkAsm('\tENDM', [['ENDM', DIR + '.macro']]);
            checkAsm('\tWAVEOUT 2,hl', [['WAVEOUT', 'entity.name.function.macro.call'], ['2', DEC], ['hl', REG]]);
            checkAsm('\tUseLess <5, 6 !> 3>', [['<', 'punctuation.definition.string.begin'], ['!>', 'constant.character.escape']]);
            checkAsm('\tRECT x=1, y = 2', [['x', 'variable.parameter.macro'], ['=', 'keyword.operator.assignment'], ['y', 'variable.parameter.macro']]);
            checkAsm('\tDEFINE+ do_stuff set 4,e', [['DEFINE+', DIR + '.define'], ['do_stuff', 'variable.other.constant.define'], ['e', REG]]);
        });

        test('repeat blocks', () => {
            checkAsm('\tDUP 3, i1 : EDUP : REPT 2 : ENDR : WHILE x < 5 : ENDW', [
                ['DUP', DIR + '.repeat'], ['EDUP', DIR + '.repeat'], ['REPT', DIR + '.repeat'], ['ENDR', DIR + '.repeat'],
                ['WHILE', DIR + '.repeat'], ['ENDW', DIR + '.repeat']
            ]);
        });

        test('module and struct', () => {
            checkAsm('\tMODULE main', [['MODULE', DIR + '.module'], ['main', 'entity.name.namespace.module']]);
            checkAsm('\tendmodule', [['endmodule', DIR + '.module']]);
            checkAsm('\tSTRUCT SCOLOR,4', [['STRUCT', DIR + '.struct'], ['SCOLOR', 'entity.name.type.struct'], ['4', DEC]]);
            checkAsm('RED\tBYTE 4', [['RED', LABEL], ['BYTE', DIR + '.data']]);
            checkAsm('name\tTEXT 10, { "none" }', [['TEXT', DIR + '.data']]);
            checkAsm('\tENDS', [['ENDS', DIR + '.struct']]);
            checkAsm('COLOR\tSCOLOR 0,0,0', [['COLOR', LABEL], ['SCOLOR', 'entity.name.function.macro.call']]);
        });

        test('#line', () => {
            checkAsm('#line 101 "some.c"', [['#', DIR + '.line'], ['line', DIR + '.line'], ['101', DEC]]);
        });

        test('lua block', () => {
            const lines = ['\tLUA ALLPASS ; comment', '\t\t_pl("LABEL LD A,10") -- lua', '\tENDLUA', '\tnop'];
            checkAsm(lines.slice(0, 1), [['LUA', DIR + '.lua'], ['ALLPASS', 'support.constant.lua-pass'], [' comment', 'comment.line.semicolon']]);
            checkAsm(lines.slice(0, 2), [['\t\t_pl("LABEL LD A,10") ', 'meta.embedded.block.lua']]);
            checkAsm(lines.slice(0, 3), [['ENDLUA', DIR + '.lua']]);
            checkAsm(lines, [['nop', INSTR]]);
        });

        test('not sjasmplus', () => {
            // other assemblers' directives are just macro calls
            for (const word of ['proc', 'repeat', 'switch', 'wend', 'print', 'amsdos', 'buildsna', 'swap', 'ldh', 'memorymap'])
                checkAsm('\t' + word, [[word, 'entity.name.function.macro.call']]);
        });
    });


    suite('comments and strings', () => {

        test('comments', () => {
            checkAsm('\tnop ; comment', [['nop', INSTR], [';', 'punctuation.definition.comment'], [' comment', 'comment.line.semicolon']]);
            checkAsm('\tnop // comment', [[' comment', 'comment.line.double-slash']]);
            checkAsm('\tld /* x */ a,80', [['ld', INSTR], [' x ', 'comment.block'], ['a', REG]]);
            // nested block comments
            checkAsm(['/*', ' /* nested */', ' still comment */ nop'], [[' still comment ', 'comment.block'], ['nop', INSTR]]);
            checkAsm('\tnop ; WPMEM 5, w', [['WPMEM', 'keyword.control.dezog']]);
        });

        test('strings', () => {
            checkAsm('\tdb "a\\n\\"b", \'it\'\'s\', "AB"Z, \'F\'C', [
                ['a', 'string.quoted.double'], ['\\n', 'constant.character.escape'], ['\\"', 'constant.character.escape'],
                ['it', 'string.quoted.single'], ['\'\'', 'constant.character.escape.apostrophe'],
                ['Z', 'storage.modifier.string-suffix'], ['C', 'storage.modifier.string-suffix']
            ]);
            checkAsm('\tld a,";" : db "a:b" ; c', [[';', 'string.quoted.double'], ['a:b', 'string.quoted.double'], [' c', 'comment.line.semicolon']]);
            checkAsm('\tINCBIN "path" .. BIN_EXT', [['..', 'keyword.operator.concatenation']]);
        });
    });


    suite('listing', () => {

        const checkList = (line: string, expected: Expected[]) => check(listGrammar, line, expected);

        test('prefix columns', () => {
            checkList('  78+ 884D ED A0       > ldi', [
                ['  78', 'constant.numeric.integer.decimal.line-number'], ['+', 'keyword.operator.include-level'],
                ['884D', 'constant.numeric.integer.hexadecimal.address'], ['ED', 'constant.numeric.integer.hexadecimal.machine-code'],
                ['A0', 'constant.numeric.integer.hexadecimal.machine-code'], ['>', 'keyword.operator.macro-expansion'], ['ldi', INSTR]
            ]);
            checkList(' 12++ 0000 ~            	ld a,1', [['++', 'keyword.operator.include-level'], ['~', 'comment.other.skipped'], ['ld', INSTR]]);
            // the source starts at column 24, there a word is a label
            checkList('   5  8000              ld	nop', [['ld', LABEL], ['nop', INSTR]]);
        });

        test('source part', () => {
            checkList(' 110  5BD9              .score_7\t\tequ $-2-5', [['.score_7', LABEL + '.local'], ['equ', DIR + '.symbol']]);
            checkList(' 111  5BD9 00 00        \t\t\tdw 0 ; x', [['00', 'constant.numeric.integer.hexadecimal.machine-code'], ['dw', DIR + '.data'], [' x', 'comment.line.semicolon']]);
            checkList('   3  0000', [['0000', 'constant.numeric.integer.hexadecimal.address']]);
        });

        test('other lines', () => {
            checkList('# file opened: src/main.asm', [['src/main.asm', 'string.unquoted.filename']]);
            checkList('main.asm(12): warning[rdlow]: Reading memory', [['warning', 'keyword.other.diagnostic.warning']]);
            checkList('05:5E24 tape.endloader', [['05', 'constant.numeric.integer.hexadecimal.page'], ['tape.endloader', LABEL]]);
        });
    });
});
