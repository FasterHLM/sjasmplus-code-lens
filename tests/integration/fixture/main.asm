; Main program
	device zxspectrum128
	org #8000

; Program entry
start:	call util.clear
	call util.clear.fast
	ld hl,screen.base
.loop:	halt
	jr .loop

	include "util.asm"

	STRUCT POINT
x	BYTE 0
y	BYTE 0
	ENDS

pos	POINT
	ld a,(pos.x)
	ld b,POINT.y
