PY := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

.PHONY: dev seed test rig preflight install clean

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

clean:
	rm -rf data/unnamed.db data/cache data/cohort.json data/synthetic
