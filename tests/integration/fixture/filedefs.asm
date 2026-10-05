; A define in the file name of a directive
	device zxspectrum48
	define DiskName "build/disk"
	emptytrd DiskName .. ".trd"
	savetrd DiskName .. ".trd", "a.B", #8000, 1
	nop
