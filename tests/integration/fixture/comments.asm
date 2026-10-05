; Comments above a definition: only whole-line comments count
	device zxspectrum48

; Memory map
;-----------
mem_base	equ #8000	;start of the area
mem_buffer	equ #c000	;the buffer
; Own comment
; of the third
mem_third	equ 1

	ld hl,mem_buffer
	ld de,mem_third
	ld bc,mem_base
