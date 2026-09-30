import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {SymbolDef} from './sjasm/project';
import {completionKind, keyName, kindText} from './symbols';


/// All additional completions like Z80 instructions and assembler
/// directives etc.
const completions = [
    // Z80 registers
    'a', 'b', 'c', 'd', 'e', 'h', 'l',
    'af', 'bc', 'de', 'hl', 'ix', 'iy', 'sp',
    'ixl', 'ixh', 'iyl', 'iyh',

    // Z80 instructions
	'adc',  'add',  'and',  'bit',  'call', 'ccf',  'cp',   'cpd',
	'cpdr', 'cpi',  'cpir', 'cpl',  'daa',  'dec',  'di',   'ei',
	'djnz', 'ex',   'exx',  'halt', 'im',   'inc',  'in',   'ind',
	'indr', 'ini',  'inir', 'jp',   'jr',   'ld',   'ldd',  'lddr',
	'ldi',  'ldir', 'neg',  'nop',  'or',   'otdr', 'otir', 'out',
	'outd', 'outi', 'pop',  'push', 'res',  'ret',  'reti', 'retn',
	'rl',   'rla',  'rlc',  'rlca', 'rld',  'rr',   'rra',  'rrc',
	'rrca', 'rrd',  'rst',  'sbc',  'scf',  'set',  'sla',  'slia',
    'sll',  'swap', 'sra',  'srl',  'sub',  'xor',

    // Z80N instructions
    'ldix', 'ldws', 'ldirx', 'lddx', 'lddrx', 'ldpirx',
    'outinb', 'mul', 'swapnib', 'mirror', 'nextreg',
    'pixeldn', 'pixelad', 'setae', 'test',
    'bsla', 'bsra', 'bsrl', 'bsrf', 'brlc',

    // sjasmplus fake instructions
    'sli',

    // sjasmplus
    'macro', 'endm', 'module', 'endmodule', 'struct', 'ends', 'dup', 'edup',
    'if', 'ifn', 'ifdef', 'ifndef', 'ifused', 'ifnused', 'else', 'endif',
    'include', 'incbin',
    'abyte', 'abytec', 'abytez', 'align', 'assert',
    'binary', 'block', 'defb', 'defd', 'defg', 'defh', 'defl', 'defm', 'defs', 'defw', 'dephase', 'disp', 'phase', 'unphase',
    'd24', 'db', 'dc', 'dd', 'dg', 'dh', 'hex', 'dm', 'ds', 'dw', 'dz',
    'display', 'byte', 'word', 'dword',
    'emptytap', 'emptytrd', 'encoding',
    'equ', 'export',
    'end', 'endlua', 'endt', 'ent',
    'includelua', 'inchob', 'inctrd', 'insert',
    'lua', 'labelslist', 'org', 'outend', 'output',
    'memorymap', 'mmu',
    'page', 'rept', 'endr', 'savebin', 'savedev', 'savehob', 'savesna', 'savetrd',
    'savetap', 'basic', 'code', 'numbers', 'chars', 'headless',
    'savenex', 'core', 'cfg', 'cfg3', 'bar', 'palette', 'default', 'mem', 'bmp', 'screen',
    'l2', 'l2_320', 'l2_640', 'scr', 'shc', 'shr', 'tile', 'cooper', 'bank', 'auto',
    'shellexec', 'size', 'slot',
    'tapend', 'tapout',
    'textarea',
    'define', 'undefine',
    'defarray', 'defarray+',
    'device', 'ZXSPECTRUM48', 'ZXSPECTRUM128', 'ZXSPECTRUM256', 'ZXSPECTRUM512', 'ZXSPECTRUM1024', 'ZXSPECTRUM2048', 'ZXSPECTRUM4096', 'ZXSPECTRUM8192', 'ZXSPECTRUMNEXT', 'NONE', 'ramtop',
    'open', 'close',
    'setbp', 'setbreakpoint',
    'bplist', 'unreal', 'zesarux',
    'opt', 'cspectmap', 'fpos',
    '_sjasmplus', '_version', '_release', '_errors', '_warnings'
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
        if (len < config.completionsRequiredLength)
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
            item.detail = keyName(def.key) + ' — ' + kindText(def.kind);
            proposals.set(text, item);
        };

        for (const def of project.getAllDefinitions()) {
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
