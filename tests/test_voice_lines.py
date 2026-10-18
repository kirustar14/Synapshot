"""One spoken line per step, and one audio file per spoken line.

The bug these are here for: the call page played several lines at once, so a patient
heard every question on a screen read over the top of itself. Half of that was the page
firing a play for each question without stopping the last one, which the shared player
in web/src/call/player.ts now prevents. The other half is the contract, which is what
this file holds: a step offers exactly one line and exactly one file, and no two steps
point at the same recording.

Nothing here needs an ElevenLabs key. `audio_meta` reads the manifest and the files
already on disk, and the assertions are about the shape of what it returns, which is
true whether every line was generated or none were.
"""

from backend.agent import voices
from backend.calls import script as callscript


def payload(full: bool = False) -> dict:
    """The script the page is driven by, with whatever audio actually exists."""
    return callscript.payload(full=full, audio=voices.audio_meta())


def test_one_say_and_one_audio_per_step():
    """Every step carries a single line and a single file, never a list of either."""
    for full in (False, True):
        for step in payload(full)["steps"]:
            assert isinstance(step["say"], str) and step["say"].strip(), step["id"]
            got = step.get("audio")
            assert got is None or isinstance(got, str), f"{step['id']} audio is {type(got)}"


def test_no_two_steps_share_an_audio_file():
    """Two steps pointing at one recording is the same line played twice."""
    for full in (False, True):
        files = [s["audio"] for s in payload(full)["steps"] if s.get("audio")]
        assert len(files) == len(set(files)), sorted(f for f in files if files.count(f) > 1)


def test_a_step_without_audio_says_so():
    """No file means audio None and fallback speech, so the page knows to use the browser."""
    for full in (False, True):
        for step in payload(full)["steps"]:
            if step.get("audio"):
                assert step.get("fallback") is None, step["id"]
            else:
                assert step["audio"] is None, step["id"]
                assert step.get("fallback") == "speech", step["id"]


def test_duration_ms_is_present_when_there_is_a_file():
    """The page needs the length to time out a line whose ended event never arrives.

    A file with no measured duration is allowed: ffprobe may not be installed. It gets
    None rather than a guess, and the player falls back to its own cap.
    """
    for full in (False, True):
        for step in payload(full)["steps"]:
            got = step.get("duration_ms")
            if got is not None:
                assert isinstance(got, int) and got > 0, f"{step['id']} duration_ms {got}"
                assert step.get("audio"), f"{step['id']} has a duration but no file"


def test_audio_meta_only_offers_files_that_exist():
    """A manifest entry whose mp3 is gone must not be offered to the page."""
    for sid, row in voices.audio_meta().items():
        assert row["file"], sid
        assert (voices.voice_dir() / row["file"]).exists(), sid


def test_script_route_matches_the_payload(client, seeded):
    """The served script has the same one line one file shape."""
    pid = seeded[0]["id"]
    made = client.post("/api/calls", json={"patient_id": pid, "send": False})
    assert made.status_code == 200, made.text
    token = made.json()["token"]

    got = client.get(f"/api/call/{token}/script")
    assert got.status_code == 200, got.text
    steps = got.json()["steps"]
    assert steps

    files = [s["audio"] for s in steps if s.get("audio")]
    assert len(files) == len(set(files))
    for step in steps:
        assert isinstance(step["say"], str)
        assert step.get("audio") is None or isinstance(step["audio"], str)
