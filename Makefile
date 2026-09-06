# 단일 검증 진입점. 전부 로컬에서 돌고, test/lint/build 는 네트워크를 타지 않는다.
#
#   make test        프론트 빌드+린트 + 파이썬 단위 테스트 전부
#   make eval-smoke  평가 파이프라인(judge -> agreement) mock 배선 점검
#
# API_PY: api/ 테스트는 fastapi/httpx 가 필요해 api/.venv 를 쓴다.
#         (없으면: cd api && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt)

PY      ?= python3
API_PY  ?= api/.venv/bin/python

.PHONY: help test test-py test-api lint build eval-smoke clean

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/'

test: lint build test-py test-api  ## 전체 검증

lint:  ## 프론트 린트 (oxlint)
	npm run lint

build:  ## 프론트 타입체크 + 빌드 (tsc -b && vite build)
	npm run build

test-py:  ## 평가 파이프라인 단위 테스트 (표준 라이브러리만)
	$(PY) -m unittest discover -s tests/python -p 'test_*.py' -v

test-api:  ## FastAPI 포팅 단위 테스트 (api/.venv 필요)
	cd api && ../$(API_PY) -m unittest discover -s tests -p 'test_*.py' -v

eval-smoke:  ## judge -> agreement mock 실행 (수치는 배선 점검용, 인용 금지)
	bash scripts/eval_smoke.sh

clean:
	rm -rf eval_out dist .e2e-artifacts
