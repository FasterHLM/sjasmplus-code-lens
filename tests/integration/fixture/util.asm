	module util
; Clears the screen
clear:	ld hl,#4000
.fast:	ret
	endmodule

	module screen
base	equ #4000
	endmodule
