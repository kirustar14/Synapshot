"""The measurement pipeline: flash, pursuit, calibration, recall, fluency, gating."""

import numpy as np

from backend.features import (
    antisaccade, blink, fixation, flash, fluency, gaze as gz, memory, pipeline, pursuit,
    quality, sem as semmod, speech, synth,
)


def test_flash_detection_finds_eight_of_ten():
    """The detector finds the brightness step in a noisy synthetic series."""
    hits = 0
    for i in range(10):
        t, lum = flash.synth(t_f=1.0, delay_s=0.18 + 0.02 * i, noise=0.02, seed=i)
        got = flash.detect(t, lum, 1.0)
        hits += bool(got["found"])
        if got["found"]:
            assert abs(got["t"] - (1.0 + 0.18 + 0.02 * i)) < 0.08
    assert hits >= flash.NEED, f"only {hits} of 10 flashes detected"


def test_flash_block_sets_flash_ok():
    """Ten returned flashes pass the block, zero returned flashes fail it."""
    t, lum = flash.synth(dur_s=18.0, t_f=0.0, delay_s=0.0, amp=0.0, seed=1)
    times = [0.4 + 1.5 * i for i in range(10)]
    for tf in times:
        idx = int(round((tf + 0.22) * 30))
        if idx < lum.size:
            lum[idx] += 0.35
    good = flash.test_block(t, lum, times)
    assert good["flash_ok"] and good["found"] >= 8
    assert good["delay_s"] is not None and abs(good["delay_s"] - 0.22) < 0.05

    flat, _ = flash.synth(dur_s=18.0, amp=0.0, seed=2)
    bad = flash.test_block(flat, np.full(flat.size, 0.45), times)
    assert not bad["flash_ok"]


def test_pursuit_gain_recovers_a_known_gain():
    """Pursuit gain comes back within 0.05 of the truth on synthetic gaze."""
    t = np.arange(0.0, 20.0, 1.0 / 30.0)
    tgt = pursuit.target(t)
    rng = np.random.default_rng(0)
    for truth in (0.55, 0.7, 0.85, 1.0):
        gaze = 0.5 + truth * (tgt - 0.5) + rng.normal(0, 0.012, t.size)
        got = pursuit.measure(t, gaze)
        assert abs(got["gain"] - truth) < 0.05, f"true {truth}, measured {got['gain']:.3f}"
        assert got["r"] > 0.9


def test_pursuit_lag_is_found_but_not_clinical():
    """A delayed response is aligned by the lag search, and the lag is labelled."""
    t = np.arange(0.0, 20.0, 1.0 / 30.0)
    lag = 0.25
    gaze = 0.5 + 0.8 * (pursuit.target(t - lag) - 0.5)
    got = pursuit.measure(t, gaze)
    assert abs(got["lag"] - lag) < 0.04
    assert abs(got["gain"] - 0.8) < 0.05
    both = pursuit.both({"t": t, "x": gaze, "y": np.full_like(t, 0.5)})
    assert "lag_s_not_clinical" in both, "the lag must be named as not clinical"


def test_calibration_error_is_reported_in_degrees():
    """The nine point fit returns a plausible error and refuses too little data."""
    sess = synth.session({"pursuit_gain": 0.8}, seed=4)
    got = gz.fit(sess["frames"], sess["calib"])
    assert got["beta"] is not None
    assert 0.1 < got["err_deg"] < 5.0, f"calibration error {got['err_deg']:.2f} is implausible"
    assert got["points"] > 100, "the fit should use every settled frame, not one per dot"
    assert gz.fit(sess["frames"][:5], sess["calib"])["beta"] is None


def test_memory_recall_is_fuzzy_but_not_generous():
    """Near misses count, unrelated words do not, and nothing counts twice."""
    got = memory.score(["anchor", "candel", "rivr", "piano", "zebra", "anchor"])
    assert got["correct"] == 4
    assert "zebra" in got["intrusion_words"]
    assert len(set(got["words"])) == len(got["words"]), "a word was counted twice"
    assert memory.score(memory.WORDS)["correct"] == 15


def test_fluency_counts_unique_valid_animals():
    """Repeats and non-animals are rejected."""
    got = fluency.score(["dog", "cat", "dog", "banana", "elefant", "zebra"])
    assert got["fluency_animals"] == 4
    assert got["repeats"] == 1
    assert "banana" in got["rejected"]


def test_fixation_and_blink():
    """BCEA grows with scatter, and blinks are counted with hysteresis."""
    rng = np.random.default_rng(1)
    tight = fixation.bcea(rng.normal(0.5, 0.003, 300), rng.normal(0.5, 0.003, 300))
    loose = fixation.bcea(rng.normal(0.5, 0.02, 300), rng.normal(0.5, 0.02, 300))
    assert 0 < tight < loose

    t = np.arange(0.0, 12.0, 1.0 / 30.0)
    ear = np.where((t % 3.0) < 0.12, 0.10, 0.30)
    got = blink.detect(t, ear)
    assert 15 < got["blink_rate"] < 25, f"blink rate {got['blink_rate']:.1f} per minute"
    assert 80 < got["blink_dur"] < 200


def test_saccade_latency_cancels_the_call_delay():
    """Latency is measured between two events in the same returned stream."""
    want = 230.0
    sess = synth.session({"pursuit_gain": 0.8, "saccade_latency": want}, seed=6)
    got = pipeline.run(sess)
    assert got["flash_ok"]
    measured = got["values"]["saccade_latency"]
    # One frame of quantization at 30 fps is 33 ms, and onset is found about half a frame
    # early, so the tolerance is one frame.
    assert abs(measured - want) < 34.0, f"wanted {want} ms, measured {measured:.0f} ms"


def test_antisaccade_error_rate():
    """The error rate tracks the generated rate within binomial noise over 20 trials."""
    sess = synth.session({"pursuit_gain": 0.8, "antisaccade_err": 30.0}, seed=8)
    got = pipeline.run(sess)
    measured = got["values"]["antisaccade_err"]
    assert 5.0 <= measured <= 60.0, f"error rate {measured:.0f} percent is out of range"


def test_pipeline_measures_back_what_it_was_given():
    """Every observable the session was built from is measured back out of it."""
    want = {"pursuit_gain": 0.72, "antisaccade_err": 24.0, "saccade_latency": 215.0,
            "speech_rate": 3.7, "recall_delayed": 9.0, "symptom_total": 31.0}
    got = pipeline.run(synth.session(want, seed=12), age=24, sex="F")
    obs = pipeline.observables(got["values"])
    assert set(obs) == set(want), "an observable went missing"
    assert abs(obs["pursuit_gain"] - want["pursuit_gain"]) < 0.06
    assert abs(obs["speech_rate"] - want["speech_rate"]) < 0.3
    assert obs["recall_delayed"] == want["recall_delayed"]
    assert abs(obs["symptom_total"] - want["symptom_total"]) < 1.0


def test_feature_rows_carry_mdc_and_changed():
    """Features come back in the contract shape, with MDC and a change flag."""
    prev = {"pursuit_gain": 0.50, "symptom_total": 30.0}
    got = pipeline.run(synth.session({"pursuit_gain": 0.80, "symptom_total": 31.0}, seed=2), prev=prev)
    rows = {f["name"]: f for f in got["features"]}
    assert rows["pursuit_gain"]["mdc"] == semmod.mdc("pursuit_gain")
    assert rows["pursuit_gain"]["changed"] is True, "a 0.3 move is far beyond the MDC"
    assert rows["symptom_total"]["changed"] is False, "a 1 point symptom move is inside the MDC"
    for row in got["features"]:
        assert set(row) == {"name", "tier", "value", "prev", "mdc", "unit", "changed"}
        assert row["tier"] in ("A", "B")


def test_quality_gate_blocks_the_eye_tasks():
    """A dark, face-losing channel fails the gate and no eye measure is reported."""
    got = pipeline.run(synth.session({"pursuit_gain": 0.8, "symptom_total": 20.0}, seed=5, poor=True))
    assert not got["quality"]["ok"]
    assert got["eye_blocked"] is True
    for key in pipeline.EYE_KEYS:
        assert key not in got["values"], f"{key} was reported through a failed gate"
    assert "symptom_total" in got["values"], "the spoken measures should survive"
    assert got["channel"]["face_share"] < quality.FACE_SHARE


def test_sem_table_and_mdc():
    """MDC is 1.96 times root two times SEM, and missing keys fall back."""
    assert abs(semmod.mdc("pursuit_gain") - 1.96 * (2 ** 0.5) * semmod.sem("pursuit_gain")) < 1e-12
    assert semmod.sem("not_a_real_metric") == semmod.FALLBACK
    assert semmod.source() == "placeholder", "the SEMs must declare that they are placeholders"


def test_pupil_light_reflex_is_roadmap_only():
    """The stub raises NotImplementedError with the message roadmap and does nothing else."""
    from backend.features import face

    try:
        face.pupil_light_reflex()
    except NotImplementedError as exc:
        assert str(exc) == "roadmap"
    else:
        raise AssertionError("pupil_light_reflex should raise NotImplementedError")


def test_speech_syllables_and_rate():
    """Syllable counting and the passage rate are sane without any audio."""
    assert [speech.count_syllables(w) for w in ("cat", "water", "beautiful")] == [1, 2, 3]
    words = [{"w": "the", "t0": 0.0, "t1": 0.25}, {"w": "quick", "t0": 0.25, "t1": 0.5},
             {"w": "elephant", "t0": 0.5, "t1": 1.1}]
    rate = speech.passage_rate(words)
    assert 3.0 < rate < 7.0, f"speech rate {rate:.2f} syllables per second"


def test_antisaccade_module_handles_no_data():
    """Every feature function returns a shape, not an exception, on an empty trace."""
    empty = {"t": np.zeros(0), "x": np.zeros(0), "y": np.zeros(0)}
    assert antisaccade.trials(empty, [], [])["antisaccade_err"] is None
    assert fixation.measure(empty)["intrusions"] == 0
    assert quality.gates([], 0, 99.0)["ok"] is False
