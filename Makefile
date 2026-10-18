# .venv/bin on macOS and Linux, .venv/Scripts on Windows. One Makefile, both.
PY := $(shell if [ -x .venv/bin/python ]; then echo .venv/bin/python; elif [ -x .venv/Scripts/python.exe ]; then echo .venv/Scripts/python.exe; else echo python3; fi)

.PHONY: dev seed test rig preflight check install clean mesh voices web models tunnel imessage all tiger tiger-check tiger-load decision-data veri-train veri-eval

install:
	$(PY) -m pip install -r requirements.txt

dev:
	$(PY) -m uvicorn backend.app:app --reload --port 8000

seed:
	$(PY) -m backend.seed

test:
	$(PY) -m pytest -q tests

rig:
	$(PY) rig/run_call.py

preflight:
	$(PY) rig/preflight.py

check:
	$(PY) -m backend.checklist

# ---------------------------------------------------------------- Tiger Data

# Make the telemetry table a hypertable, add the two continuous aggregates,
# the refresh policies and the columnstore policy. Idempotent: every step is
# recorded in tiger_bootstrap and skipped on a second run.
tiger:
	$(PY) -c "from backend import db, tiger; db.conn(); print(tiger.bootstrap())"

# What the service actually is, what is compressed, and a measured raw against
# aggregate comparison. Exits 1 when DATABASE_URL is set but the extension is not.
tiger-check:
	$(PY) scripts/tiger_check.py

# Fill the hypertable and measure ingest, refresh, compression and query time.
tiger-load:
	$(PY) scripts/tiger_load.py --rows 300000 --compress

# ---------------------------------------------------------------- Veri

# Synthetic decision traces for SFT and GRPO. Everything here is generated.
decision-data:
	$(PY) scripts/gen_decision_data.py --patients 200

# Dry run by default. Add --submit and set VERI_API_KEY to send the job.
veri-train:
	$(PY) scripts/veri_train.py --method sft --dataset-id $(DATASET)

# The four policy comparison, written to data/decision/eval.json.
veri-eval:
	$(PY) scripts/veri_eval.py

# Just the phone chain: can a text reach you, can your phone open the call page,
# and will the clinic call ring. Every unfinished line says what to do about it.
phone:
	$(PY) -m backend.phoneready

# The cortical surface with a Schaefer-100 label on every vertex. Cached, so seed and
# dev never refetch it.
mesh:
	$(PY) -m backend.data.mesh

# Every spoken line as an mp3 through ElevenLabs. Lines whose text has not changed are
# left alone. Without a key this prints what would be generated and the page falls back
# to the browser's own speech synthesis.
voices:
	$(PY) -m backend.agent.voices

# The MediaPipe face landmarker the phone runs. About 3.8 MB, not committed.
models:
	@mkdir -p web/public/models
	@if [ -f web/public/models/face_landmarker.task ]; then \
		echo "  already there: web/public/models/face_landmarker.task"; \
	else \
		echo "  downloading the face landmarker..."; \
		curl -fSL -o web/public/models/face_landmarker.task \
		  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task \
		  && echo "  saved to web/public/models/face_landmarker.task"; \
	fi

# The clinician app and the patient call page. The backend serves web/dist at /.
web:
	cd web && npm install && npm run build
	@mkdir -p web/public
	@cp -f exports/mesh.json web/public/mesh.json 2>/dev/null && echo "  copied exports/mesh.json into web/public/" || true

# Everything a fresh checkout needs, in the order it needs it.
all: mesh seed voices models web
	@echo ""
	@echo "  Ready. Run make dev, then make tunnel for a phone."
	@echo ""

# Enables the real iMessage transports. Optional: without them everything falls back to
# Twilio SMS and then to mock.
imessage:
	cd backend/comms/node && npm install
	@$(PY) -c "from backend.comms import photon; import json; print(json.dumps(photon.docs(), indent=2))"

# Creates the ElevenLabs conversational agent that reads the clinician update, and
# prints the id to put in .env. Idempotent by name. It needs credits before it speaks.
agent:
	$(PY) -m backend.comms.make_agent

tunnel:
	@echo ""
	@echo "  An iPhone will not open the camera over plain http, so the call page needs"
	@echo "  an https URL. A localhost link cannot work on the phone."
	@echo ""
	@echo "  1. Leave make dev running on port 8000 in another terminal."
	@echo ""
	@echo "  2. Start the tunnel:"
	@echo ""
	@echo "       cloudflared tunnel --url http://localhost:8000"
	@echo ""
	@echo "     It prints a line like https://something-random.trycloudflare.com"
	@echo "     Prefer cloudflared over ngrok: the free ngrok tier shows an interstitial"
	@echo "     warning page on the first visit from each browser, which is confusing for"
	@echo "     a patient who was told to tap a link and follow instructions."
	@echo ""
	@echo "  3. Put that URL in .env, with no trailing slash:"
	@echo ""
	@echo "       PUBLIC_URL=https://something-random.trycloudflare.com"
	@echo ""
	@echo "  4. Restart make dev so it picks the URL up, then check it:"
	@echo ""
	@echo "       curl -s \$$PUBLIC_URL/api/health"
	@echo ""
	@echo "  5. Open the call page on the phone from a link the backend made, so the"
	@echo "     token is real:"
	@echo ""
	@echo "       curl -s -XPOST \$$PUBLIC_URL/api/calls -H 'content-type: application/json' \\"
	@echo "            -d '{\"patient_id\":\"<id>\",\"send\":false}'"
	@echo ""
	@echo "  The URL changes every time cloudflared restarts, so redo step 3 each time."
	@echo ""

clean:
	rm -rf data/unnamed.db data/cache data/cohort.json data/synthetic data/calls
	rm -rf data/mesh.json exports/mesh.json
