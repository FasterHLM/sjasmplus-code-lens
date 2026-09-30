import {CommonRegexes} from './regexes/commonregexes';
import * as vscode from 'vscode';
import {Config} from './config';
import {getModule, grepMultiple, reduceLocations} from './grep';
import {CompletionRegexes} from './regexes/completionregexes';
import {AllowedLanguageIds} from './languageId';
import {getCompleteLabel, getNonLocalLabel} from './grepextra';


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
 */
export class CompletionProposalsProvider implements vscode.CompletionItemProvider {
    /**
     * Called from vscode when the user types characters.
     * @param document The current document.
     * @param position The position of the word for which the references should be found.
     * @param token
     */
    public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList | undefined>> {
        // Check which workspace
        const config = Config.getConfigForDoc(document);
        if (!config?.enableCompletions)
            return undefined;   // Don't show any completion.

        // Get required length
        const requiredLen = config.completionsRequiredLength;

        const line = document.lineAt(position).text;
        const word = getCompleteLabel(line, position.character);
        //console.log('provideCompletionItems:', label);
        let len = word.label.length;
        if (word.label.startsWith('.'))
            len--; // Require one more character for local labels.
        if (len < requiredLen)
            return new vscode.CompletionList([new vscode.CompletionItem(' ')], false);  // A space is required, otherwise vscode will not ask again for completion items.

        // Search proposals:

        // Get all lines
        const lines = document.getText().split('\n');
        // Get the module at the line of the searched word.
        const row = position.line;
        const moduleLabel = getModule(lines, row);

        // Get the range of the whole input label.
        // Otherwise vscode takes only the part after the last dot.
        const lineContents = lines[row];
        const rowLabel = getCompleteLabel(lineContents, position.character);
        const start = rowLabel.preString.length;
        const end = start + rowLabel.label.length;
        const range = new vscode.Range(new vscode.Position(row, start), new vscode.Position(row, end));

        // Get the first non-local label
        const languageId = document.languageId as AllowedLanguageIds;
        const regexLbls = CommonRegexes.regexLabel(config, languageId);
        let nonLocalLabel;  // Only used for local labels
        if (rowLabel.label.startsWith('.')) {
            const result = getNonLocalLabel(regexLbls, lines, row, -1);
            nonLocalLabel = result.label;
        }

        // Search
        const posRange =  document.getWordRangeAtPosition(position);
        if (!posRange) {
            return undefined;
        }
        const searchWord = document.getText(posRange);
        const fuzzySearchWord = CommonRegexes.regexPrepareFuzzy(searchWord);

        // regexes for labels with and without colon
        const regexes = CompletionRegexes.regexesEveryLabelForWord(fuzzySearchWord, config, languageId);
        // Find all sjasmplus MODULEs in the document
        const searchSjasmModule = CompletionRegexes.regexEveryModuleForWord(fuzzySearchWord, languageId);
        regexes.push(searchSjasmModule);
        // Find all sjasmplus MACROs in the document
        const searchSjasmMacro = CompletionRegexes.regexEveryMacroForWord(fuzzySearchWord, languageId);
        regexes.push(searchSjasmMacro);

        const locations = await grepMultiple(regexes, config.wsFolderPath, languageId, config.excludeFiles);
        // Reduce the found locations.
        const reducedLocations = await reduceLocations(regexLbls, locations, document.fileName, position, true, false);
        // Now put all proposal texts in a map. (A map to make sure every item is listed only once.)
        const proposals = new Map<string, vscode.CompletionItem>();

        // Go through all found locations
        for (const loc of reducedLocations) {
            const text = loc.moduleLabel;
            if (config.labelsExcludes.includes(text))
                continue;   // Skip if excluded
            /*
            Alternative implementation that only proposes completion up to the next dot:
            const fullText = loc.moduleLabel;
            // Reduce text to match number of columns
            const textArr = fullText.split('.');
            let text = textArr[0];
            for (let i = 1; i <= dotCount; i++) {
                text += '.' + textArr[i];
            }
            */

            //console.log('Proposal:', text);
            const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Function);
            item.filterText = text;
            item.range = range;

            // Check for local label
            if (nonLocalLabel) {
                // A previous non-local label was searched (and found), so label is local.
                item.filterText = rowLabel.label;
                // Change insert text
                let k = moduleLabel.length;
                if (k > 0)
                    k++;    // For the dot '.'
                k += nonLocalLabel.length;
                let part = text.substring(k);
                item.insertText = part;
                // change shown text
                item.label = part;
                // And filter text
                item.filterText = part;
            }
            // Maybe make the label local to current module.
            else if (text.startsWith(moduleLabel + '.')) {
                // Change insert text
                const k = moduleLabel.length + 1;
                let part = text.substring(k);
                item.insertText = part;
                // change shown text
                item.label = '[' + text.substring(0, k) + '] ' + part;
            }

            proposals.set(item.label as string, item);
        }

        // Create list from map
        const propList = Array.from(proposals.values());


        // Check if word includes a dot
        let allCompletions;
        let k = rowLabel.label.lastIndexOf('.');
        if (k < 0) {
            // No dot.
            // Check if word starts with a capital letter
            const upperCase = (rowLabel.label[0] === rowLabel.label[0].toUpperCase());  // NOSONAR
            // Add the instruction proposals
            let i = 0;
            allCompletions = completions.map(text => {
                if (upperCase)
                    text = text.toUpperCase();
                const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Function);
                item.sortText = i.toString(); // To make sure they are shown at first.
                i++;
                item.range = range;
                return item;
            });
            // Add grepped words
            allCompletions.push(...propList);
        }
        else {
            // Simply use grepped list.
            allCompletions = propList;
        }

        // Return.
        // false: In fact the 'false' means that the list is not incomplete,
        // i.e. it is complete. vscode will not call completion
        // anymore if not something bigger chances.
        // So, in fact only for the first character the completion list
        // is build. vscode filters this list on its own.
        const completionList = new vscode.CompletionList(allCompletions, false);
        return completionList;
    }

}
