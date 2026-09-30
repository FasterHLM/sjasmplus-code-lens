/**
 * Keyword sets used by the sjasmplus parser to tell symbols apart from
 * instructions, directives, registers and expression operators.
 * All entries are lower case, lookups are done with the lower cased word.
 */

const words = (s: string) => new Set(s.trim().split(/\s+/));


/** Z80 registers, including undocumented halves and the alternative names sjasmplus accepts. */
export const REGISTERS = words(`
	a b c d e h l i r f
	af af' bc de hl sp ix iy
	ixh ixl iyh iyl hx xh lx xl hy yh ly yl
`);


/** Condition codes of jp/jr/call/ret. */
export const CONDITIONS = words(`nz z nc c po pe p m`);


/** Operators written as words inside expressions. */
export const WORD_OPERATORS = words(`
	low high u16 not abs mod shl shr and xor or norel exist sizeof pair
`);


/** Z80 mnemonics including undocumented ones, Z80N, CSpect and R800 extras and aliases sjasmplus accepts. */
export const MNEMONICS = words(`
	adc add and bit call ccf cp cpd cpdr cpi cpir cpl daa dec di djnz ei ex exa exd exx
	halt im in inc ind indr inf ini inir jp jr ld ldd lddr ldi ldir neg nop or otdr otir
	out outd outi pop push res ret reti retn rl rla rlc rlca rld rr rra rrc rrca rrd
	rst sbc scf set sla sli sll sra srl sub xor
	ldix ldws ldirx lddx lddrx ldpirx outinb mul swapnib mirror nextreg pixeldn
	pixelad setae test bsla bsra bsrl bsrf brlc
	break exit setbrk clrbrk
	mulub muluw
`);


/** Branch instructions: the only ones where the old "1B"/"1F" temporary label syntax works. */
export const BRANCHES = words(`jp jr djnz call`);


/**
 * All pseudo-ops (directives), including synonyms.
 * The operands of these are parsed as expressions (unless listed in
 * NON_EXPRESSION_DIRECTIVES), identifiers in them are symbol references.
 */
export const DIRECTIVES = words(`
	abyte abytec abytez align assert binary block bplist byte cspectmap d24 db dc dd
	defarray defarray+ defb defd defdevice define define+ defg defh defl defm defp defs defw
	dephase device dg dh disp display dm dp ds dup dw dword dz edup else elseif emptytap
	emptytrd encoding end endif endlua endm endmod endmodule endr ends endt endw ent equ
	export fpos hex hexend hexout if ifdef ifn ifndef ifnused ifused incbin inchob include
	includelua inctrd insert labelslist lua macro mmu module opt org outend output page phase
	relocate_end relocate_start relocate_table rept save3dos saveamsdos savebin savecdt
	savecpcsna savecpr savedev savehex savehob savenex savesna savetap savetrd setbp
	setbreakpoint shellexec size sldopt slot struct tapend tapout text textarea undefine
	unphase while word
`);


/** Directives whose operands are file names, options, keywords or bit patterns rather than expressions. */
export const NON_EXPRESSION_DIRECTIVES = words(`
	device opt sldopt encoding bplist emptytap emptytrd include includelua lua cspectmap
	labelslist hexout output tapout define define+ undefine defarray defarray+ defdevice
	dg defg
`);


/** Defines predefined by sjasmplus (case sensitive). */
export const PREDEFINED = new Set(`
	__SJASMPLUS__ __VERSION__ __ERRORS__ __WARNINGS__ __DATE__ __TIME__ __PASS__
	__INCLUDE_LEVEL__ __BASE_FILE__ __FILE__ __LINE__ __COUNTER__
	_SJASMPLUS _VERSION _RELEASE _ERRORS _WARNINGS
`.trim().split(/\s+/));


/** Directives that define a label with a value instead of the current address. */
export const EQU_DIRECTIVES = words(`equ`);
export const DEFL_DIRECTIVES = words(`defl =`);


/** Data directives (labels in front of them are data, not code). */
export const DATA_DIRECTIVES = words(`
	abyte abytec abytez block byte d24 db dc dd defb defd defg defh defm defp defs defw
	dg dh dm dp ds dw dword dz hex text word
`);


export function isKnownOperator(word: string): boolean {
	const w = word.toLowerCase();
	return MNEMONICS.has(w) || DIRECTIVES.has(w);
}
