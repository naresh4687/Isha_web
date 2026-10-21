PY=.venv/bin/python

venv:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

train:
	$(PY) -m app.train

serve:
	.venv/bin/uvicorn app.api:app --host 127.0.0.1 --port 8001

test:
	$(PY) -m pytest -q
