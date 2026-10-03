; Labels made by a macro from its parameter, labels tested by EXIST, and a block that is not assembled
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
	if 1 == 2
	call not_reported_in_a_false_block
	endif
