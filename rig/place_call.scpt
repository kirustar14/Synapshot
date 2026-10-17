-- Place a FaceTime call and press the Call button.
-- Needs Accessibility permission for whatever runs it (Terminal, iTerm or Python).
-- Run: osascript rig/place_call.scpt "+15551234567"

on run argv
	if (count of argv) is 0 then
		return "error: no number given"
	end if
	set theNumber to item 1 of argv

	-- This is the same thing as `open facetime://<number>`: it opens FaceTime with the
	-- number loaded and the call staged, but not yet placed.
	tell application "FaceTime" to activate
	do shell script "open " & quoted form of ("facetime://" & theNumber)
	delay 2.5

	-- Then press Call through System Events. The button's label depends on the macOS
	-- version, so every known spelling is tried before giving up.
	tell application "System Events"
		if not (exists process "FaceTime") then return "error: FaceTime is not running"
		tell process "FaceTime"
			set frontmost to true
			delay 0.5
			repeat with theName in {"Call", "FaceTime Audio", "FaceTime Video", "Join"}
				try
					click (first button whose name is (theName as string))
					return "called: " & theNumber & " via " & (theName as string)
				end try
			end repeat
			try
				-- Newer builds put Call in the first window's toolbar group.
				click button 1 of group 1 of window 1
				return "called: " & theNumber & " via group button"
			end try
		end tell
	end tell

	return "manual: FaceTime is staged, press Call by hand"
end run
