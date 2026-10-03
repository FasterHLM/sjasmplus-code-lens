; Labels made by a macro from its parameter, and labels tested by EXIST
	device zxspectrum48
	macro decode prefix
prefix_exit	ret
	endm
	decode gb
	call gb_exit
	if exist Optional
	db Optional
	endif
	call not_defined_here
