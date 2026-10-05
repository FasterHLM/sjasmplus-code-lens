; the value 12345 in a comment
	device zxspectrum48
SIZE	equ	#10*2		; 32, a comment with 99
	ld	a,SIZE
	ld	hl,"7"		; a string
1	djnz	1B
	ld	b,#FF
/* 42
   a block comment with 77 */
	lua
	x = 55
	endlua
