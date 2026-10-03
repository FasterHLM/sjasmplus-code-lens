import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {SymbolDef} from './sjasm/project';
import {completionKind, keyName, kindText} from './symbols';


/// All additional completions like Z80 instructions and assembler
/// directives etc.
const completions = [
    // Z80 registers
    'a', 'b', 'c', 'd', 'e', 'h', 'l', 'i', 'r',
    'af', 'bc', 'de', 'hl', 'ix', 'iy', 'sp',
    'ixl', 'ixh', 'iyl', 'iyh',
    'xl', 'lx', 'xh', 'hx', 'yl', 'ly', 'yh', 'hy',

    // Z80 instructions
    'adc',  'add',  'and',  'bit',  'call', 'ccf',  'cp',   'cpd',
    'cpdr', 'cpi',  'cpir', 'cpl',  'daa',  'dec',  'di',   'ei',
    'djnz', 'ex',   'exx',  'halt', 'im',   'inc',  'in',   'ind',
    'indr', 'ini',  'inir', 'jp',   'jr',   'ld',   'ldd',  'lddr',
    'ldi',  'ldir', 'neg',  'nop',  'or',   'otdr', 'otir', 'out',
    'outd', 'outi', 'pop',  'push', 'res',  'ret',  'reti', 'retn',
    'rl',   'rla',  'rlc',  'rlca', 'rld',  'rr',   'rra',  'rrc',
    'rrca', 'rrd',  'rst',  'sbc',  'scf',  'set',  'sla',  'sra',
    'srl',  'sub',  'xor',

    // Z80 undocumented instructions
    'sll', 'sli',

    // sjasmplus instruction alias (ex af,af')
    'exa',

    // Z80N instructions (--zxnext)
    'ldix', 'ldws', 'ldirx', 'lddx', 'lddrx', 'ldpirx',
    'outinb', 'mul', 'swapnib', 'mirror', 'nextreg',
    'pixeldn', 'pixelad', 'setae', 'test',
    'bsla', 'bsra', 'bsrl', 'bsrf', 'brlc',

    // CSpect emulator fake instructions (--zxnext=cspect)
    'break', 'exit', 'setbrk', 'clrbrk',

    // sjasmplus pseudo-ops
    'abyte', 'abytec', 'abytez', 'align', 'assert',
    'binary', 'block', 'bplist', 'byte',
    'cspectmap',
    'd24', 'db', 'dc', 'dd', 'defarray', 'defarray+', 'defb', 'defd', 'defdevice', 'defg', 'defh',
    'define', 'define+', 'defl', 'defm', 'defp', 'defs', 'defw', 'dephase', 'device', 'dg', 'dh',
    'disp', 'display', 'dm', 'dp', 'ds', 'dup', 'dw', 'dword', 'dz',
    'edup', 'emptytap', 'emptytrd', 'encoding', 'end', 'endlua', 'endm', 'endmod', 'endmodule',
    'endr', 'ends', 'endt', 'endw', 'ent', 'equ', 'export',
    'fpos',
    'hex', 'hexend', 'hexout',
    'incbin', 'inchob', 'include', 'includelua', 'inctrd', 'insert',
    'labelslist', 'lua',
    'macro', 'mmu', 'module',
    'opt', 'org', 'outend', 'output',
    'page', 'phase',
    'relocate_end', 'relocate_start', 'relocate_table', 'rept',
    'save3dos', 'saveamsdos', 'savebin', 'savecdt', 'savecpcsna', 'savecpr', 'savedev', 'savehex',
    'savehob', 'savenex', 'savesna', 'savetap', 'savetrd', 'setbp', 'setbreakpoint', 'shellexec',
    'size', 'sldopt', 'slot', 'struct',
    'tapend', 'tapout', 'text', 'textarea',
    'undefine', 'unphase',
    'while', 'word',

    // sjasmplus conditional assembly
    'if', 'ifn', 'ifdef', 'ifndef', 'ifused', 'ifnused', 'elseif', 'else', 'endif',

    // Pseudo-op arguments
    'basic', 'code', 'numbers', 'chars', 'headless', 'full', 'empty',               // SAVETAP, SAVECDT
    'open', 'core', 'cfg', 'cfg3', 'bar', 'palette', 'screen', 'copper', 'bank', 'auto', 'close',   // SAVENEX
    'none', 'default', 'mem', 'bmp', 'l2', 'l2_320', 'l2_640', 'lr', 'scr', 'shc', 'tile',   // (and shr)
    'zxspectrum48', 'zxspectrum128', 'zxspectrum256', 'zxspectrum512', 'zxspectrum1024',      // DEVICE
    'zxspectrum2048', 'zxspectrum4096', 'zxspectrum8192', 'zxspectrumnext', 'noslot64k',
    'amstradcpc464', 'amstradcpc6128', 'amstradcpcplus',
    'unreal', 'zesarux', 'mame', 'fuse',                        // BPLIST
    'pass1', 'pass2', 'pass3', 'allpass',                       // LUA
    'reset', 'listoff', 'liston', 'listall', 'listact', 'listmc',   // OPT (and push, pop)
    'comment', 'swapon', 'swapoff',                             // SLDOPT

    // Expression operators
    'low', 'high', 'not', 'mod', 'shl', 'shr', 'abs', 'norel', 'exist', 'sizeof', 'pair', 'u16',

    // Predefined defines
    '__SJASMPLUS__', '__VERSION__', '__ERRORS__', '__WARNINGS__', '__DATE__', '__TIME__', '__PASS__',
    '__INCLUDE_LEVEL__', '__BASE_FILE__', '__FILE__', '__LINE__', '__COUNTER__',
    '_SJASMPLUS', '_VERSION', '_RELEASE', '_ERRORS', '_WARNINGS'
];


/**
 * CompletionItemProvider for assembly language.
 * Proposes the symbols visible at the position (labels relative to the
 * current module, local labels of the current label, macros, defines)
 * plus instructions and directives.
 */
export class CompletionProposalsProvider implements vscode.CompletionItemProvider {
    constructor(protected projects: ProjectManager) {
    }


    /**
     * Called from vscode when the user types characters.
     * @param document The current document.
     * @param position The position of the word for which the references should be found.
     * @param token
     */
    public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.CompletionList | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableCompletions)
            return undefined;

        // The word left of the cursor, including dots and prefixes
        const line = document.lineAt(position).text;
        const before = /[@.!]?[\w.!?#@]*$/.exec(line.substring(0, position.character))![0];
        const after = /^[\w!?#@]*/.exec(line.substring(position.character))![0];
        const word = before + after;
        let len = word.length;
        if (word.startsWith('.'))
            len--; // Require one more character for local labels.
        // Right after a dot (local labels, module members) no minimum length
        if (len < config.completionsRequiredLength && !before.endsWith('.'))
            return new vscode.CompletionList([], true);    // Ask again when more is typed
        const range = new vscode.Range(position.line, position.character - before.length, position.line, position.character + after.length);

        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;
        const scope = project.scopeAt(document.fileName, position.line);
        const proposals = new Map<string, vscode.CompletionItem>();
        const add = (text: string, def: SymbolDef) => {
            if (proposals.has(text))
                return;
            const item = new vscode.CompletionItem(text, completionKind(def));
            item.range = range;
            item.detail = keyName(def.key) + ' — ' + kindText(def.kind) + (def.derivedFrom ? ', made by a macro' : '');
            proposals.set(text, item);
        };

        // The names made by macro expansions are labels of the program, too
        for (const def of [...project.getAllDefinitions(), ...project.getMadeDefinitions()]) {
            if (def.kind === 'temp' || def.kind === 'module' || def.kind === 'macrolocal')
                continue;
            const name = keyName(def.key);
            if (word.startsWith('.')) {
                // Local labels of the current non-local label
                if (def.key.startsWith('L:') && name.startsWith(scope.localPrefix + '.'))
                    add(name.substring(scope.localPrefix.length), def);
                continue;
            }
            // Relative to the current module where possible
            if (def.key.startsWith('L:') && scope.module && name.startsWith(scope.module + '.'))
                add(name.substring(scope.module.length + 1), def);
            add(name, def);
        }

        // Instructions and directives, in the case the user types
        if (!word.includes('.') && !word.startsWith('@')) {
            const upperCase = word.length > 0 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
            for (const text of completions) {
                const keyword = upperCase ? text.toUpperCase() : text;
                if (proposals.has(keyword))
                    continue;
                const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                item.range = range;
                proposals.set(keyword, item);
            }
        }

        // Complete: vscode filters the list itself while typing
        return new vscode.CompletionList([...proposals.values()], false);
    }
}
