; Labels that are not found: one that is in a module, one with a typo, one with nothing alike
	device zxspectrum48
	module tools
wipe	ret
	endmodule
begin	nop
	call wipe
	call bgein
	call nothing_alike
