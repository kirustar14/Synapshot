PY := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

.PHONY: dev seed sample test check what phone install clean mesh voices web models tunnel imessage all

install:
	$(PY) -m pip install -r requirements.txt

dev:
	$(PY) -m uvicorn backend.app:app --reload --port 8000

seed:
	$(PY) -m backend.seed

test:
	$(PY) -m pytest -q tests

# The flagship patient: ten real documents on disk plus the field-by-field answer key
# the ingest is scored against. Seeded, so the same files come out every time.
sample:
	$(PY) -m backend.synth.make_sample

check:
	$(PY) -m backend.checklist

# What is real, what is standing in, what v2 removed and what it merged. `make check`
# answers "does this work"; this answers "what am I looking at".
what:
	$(PY) -m backend.finalcheck

# Just the phone chain: can a text reach you and can your phone open the call page.
# Every unfinished line says what to do about it.
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
all: mesh sample seed voices models web
	@echo ""
	@echo "  Ready. Run make dev, then make tunnel for a phone."
	@echo ""

# Enables the real iMessage transports. Optional: without them everything falls back to
# Twilio SMS and then to mock.
imessage:
	cd backend/comms/node && npm install
	@$(PY) -c "from backend.comms import photon; import json; print(json.dumps(photon.docs(), indent=2))"

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
	rm -rf data/synapshot.db data/cache data/cohort.json data/synthetic data/calls
	rm -rf data/mesh.json exports/mesh.json
