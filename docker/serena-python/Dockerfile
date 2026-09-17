FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e AS node
FROM python:3.11.13-slim-bookworm@sha256:86adf8dbadc3d6e82ee5dd2c74bec2e1c2467cdad47886280501df722372d2e1 AS build
WORKDIR /build
COPY fetch.py requirements.lock ./
RUN python fetch.py && python -m pip install --no-cache-dir --require-hashes --only-binary=:all: --target=/deps -r requirements.lock
FROM python:3.11.13-slim-bookworm@sha256:86adf8dbadc3d6e82ee5dd2c74bec2e1c2467cdad47886280501df722372d2e1
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=build /deps /opt/deps
COPY --from=build /build/serena/src /opt/serena/src
COPY --from=build /build/serena/LICENSE /opt/serena/LICENSE
COPY --from=build /build/serena/LICENSES /opt/serena/LICENSES
COPY --from=build /build/pyright /opt/pyright
COPY requirements.lock /opt/requirements.lock
COPY bridge.py /opt/bridge.py
ENV PYTHONPATH=/opt/deps:/opt/serena/src PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp/home
WORKDIR /tmp
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/python", "-P", "/opt/bridge.py"]
